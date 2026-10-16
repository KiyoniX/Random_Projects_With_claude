//! Le processeur du portage : le code ARM du jeu recompilé en C (`recomp/`), compilé en une DLL, appelé depuis Rust.
//! Même rôle et mêmes règles que `banc/cpu_native.py` en mode « natif seul » (sans unicorn).
//!
//! Une fibre Windows par fil de la console (`recomp/runtime/host.c`) : le C généré garde l'état d'un fil dans sa pile C, on
//! range donc la pile entière. `run` reprend la fibre du fil courant ; elle rend la main sur un appel système, un compteur
//! épuisé (préemption coopérative), un repère ou une faute. Un saut vers du code non recompilé (un module `.cro` pas encore
//! recompilé) est une faute : l'hybride (unicorn ou `.cro` recompilés) n'est pas fait ici.
//!
//! La DLL contient des octets du jeu : elle vit dans `local/recomp/jeu/build/` (jamais versionnée) et se charge à
//! l'exécution (`LoadLibraryExW`), la crate n'en dépend pas à la compilation.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::ffi::c_void;
use std::path::Path;
use std::rc::Rc;

use kernel::cpu::{Cpu, CtxId, Reg, Stop};
use kernel::memory::PageSink;

/// Instructions ARM comptées pour un décompte du C (un branchement en arrière, un appel).
pub const BACKEDGE_WEIGHT: u64 = 8;

// statuts rendus par host_resume (runtime/host.c)
const HS_DONE: i32 = 0;
const HS_SVC: i32 = 1;
const HS_LIMIT: i32 = 2;
const HS_HOOK: i32 = 3;
const HS_MISS: i32 = 4;
const HS_FAULT: i32 = 5;
const HS_UNIMPL: i32 = 6;
const HS_NOTARGET: i32 = 7;
const CMD_CALL: i32 = 1;
const CMD_CONTINUE: i32 = 2;

/// `Ctx` de host.c : la structure `Cpu` de rt.h, suivie de ce que l'hôte y ajoute.
#[repr(C)]
struct Ctx {
    r: [u32; 16],
    nf: u32,
    zf: u32,
    cf: u32,
    vf: u32,
    qf: u32,
    ge: u32,
    fpscr: u32,
    fpexc: u32,
    tls: u32,
    excl_addr: u32,
    budget: i32,
    d: [u64; 16],
    user: *mut c_void,
    ras: *mut c_void,
    rsp: u32,
    hint: u32,
    fiber: *mut c_void,
    status: i32,
    cmd: i32,
    arg: u32,
    info0: u32,
    info1: u32,
    jmp: *mut c_void,
}

#[cfg(windows)]
mod sys {
    use std::ffi::c_void;
    unsafe extern "system" {
        pub fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
        pub fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
        pub fn GetLastError() -> u32;
    }
}

/// Les fonctions de la DLL (pointeurs copiables : la DLL n'est jamais déchargée).
#[derive(Clone, Copy)]
struct Lib {
    rt_map: unsafe extern "C" fn(u32, u32, *mut u8, i32),
    rt_has_entry: unsafe extern "C" fn(u32) -> i32,
    rt_can_hook: unsafe extern "C" fn(u32) -> i32,
    rt_watch_set: unsafe extern "C" fn(u32, i32),
    rt_get_info: unsafe extern "C" fn(i32) -> u32,
    rt_get_unwinds: unsafe extern "C" fn() -> u32,
    host_new: unsafe extern "C" fn() -> *mut Ctx,
    host_free: unsafe extern "C" fn(*mut Ctx),
    host_reset: unsafe extern "C" fn(*mut Ctx),
    host_resume: unsafe extern "C" fn(*mut Ctx, i32, u32, i32) -> i32,
    /// Les modules .cro recompilés (absents d'une DLL plus ancienne).
    rt_mod_name: Option<unsafe extern "C" fn(u32) -> *const std::ffi::c_char>,
    rt_mod_info: Option<unsafe extern "C" fn(u32, *mut u32) -> i32>,
    rt_mod_set_base: Option<unsafe extern "C" fn(u32, u32)>,
}

#[cfg(windows)]
fn load_library(path: &Path) -> Result<Lib, String> {
    use std::os::windows::ffi::OsStrExt;
    let absolute = std::fs::canonicalize(path).map_err(|e| format!("DLL du jeu recompilé introuvable ({}) : {e}\n\
        La fabriquer :\n    python recomp/recomp.py gen --out local/recomp/jeu\n    python recomp/validate.py build --host",
        path.display()))?;
    let mut wide: Vec<u16> = absolute.as_os_str().encode_wide().collect();
    // canonicalize donne un chemin « \\?\ » : LoadLibrary l'accepte mais mieux vaut l'enlever
    if wide.starts_with(&[92, 92, 63, 92]) {
        wide.drain(0..4);
    }
    wide.push(0);
    unsafe {
        // 0x8 : LOAD_WITH_ALTERED_SEARCH_PATH (les dépendances se cherchent à côté de la DLL)
        let module = sys::LoadLibraryExW(wide.as_ptr(), std::ptr::null_mut(), 0x8);
        if module.is_null() {
            return Err(format!("LoadLibrary a échoué pour {} (erreur {})", absolute.display(), sys::GetLastError()));
        }
        let get = |name: &str| -> Result<*mut c_void, String> {
            let mut bytes = name.as_bytes().to_vec();
            bytes.push(0);
            let p = sys::GetProcAddress(module, bytes.as_ptr());
            if p.is_null() { Err(format!("la DLL n'exporte pas {name}")) } else { Ok(p) }
        };
        let init: unsafe extern "C" fn() -> i32 = std::mem::transmute(get("host_init")?);
        let ctx_size: unsafe extern "C" fn() -> u32 = std::mem::transmute(get("host_ctx_size")?);
        if ctx_size() as usize != std::mem::size_of::<Ctx>() {
            return Err(format!("la structure Ctx de host.c et celle de hostcpu divergent ({} / {})", ctx_size(),
                std::mem::size_of::<Ctx>()));
        }
        let lib = Lib {
            rt_map: std::mem::transmute(get("rt_map")?),
            rt_has_entry: std::mem::transmute(get("rt_has_entry")?),
            rt_can_hook: std::mem::transmute(get("rt_can_hook")?),
            rt_watch_set: std::mem::transmute(get("rt_watch_set")?),
            rt_get_info: std::mem::transmute(get("rt_get_info")?),
            rt_get_unwinds: std::mem::transmute(get("rt_get_unwinds")?),
            host_new: std::mem::transmute(get("host_new")?),
            host_free: std::mem::transmute(get("host_free")?),
            host_reset: std::mem::transmute(get("host_reset")?),
            host_resume: std::mem::transmute(get("host_resume")?),
            rt_mod_name: get("rt_mod_name").ok().map(|p| std::mem::transmute(p)),
            rt_mod_info: get("rt_mod_info").ok().map(|p| std::mem::transmute(p)),
            rt_mod_set_base: get("rt_mod_set_base").ok().map(|p| std::mem::transmute(p)),
        };
        if let Ok(cro_init) = get("rt_cro_init") {
            let cro_init: unsafe extern "C" fn() = std::mem::transmute(cro_init);
            cro_init();
        }
        if init() != 0 {
            return Err("host_init a échoué : le fil ne peut pas devenir une fibre".into());
        }
        Ok(lib)
    }
}

#[cfg(not(windows))]
fn load_library(_path: &Path) -> Result<Lib, String> {
    Err("le processeur natif (fibres Windows) n'existe que sous Windows".into())
}

/// La table de pages du C : le noyau y branche la mémoire (voir `AddressSpace::set_sink`).
pub struct NativePageSink {
    lib: Lib,
    modules: Rc<RefCell<Modules>>,
}

impl PageSink for NativePageSink {
    fn map_pages(&mut self, first_page: u32, pages: u32, host: *mut u8, perms: u32) {
        if host.is_null() {
            // une plage est reprise ou changée : tout module branché qui la touche est débranché (`_touch_modules`)
            self.modules.borrow_mut().touch(first_page << 12, pages << 12);
        }
        unsafe { (self.lib.rt_map)(first_page, pages, host, perms as i32) }
    }
}

/// Les métadonnées d'un module recompilé (`cro_meta.json`, écrit par `recomp/cro_recomp.py`).
struct ModuleMeta {
    index: u32,
    code_off: u32,
    code_size: u32,
    file_size: u32,
    sha1: String,
    mask: Vec<u32>,
}

/// Les modules .cro recompilés que la DLL sait exécuter, et ceux qui sont branchés (`cpu_native.py: module_loaded`).
struct Modules {
    lib: Lib,
    meta: HashMap<String, ModuleMeta>,
    /// nom -> (base, fin de l'image)
    loaded: HashMap<String, (u32, u32)>,
    counts: BTreeMap<String, u64>,
}

impl Modules {
    fn count(&mut self, key: &str) {
        *self.counts.entry(key.to_string()).or_insert(0) += 1;
    }

    fn touch(&mut self, start: u32, size: u32) {
        let hit: Vec<String> = self
            .loaded
            .iter()
            .filter(|(_, (base, end))| (start as u64) < *end as u64 && (*base as u64) < start as u64 + size as u64)
            .map(|(n, _)| n.clone())
            .collect();
        for name in hit {
            self.unload(&name);
        }
    }

    fn unload(&mut self, name: &str) {
        let Some(meta) = self.meta.get(name) else { return };
        let index = meta.index;
        if self.loaded.remove(name).is_none() {
            return;
        }
        if let Some(set_base) = self.lib.rt_mod_set_base {
            unsafe { set_base(index, 0) };
        }
        self.count("modules débranchés");
    }

    fn load_meta(&mut self, dll: &Path) {
        let (Some(name_of), Some(info_of)) = (self.lib.rt_mod_name, self.lib.rt_mod_info) else { return };
        // cro_meta.json est à côté du C généré : dossier du dossier de la DLL
        let Some(folder) = dll.parent().and_then(|p| p.parent()) else { return };
        let Ok(text) = std::fs::read_to_string(folder.join("cro_meta.json")) else { return };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { return };
        let Some(map) = value.as_object() else { return };
        for (name, entry) in map {
            let get = |k: &str| entry.get(k).and_then(|v| v.as_u64()).map(|v| v as u32);
            let (Some(index), Some(code_off), Some(code_size), Some(file_size)) =
                (get("index"), get("code_off"), get("code_size"), get("file_size"))
            else {
                continue;
            };
            let mut info = [0u32; 4];
            let known = unsafe { info_of(index, info.as_mut_ptr()) } != 0;
            let dll_name = unsafe {
                let p = name_of(index);
                if p.is_null() { String::new() } else { std::ffi::CStr::from_ptr(p).to_string_lossy().to_string() }
            };
            if known && dll_name == *name && info[2] == code_size {
                let sha1 = entry.get("sha1").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let mask = entry
                    .get("mask")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_u64().map(|x| x as u32)).collect())
                    .unwrap_or_default();
                self.meta.insert(name.clone(), ModuleMeta { index, code_off, code_size, file_size, sha1, mask });
            }
        }
    }
}

/// L'état d'un fil de la console : une structure `Cpu` du C et sa fibre, plus ce que l'hôte en sait.
struct Context {
    lib: Lib,
    ptr: *mut Ctx,
    entry: u32,
    started: bool,
    next_cmd: (i32, u32),
    pc: u32,
}

impl Context {
    fn st(&self) -> &Ctx {
        unsafe { &*self.ptr }
    }

    fn st_mut(&mut self) -> &mut Ctx {
        unsafe { &mut *self.ptr }
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        unsafe { (self.lib.host_free)(self.ptr) }
    }
}

pub struct NativeCpu {
    lib: Lib,
    modules: Rc<RefCell<Modules>>,
    contexts: Vec<Context>,
    cur: Option<CtxId>,
    request: bool,
    /// Budget restant de la tranche interrompue par un repère.
    resume_left: i64,
    pub reprises: u64,
}

impl NativeCpu {
    pub fn load(dll: &Path) -> Result<NativeCpu, String> {
        let lib = load_library(dll)?;
        let mut modules = Modules { lib, meta: HashMap::new(), loaded: HashMap::new(), counts: BTreeMap::new() };
        modules.load_meta(dll);
        Ok(NativeCpu { lib, modules: Rc::new(RefCell::new(modules)), contexts: Vec::new(), cur: None, request: false,
            resume_left: 0, reprises: 0 })
    }

    /// À donner à `AddressSpace::set_sink`.
    pub fn page_sink(&self) -> Box<NativePageSink> {
        Box::new(NativePageSink { lib: self.lib, modules: self.modules.clone() })
    }

    /// Retours non-locaux suivis par le C (voir RT_POP).
    pub fn unwinds(&self) -> u32 {
        unsafe { (self.lib.rt_get_unwinds)() }
    }

    fn ctx(&self) -> &Context {
        &self.contexts[self.cur.expect("aucun contexte chargé")]
    }

    fn ctx_mut(&mut self) -> &mut Context {
        let i = self.cur.expect("aucun contexte chargé");
        &mut self.contexts[i]
    }

    fn run_loop(&mut self, mut left: i64) -> Stop {
        let lib = self.lib;
        let index = self.cur.expect("aucun contexte chargé");
        loop {
            if left <= 0 {
                let pc = self.get(Reg::Pc);
                return Stop::Limit { pc };
            }
            let ctx = &mut self.contexts[index];
            if !ctx.started {
                ctx.started = true;
                if unsafe { (lib.rt_has_entry)(ctx.entry) } == 0 {
                    return Stop::Fault { address: ctx.entry, detail: "adresse d'entrée sans cible recompilée".into() };
                }
            }
            let (cmd, arg) = ctx.next_cmd;
            if cmd == CMD_CALL {
                ctx.st_mut().r[15] = 0; // le C y range l'adresse de retour de la fonction (voir rt.h)
            }
            let budget = (left / BACKEDGE_WEIGHT as i64).max(1) as i32;
            let status = unsafe { (lib.host_resume)(ctx.ptr, cmd, arg, budget) };
            self.reprises += 1;
            let ctx = &mut self.contexts[index];
            let used = ((budget - ctx.st().budget.max(0)) as i64 * BACKEDGE_WEIGHT as i64).max(1);
            left -= used;
            ctx.next_cmd = (CMD_CONTINUE, 0);
            let (info0, info1) = (ctx.st().info0, ctx.st().info1);
            match status {
                HS_SVC => {
                    ctx.pc = info1 & !1; // le bit 0 dit que le code est en Thumb
                    return Stop::Svc { number: info0, pc: ctx.pc };
                }
                HS_LIMIT => {
                    ctx.pc = info0 & !1;
                    return Stop::Limit { pc: ctx.pc };
                }
                HS_HOOK => {
                    ctx.pc = info0 & !1;
                    self.resume_left = left;
                    return Stop::Hook { pc: ctx.pc };
                }
                HS_MISS => {
                    return Stop::Fault { address: info0,
                        detail: format!("saut vers du code non recompilé ({info0:#x}), sans mode hybride") };
                }
                HS_DONE => {
                    return Stop::Fault { address: ctx.pc,
                        detail: "le fil est revenu de sa fonction d'entrée sans appeler ExitThread".into() };
                }
                _ => {}
            }
            let hint = ctx.st().hint & !1;
            let (i0, i1) = unsafe { ((lib.rt_get_info)(0), (lib.rt_get_info)(1)) };
            return match status {
                HS_FAULT => Stop::Fault { address: hint,
                    detail: format!("{} hors mémoire à {:#010x} (code recompilé, dans la fonction entrée en dernier : {:#x})",
                        if i1 != 0 { "écriture" } else { "lecture" }, i0, hint) },
                HS_UNIMPL => Stop::Fault { address: i0, detail: format!("instruction non traduite par le recompilateur à {i0:#x}") },
                HS_NOTARGET => Stop::Fault { address: i0, detail: format!("saut sans cible à {i0:#x}") },
                _ => Stop::Fault { address: ctx.pc, detail: format!("sortie anormale du code natif (statut {status}, ({i0}, {i1}))") },
            };
        }
    }
}

impl Cpu for NativeCpu {
    fn get(&self, reg: Reg) -> u32 {
        let ctx = self.ctx();
        let st = ctx.st();
        match reg {
            Reg::R(n) => st.r[n as usize],
            Reg::Sp => st.r[13],
            Reg::Lr => st.r[14],
            Reg::Pc => ctx.pc,
            Reg::Cpsr => st.nf << 31 | st.zf << 30 | st.cf << 29 | st.vf << 28 | st.qf << 27 | st.ge << 16 | 0x10,
            Reg::Tls => st.tls,
            Reg::Fpscr => st.fpscr,
            Reg::Fpexc => st.fpexc,
        }
    }

    fn set(&mut self, reg: Reg, value: u32) {
        let lib = self.lib;
        let ctx = self.ctx_mut();
        match reg {
            Reg::R(n) => ctx.st_mut().r[n as usize] = value,
            Reg::Sp => ctx.st_mut().r[13] = value,
            Reg::Lr => ctx.st_mut().r[14] = value,
            Reg::Pc => {
                if ctx.started {
                    // La pile C du fil (suspendu dans un appel système) est abandonnée ; le fil repart d'une fonction
                    // neuve à cette adresse, avec les registres actuels.
                    unsafe { (lib.host_reset)(ctx.ptr) };
                    ctx.started = false;
                }
                ctx.pc = value & !1;
                ctx.entry = value;
                ctx.next_cmd = (CMD_CALL, value);
            }
            Reg::Cpsr => {
                let st = ctx.st_mut();
                st.nf = value >> 31 & 1;
                st.zf = value >> 30 & 1;
                st.cf = value >> 29 & 1;
                st.vf = value >> 28 & 1;
                st.qf = value >> 27 & 1;
                st.ge = value >> 16 & 15;
            }
            Reg::Tls => ctx.st_mut().tls = value,
            Reg::Fpscr => ctx.st_mut().fpscr = value,
            Reg::Fpexc => ctx.st_mut().fpexc = value,
        }
    }

    fn new_context(&mut self, pc: u32, sp: u32, r0: u32, tls: u32, thumb: bool) -> CtxId {
        let ptr = unsafe { (self.lib.host_new)() };
        assert!(!ptr.is_null(), "host_new a échoué");
        let entry = if thumb { pc | 1 } else { pc & !1 };
        let mut ctx = Context { lib: self.lib, ptr, entry, started: false, next_cmd: (CMD_CALL, entry), pc: entry & !1 };
        let st = ctx.st_mut();
        st.r[0] = r0;
        st.r[13] = sp & !7;
        st.tls = tls;
        st.fpexc = 0x4000_0000; // la VFP est ouverte et FPSCR vaut ce que pose le noyau de la console
        st.fpscr = 0x03C0_0000;
        st.excl_addr = 0xFFFF_FFFF;
        self.contexts.push(ctx);
        self.contexts.len() - 1
    }

    fn save(&mut self) -> Option<CtxId> {
        self.cur
    }

    fn restore(&mut self, ctx: CtxId) {
        self.cur = Some(ctx);
    }

    fn run(&mut self, max_instructions: u64) -> Stop {
        self.request = false;
        self.run_loop(max_instructions as i64)
    }

    fn resume(&mut self) -> Stop {
        if self.request {
            return Stop::Request;
        }
        let left = self.resume_left;
        self.run_loop(left)
    }

    fn watch(&mut self, address: u32) -> Result<(), String> {
        let key = address & !1;
        if unsafe { (self.lib.rt_can_hook)(address) } == 0 {
            return Err(format!("pas de repère possible à {address:#x} : ni entrée de fonction recompilée, ni point de la \
                génération (python recomp/recomp.py gen --hooks {address:#x})"));
        }
        unsafe { (self.lib.rt_watch_set)(key, 1) };
        Ok(())
    }

    fn unwatch(&mut self, address: u32) {
        unsafe { (self.lib.rt_watch_set)(address & !1, 0) };
    }

    fn request_stop(&mut self) {
        self.request = true;
    }

    /// `cpu_native.py: module_loaded` : le C recompilé du module est branché si le code en mémoire est exactement celui
    /// pour lequel il a été généré (empreinte du segment de code, mots écrits par ro mis à zéro).
    fn module_loaded(&mut self, name: &str, base: u32, memory: &kernel::memory::AddressSpace) -> bool {
        let mut modules = self.modules.borrow_mut();
        let Some(meta) = modules.meta.get(name) else {
            modules.count("modules non recompilés");
            return false;
        };
        if modules.loaded.contains_key(name) {
            modules.count("modules chargés deux fois (le second reste à unicorn)");
            return false;
        }
        let matches = base & 0xFFF == 0 && {
            match memory.read(base + meta.code_off, meta.code_size) {
                Ok(mut data) => {
                    for &off in &meta.mask {
                        let end = (off as usize + 4).min(data.len());
                        if (off as usize) < end {
                            data[off as usize..end].fill(0);
                        }
                    }
                    overlay::sha1(&data).iter().map(|b| format!("{b:02x}")).collect::<String>() == meta.sha1
                }
                Err(_) => false,
            }
        };
        if !matches {
            modules.count("modules refusés (code différent)");
            return false;
        }
        let (index, end) = (meta.index, base + ((meta.file_size + 0xFFF) & !0xFFF));
        modules.loaded.insert(name.to_string(), (base, end));
        if let Some(set_base) = modules.lib.rt_mod_set_base {
            unsafe { set_base(index, base) };
        }
        modules.count("modules branchés");
        true
    }

    fn module_unloaded(&mut self, name: &str) {
        self.modules.borrow_mut().unload(name);
    }

    fn stats(&self) -> Vec<(String, u64)> {
        let mut out: Vec<(String, u64)> = self.modules.borrow().counts.iter().map(|(k, v)| (k.clone(), *v)).collect();
        out.push(("reprises".into(), self.reprises));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ctx_layout_has_the_expected_size() {
        // 64 (r) + 24 (drapeaux) + 16 + 4 (budget) + 4 (remplissage) + 128 (d) + 2 pointeurs + 2 u32 + fiber + 5 mots + jmp
        let size = std::mem::size_of::<Ctx>();
        assert_eq!(size % 8, 0);
        assert!(size > 300 && size < 400, "taille inattendue {size}");
    }

    #[test]
    fn missing_dll_is_an_error_not_a_panic() {
        let result = NativeCpu::load(Path::new("n/existe/pas.dll"));
        assert!(result.is_err());
    }
}
