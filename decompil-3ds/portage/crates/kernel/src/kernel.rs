//! Le noyau : ce que kernel11 fait pour un jeu (fiches/kernel11.md), réécrit en Rust d'après `banc/kernel.py`.
//!
//! Il tient les objets (événements, mutex, sémaphores, minuteries, arbitres, fils, blocs partagés, sessions), la table des
//! poignées du processus, la mémoire (`ControlMemory`, `MapMemoryBlock`), les fils et leur ordonnancement, l'horloge, et
//! répond aux appels système (`svc.rs`). Il ne connaît le processeur que par le trait `Cpu`.
//!
//! L'horloge est celle du banc, pas celle du PC : elle avance d'un coût fixe à chaque appel système et à chaque tranche
//! d'instructions, et saute à la prochaine échéance (réveil, minuterie, fin d'image) quand plus aucun fil n'est prêt. Une
//! exécution est donc reproductible, et identique à celle du banc Python : mêmes règles, mêmes constantes.
//!
//! L'ordonnanceur : le fil prêt le plus prioritaire tourne (nombre le plus petit) ; un fil plus prioritaire qui devient prêt
//! prend la place à la sortie de l'appel système suivant. Au bout d'une tranche d'instructions, le fil qui attend depuis le
//! plus longtemps passe, quelle que soit sa priorité : c'est ce qui tient lieu des deux cœurs de la console.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::rc::Rc;

use crate::bench::BenchState;
use crate::cpu::{Cpu, CtxId, DUMP_REGISTERS, Reg, Stop};
use crate::journal::Journal;
use crate::memory::{AddressSpace, Backing, MemError, PAGE, PERM_RW};
use crate::object::*;

// --- codes de résultat (kernel11.md, parties 3 et 7) ---
pub const OK: u32 = 0;
pub const TIMEOUT: u32 = 0x0940_1BFE;
pub const ERR_INVALID_HANDLE: u32 = 0xD8E0_07F7;
pub const ERR_INVALID_ADDRESS: u32 = 0xE0E0_1BF5;
pub const ERR_MISALIGNED_ADDRESS: u32 = 0xE0E0_1BF1;
pub const ERR_MISALIGNED_SIZE: u32 = 0xE0E0_1BF2;
pub const ERR_INVALID_ENUM: u32 = 0xE0E0_1BEE;
pub const ERR_OUT_OF_RANGE: u32 = 0xE0E0_1BFD;
pub const ERR_NOT_IMPLEMENTED: u32 = 0xF8C0_07F4;
pub const ERR_UNKNOWN_INFO: u32 = 0xD8E0_07ED;
pub const ERR_PORT_NOT_FOUND: u32 = 0xD880_07FA;
pub const ERR_NOT_OWNER: u32 = 0xD8E0_041F;
pub const ERR_INVALID_COMBINATION: u32 = 0xD8E0_07FD;
pub const ERR_SESSION_CLOSED: u32 = 0xC920_181A;

pub const PSEUDO_THREAD: u32 = 0xFFFF_8000;
pub const PSEUDO_PROCESS: u32 = 0xFFFF_8001;

// --- plan mémoire d'une application (kernel11.md, partie 6) ---
pub const HEAP_BASE: u32 = 0x0800_0000;
pub const HEAP_END: u32 = 0x1000_0000;
pub const LINEAR_BASE: u32 = 0x1400_0000;
pub const LINEAR_END: u32 = 0x1C00_0000;
pub const TLS_BASE: u32 = 0x1FF8_2000;
pub const TLS_SLOT: u32 = 0x200;
pub const CONFIG_PAGE: u32 = 0x1FF8_0000;
pub const SHARED_PAGE: u32 = 0x1FF8_1000;

pub const TICKS_PER_SECOND: u64 = 268_111_856;

// --- temps du banc ---
pub const SLICE_INSTRUCTIONS: u64 = 200_000;
/// Un peu plus que 1 / 268 MHz : le banc n'a pas le pipeline de la console.
pub const NS_PER_INSTRUCTION: u64 = 4;
pub const SVC_COST_NS: u64 = 2000;

/// Le banc s'arrête : `reason` dit pourquoi, en français.
#[derive(Debug, Clone)]
pub struct Stopped(pub String);

impl fmt::Display for Stopped {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Ce qu'un gestionnaire d'appel système peut lever.
pub enum SvcError {
    Stopped(Stopped),
    Memory(MemError),
}

impl From<Stopped> for SvcError {
    fn from(s: Stopped) -> Self {
        SvcError::Stopped(s)
    }
}

impl From<MemError> for SvcError {
    fn from(m: MemError) -> Self {
        SvcError::Memory(m)
    }
}

/// Ce que le gestionnaire d'un appel système rend pour le journal (`False`, `None`, texte du banc).
pub enum Summary {
    /// `False` : rien dans le journal.
    Skip,
    /// `None` : le résumé par défaut (r0 et r1, ou ce que le fil attend).
    Default,
    Text(String),
}

pub type SvcResult = Result<Summary, SvcError>;

/// La table des poignées du processus.
pub struct HandleTable {
    pub size: u32,
    pub entries: BTreeMap<u32, (u32, ObjId)>,
    pub counter: u32,
}

impl HandleTable {
    pub fn new() -> HandleTable {
        HandleTable { size: 512, entries: BTreeMap::new(), counter: 0 }
    }

    pub fn add(&mut self, obj: ObjId) -> Result<u32, Stopped> {
        let mut index = 0;
        loop {
            if index >= self.size {
                return Err(Stopped(format!("table des poignées pleine ({})", self.size)));
            }
            if !self.entries.contains_key(&index) {
                break;
            }
            index += 1;
        }
        self.counter = if self.counter < 0x7FFF { self.counter + 1 } else { 1 };
        self.entries.insert(index, (self.counter, obj));
        Ok(index | self.counter << 15)
    }

    pub fn get(&self, handle: u32) -> Option<ObjId> {
        let entry = self.entries.get(&(handle & 0x7FFF))?;
        if entry.0 != handle >> 15 & 0x7FFF || handle >> 30 != 0 {
            return None;
        }
        Some(entry.1)
    }

    pub fn remove(&mut self, handle: u32) -> Option<ObjId> {
        let obj = self.get(handle)?;
        self.entries.remove(&(handle & 0x7FFF));
        Some(obj)
    }

    pub fn handles_of(&self, obj: ObjId) -> Vec<u32> {
        self.entries.iter().filter(|(_, (_, o))| *o == obj).map(|(index, (counter, _))| index | counter << 15).collect()
    }
}

impl Default for HandleTable {
    fn default() -> Self {
        HandleTable::new()
    }
}

pub type Callback = Box<dyn FnOnce(&mut Kernel)>;
pub type WatchCallback = Rc<dyn Fn(&mut Kernel, u32)>;

pub struct Watcher {
    pub once: bool,
    pub callback: WatchCallback,
}

pub struct Kernel {
    pub memory: AddressSpace,
    pub cpu: Box<dyn Cpu>,
    pub journal: Journal,
    /// Nanosecondes du banc.
    pub now: u64,
    events: BTreeMap<(u64, u64), Callback>,
    event_order: u64,
    serials: u64,
    pub objects: Vec<KObject>,
    pub handles: HandleTable,
    pub process: ObjId,
    pub resource_limit: ObjId,
    pub threads: Vec<ObjId>,
    thread_ids: u32,
    /// Le fil dont le contexte est dans le processeur.
    pub loaded: Option<ObjId>,
    /// Le fil qui tourne.
    pub current: Option<ObjId>,
    ready_order: u64,
    wait_ids: u64,
    pub timer_tokens: u64,
    pub tls_used: BTreeSet<u32>,
    /// nom de port -> service
    pub ports: HashMap<String, SharedService>,
    /// nom du service -> service (pour `srv:`)
    pub services: HashMap<String, SharedService>,
    /// Fabrique des services que le banc ne connaît pas (factices).
    pub service_factory: Option<Box<dyn Fn(&mut Kernel, &str) -> SharedService>>,
    pub heap_backing: Rc<Backing>,
    pub linear_backing: Rc<Backing>,
    /// APPMEMALLOC d'un titre de l'ancienne 3DS (64 Mo).
    pub app_memory: u32,
    pub code_size: u32,
    pub watchers: HashMap<u32, Vec<Watcher>>,
    pub stop_reason: Option<String>,
    pub svc_counts: BTreeMap<u32, u64>,
    pub log_all_svc: bool,
    /// Une erreur fatale levée hors d'un appel système (table des poignées pleine dans une réponse IPC, par exemple).
    pub fatal: Option<Stopped>,
    pub bench: BenchState,
}

impl Kernel {
    pub fn new(memory: AddressSpace, cpu: Box<dyn Cpu>, journal: Journal) -> Kernel {
        let mut kernel = Kernel {
            memory,
            cpu,
            journal,
            now: 0,
            events: BTreeMap::new(),
            event_order: 0,
            serials: 0,
            objects: Vec::new(),
            handles: HandleTable::new(),
            process: 0,
            resource_limit: 0,
            threads: Vec::new(),
            thread_ids: 0x40,
            loaded: None,
            current: None,
            ready_order: 0,
            wait_ids: 0,
            timer_tokens: 0,
            tls_used: BTreeSet::new(),
            ports: HashMap::new(),
            services: HashMap::new(),
            service_factory: None,
            heap_backing: Backing::new(HEAP_END - HEAP_BASE, "tas"),
            linear_backing: Backing::new(LINEAR_END - LINEAR_BASE, "tas linéaire"),
            app_memory: 0x0400_0000,
            code_size: 0,
            watchers: HashMap::new(),
            stop_reason: None,
            svc_counts: BTreeMap::new(),
            log_all_svc: true,
            fatal: None,
            bench: BenchState::default(),
        };
        // L'ordre de création fixe les numéros de série du journal : processus, puis limite de ressources.
        kernel.process = kernel.new_object("Pokémon X", Obj::Process { pid: 0x30 });
        kernel.resource_limit = kernel.new_object("application", Obj::ResourceLimit);
        kernel
    }

    // --- objets ---

    pub fn new_object(&mut self, name: &str, data: Obj) -> ObjId {
        self.serials += 1;
        self.objects.push(KObject { serial: self.serials, name: name.to_string(), data });
        self.objects.len() - 1
    }

    pub fn label(&self, id: ObjId) -> String {
        self.objects[id].label()
    }

    pub fn process_pid(&self) -> u32 {
        match self.objects[self.process].data {
            Obj::Process { pid } => pid,
            _ => 0,
        }
    }

    pub fn create_event(&mut self, reset_type: u32, name: &str) -> ObjId {
        self.new_object(name, Obj::Event(EventObj { reset_type, signaled: false, listeners: Vec::new(), signal_count: 0 }))
    }

    pub fn create_semaphore(&mut self, count: u32, maximum: u32, name: &str) -> ObjId {
        self.new_object(name, Obj::Semaphore(SemaphoreObj { count, maximum }))
    }

    pub fn create_mutex(&mut self, owner: Option<ObjId>, name: &str) -> ObjId {
        self.new_object(name, Obj::Mutex(MutexObj { owner, depth: if owner.is_some() { 1 } else { 0 } }))
    }

    pub fn create_timer(&mut self, reset_type: u32) -> ObjId {
        self.new_object("", Obj::Timer(TimerObj { reset_type, signaled: false, token: None }))
    }

    /// Un bloc de mémoire partagée. Sans réserve donnée, une réserve neuve est créée.
    pub fn create_shared(&mut self, size: u32, backing: Option<(Rc<Backing>, usize)>, address: u32, name: &str) -> ObjId {
        let size = crate::memory::align_up(size);
        let (backing, offset) = backing.unwrap_or_else(|| (Backing::new(size, name), 0));
        self.new_object(name, Obj::Shared(SharedMemory { size, backing, offset, address, mappings: Vec::new() }))
    }

    pub fn event(&self, id: ObjId) -> &EventObj {
        match &self.objects[id].data {
            Obj::Event(e) => e,
            _ => panic!("{} n'est pas un événement", self.label(id)),
        }
    }

    pub fn event_mut(&mut self, id: ObjId) -> &mut EventObj {
        match &mut self.objects[id].data {
            Obj::Event(e) => e,
            _ => panic!("pas un événement"),
        }
    }

    pub fn semaphore_mut(&mut self, id: ObjId) -> &mut SemaphoreObj {
        match &mut self.objects[id].data {
            Obj::Semaphore(s) => s,
            _ => panic!("pas un sémaphore"),
        }
    }

    pub fn shared(&self, id: ObjId) -> &SharedMemory {
        match &self.objects[id].data {
            Obj::Shared(s) => s,
            _ => panic!("{} n'est pas un bloc partagé", self.label(id)),
        }
    }

    pub fn shared_mut(&mut self, id: ObjId) -> &mut SharedMemory {
        match &mut self.objects[id].data {
            Obj::Shared(s) => s,
            _ => panic!("pas un bloc partagé"),
        }
    }

    pub fn thread(&self, id: ObjId) -> &Thread {
        match &self.objects[id].data {
            Obj::Thread(t) => t,
            _ => panic!("{} n'est pas un fil", self.label(id)),
        }
    }

    pub fn thread_mut(&mut self, id: ObjId) -> &mut Thread {
        match &mut self.objects[id].data {
            Obj::Thread(t) => t,
            _ => panic!("pas un fil"),
        }
    }

    pub fn is_thread(&self, id: ObjId) -> bool {
        matches!(self.objects[id].data, Obj::Thread(_))
    }

    /// Accroche un rappel à un événement (`Event.listeners` du banc).
    pub fn add_event_listener(&mut self, id: ObjId, listener: EventListener) {
        self.event_mut(id).listeners.push(listener);
    }

    /// `Event.signal` : le jeu déclenche l'événement.
    pub fn signal_event(&mut self, id: ObjId) {
        let listeners = {
            let e = self.event_mut(id);
            e.signal_count += 1;
            e.signaled = true;
            e.listeners.clone()
        };
        for listener in listeners {
            listener(self, id);
        }
        self.wake_waiters();
        let e = self.event_mut(id);
        if e.reset_type == RESET_PULSE {
            e.signaled = false;
        }
    }

    // --- échéances ---

    pub fn schedule(&mut self, when: u64, callback: Callback) {
        self.event_order += 1;
        self.events.insert((when, self.event_order), callback);
    }

    pub fn run_due_events(&mut self) {
        loop {
            let Some((&key, _)) = self.events.iter().next() else { break };
            if key.0 > self.now {
                break;
            }
            let callback = self.events.remove(&key).unwrap();
            callback(self);
        }
    }

    pub fn next_event_time(&self) -> Option<u64> {
        self.events.keys().next().map(|k| k.0)
    }

    pub fn ticks(&self) -> u64 {
        (self.now as u128 * TICKS_PER_SECOND as u128 / 1_000_000_000) as u64
    }

    // --- poignées ---

    pub fn add_handle(&mut self, obj: ObjId) -> Option<u32> {
        match self.handles.add(obj) {
            Ok(h) => Some(h),
            Err(stopped) => {
                if self.fatal.is_none() {
                    self.fatal = Some(stopped);
                }
                None
            }
        }
    }

    pub fn lookup(&self, handle: u32, thread: Option<ObjId>) -> Option<ObjId> {
        if handle == PSEUDO_THREAD {
            return thread.or(self.current);
        }
        if handle == PSEUDO_PROCESS {
            return Some(self.process);
        }
        self.handles.get(handle)
    }

    /// Un service par son nom (le registre de `srv:`) ; un nom inconnu reçoit un service factice.
    pub fn service_for(&mut self, name: &str) -> SharedService {
        if let Some(service) = self.services.get(name) {
            return service.clone();
        }
        let factory = self.service_factory.take().expect("pas de fabrique de services factices");
        let service = factory(self, name);
        self.service_factory = Some(factory);
        self.services.insert(name.to_string(), service.clone());
        service
    }

    /// `Service.session` : une nouvelle session vers ce service (le bout client, à mettre dans la table des poignées).
    pub fn new_session(&mut self, handler: SharedService, name: &str) -> ObjId {
        self.new_object(name, Obj::Session(ClientSession { handler }))
    }

    // --- fils ---

    pub fn allocate_tls(&mut self) -> u32 {
        let mut slot = 0;
        while self.tls_used.contains(&slot) {
            slot += 1;
        }
        self.tls_used.insert(slot);
        let address = TLS_BASE + slot * TLS_SLOT;
        let page = address & !(PAGE - 1);
        if !self.memory.is_mapped(page, 1) {
            let _ = self.memory.map(page, PAGE, PERM_RW, "stockage local des fils", None);
        }
        let _ = self.memory.fill(address, TLS_SLOT, 0);
        address
    }

    pub fn create_thread(&mut self, entry: u32, arg: u32, stack_top: u32, priority: u32, core: i32, name: &str) -> ObjId {
        let tls = self.allocate_tls();
        let thread_id = self.thread_ids;
        self.thread_ids += 1;
        let created_at = self.now;
        let id = self.new_object(name, Obj::Thread(Thread {
            thread_id,
            entry,
            priority,
            core,
            tls,
            stack_top,
            state: ThreadState::Ready,
            context: None,
            pending: Vec::new(),
            wait: None,
            ready_since: 0,
            svc_count: 0,
            created_at,
        }));
        let saved = if self.loaded.is_some() { self.cpu.save() } else { None };
        let context = self.cpu.new_context(entry, stack_top, arg, tls, entry & 1 != 0);
        if let Some(saved) = saved {
            self.cpu.restore(saved);
        }
        self.ready_order += 1;
        let ready = self.ready_order - 1;
        let thread = self.thread_mut(id);
        thread.context = Some(context);
        thread.ready_since = ready;
        self.threads.push(id);
        id
    }

    pub fn take_ready_order(&mut self) -> u64 {
        self.next_ready()
    }

    fn next_ready(&mut self) -> u64 {
        let n = self.ready_order;
        self.ready_order += 1;
        n
    }

    pub fn make_ready(&mut self, thread: ObjId, result_regs: &[(Reg, u32)]) {
        let ready = self.next_ready();
        let t = self.thread_mut(thread);
        t.state = ThreadState::Ready;
        t.wait = None;
        for &(reg, value) in result_regs {
            if let Some(slot) = t.pending.iter_mut().find(|(r, _)| *r == reg) {
                slot.1 = value;
            } else {
                t.pending.push((reg, value));
            }
        }
        t.ready_since = ready;
    }

    pub fn block(&mut self, thread: ObjId, mut wait: Wait) {
        self.wait_ids += 1;
        wait.id = self.wait_ids;
        wait.since = self.now;
        let (deadline, wait_id) = (wait.deadline, wait.id);
        let t = self.thread_mut(thread);
        t.state = ThreadState::Waiting;
        t.wait = Some(wait);
        if let Some(deadline) = deadline {
            self.schedule(deadline, Box::new(move |k: &mut Kernel| k.timeout(thread, wait_id)));
        }
    }

    fn timeout(&mut self, thread: ObjId, wait_id: u64) {
        let t = self.thread(thread);
        let Some(wait) = &t.wait else { return };
        if wait.id != wait_id || t.state != ThreadState::Waiting {
            return;
        }
        if wait.kind == WaitKind::Sleep {
            self.make_ready(thread, &[(crate::cpu::R0, OK)]);
        } else {
            self.make_ready(thread, &[(crate::cpu::R0, TIMEOUT)]);
        }
    }

    /// `KObject.is_free`.
    pub fn is_free(&self, obj: ObjId, thread: ObjId) -> bool {
        match &self.objects[obj].data {
            Obj::Event(e) => e.signaled,
            Obj::Semaphore(s) => s.count > 0,
            Obj::Mutex(m) => m.owner.is_none() || m.owner == Some(thread),
            Obj::Timer(t) => t.signaled,
            Obj::Thread(t) => t.state == ThreadState::Dead,
            _ => false,
        }
    }

    /// `KObject.acquire`.
    pub fn acquire(&mut self, obj: ObjId, thread: ObjId) {
        match &mut self.objects[obj].data {
            Obj::Event(e) => {
                if e.reset_type == RESET_ONESHOT {
                    e.signaled = false;
                }
            }
            Obj::Semaphore(s) => s.count -= 1,
            Obj::Mutex(m) => {
                m.owner = Some(thread);
                m.depth += 1;
            }
            Obj::Timer(t) => {
                if t.reset_type == RESET_ONESHOT {
                    t.signaled = false;
                }
            }
            _ => {}
        }
    }

    /// Sert, du plus prioritaire au moins prioritaire, chaque fil dont l'attente peut être satisfaite.
    pub fn wake_waiters(&mut self) {
        loop {
            let mut waiting: Vec<ObjId> = self
                .threads
                .iter()
                .copied()
                .filter(|&t| {
                    let th = self.thread(t);
                    th.state == ThreadState::Waiting && th.wait.as_ref().is_some_and(|w| w.kind == WaitKind::Sync)
                })
                .collect();
            waiting.sort_by_key(|&t| (self.thread(t).priority, self.thread(t).ready_since));
            let mut progress = false;
            for thread in waiting {
                let wait = self.thread(thread).wait.clone().unwrap();
                if wait.wait_all {
                    if wait.objects.iter().all(|&o| self.is_free(o, thread)) {
                        for &o in &wait.objects {
                            self.acquire(o, thread);
                        }
                        self.make_ready(thread, &[(crate::cpu::R0, OK), (crate::cpu::R1, 0)]);
                        progress = true;
                        break;
                    }
                } else {
                    for (index, &o) in wait.objects.iter().enumerate() {
                        if self.is_free(o, thread) {
                            self.acquire(o, thread);
                            self.make_ready(thread, &[(crate::cpu::R0, OK), (crate::cpu::R1, index as u32)]);
                            progress = true;
                            break;
                        }
                    }
                    if progress {
                        break;
                    }
                }
            }
            if !progress {
                break;
            }
        }
    }

    pub fn ready_threads(&self) -> Vec<ObjId> {
        self.threads.iter().copied().filter(|&t| self.thread(t).state == ThreadState::Ready).collect()
    }

    pub fn pick(&self) -> Option<ObjId> {
        self.ready_threads().into_iter().min_by_key(|&t| (self.thread(t).priority, self.thread(t).ready_since))
    }

    pub fn switch_to(&mut self, thread: ObjId) {
        if self.loaded != Some(thread) {
            if let Some(loaded) = self.loaded {
                if self.thread(loaded).state != ThreadState::Dead {
                    let saved = self.cpu.save();
                    self.thread_mut(loaded).context = saved;
                }
            }
            let context: CtxId = self.thread(thread).context.expect("fil sans contexte");
            self.cpu.restore(context);
            let tls = self.thread(thread).tls;
            self.cpu.set(Reg::Tls, tls);
            self.loaded = Some(thread);
        }
        let pending = std::mem::take(&mut self.thread_mut(thread).pending);
        for (reg, value) in pending {
            self.cpu.set(reg, value);
        }
        self.current = Some(thread);
    }

    // --- repères ---

    /// Pose un repère : `callback(kernel, adresse)` quand un fil exécute cette adresse (une seule fois si `once`).
    pub fn watch(&mut self, address: u32, once: bool, callback: WatchCallback) -> Result<(), String> {
        let key = address & !1;
        self.cpu.watch(key)?;
        self.watchers.entry(key).or_default().push(Watcher { once, callback });
        Ok(())
    }

    fn fire_watchers(&mut self, pc: u32) {
        let key = pc & !1;
        let Some(entries) = self.watchers.get_mut(&key) else { return };
        let mut run = Vec::new();
        entries.retain(|w| {
            run.push(w.callback.clone());
            !w.once
        });
        let empty = entries.is_empty();
        if empty {
            self.watchers.remove(&key);
            self.cpu.unwatch(key);
        }
        for callback in run {
            callback(self, key);
        }
    }

    // --- la boucle ---

    /// Fait tourner le jeu jusqu'à un arrêt. Rend la raison, en français.
    pub fn run(&mut self, limit_ns: u64, should_stop: &mut dyn FnMut(&mut Kernel) -> Option<String>) -> String {
        let reason = match self.run_inner(limit_ns, should_stop) {
            Ok(never) => match never {},
            Err(stopped) => stopped.0,
        };
        self.stop_reason = Some(reason.clone());
        reason
    }

    fn run_inner(&mut self, limit_ns: u64, should_stop: &mut dyn FnMut(&mut Kernel) -> Option<String>)
        -> Result<std::convert::Infallible, Stopped> {
        loop {
            if let Some(fatal) = self.fatal.take() {
                return Err(fatal);
            }
            if self.now >= limit_ns {
                return Err(Stopped(format!("limite de temps du banc atteinte ({:.1} s)", limit_ns as f64 / 1e9)));
            }
            if let Some(reason) = should_stop(self) {
                return Err(Stopped(reason));
            }
            self.run_due_events();
            let mut thread = self.current;
            let runnable = thread.is_some_and(|t| self.thread(t).state == ThreadState::Ready);
            let thread = if !runnable {
                match self.pick() {
                    Some(t) => t,
                    None => {
                        let Some(when) = self.next_event_time() else {
                            return Err(Stopped("plus aucun fil prêt et plus aucune échéance : interblocage".into()));
                        };
                        self.now = self.now.max(when);
                        continue;
                    }
                }
            } else {
                let current = thread.take().unwrap();
                match self.pick() {
                    Some(best) if self.thread(best).priority < self.thread(current).priority => {
                        let ready = self.next_ready();
                        self.thread_mut(current).ready_since = ready;
                        best
                    }
                    _ => current,
                }
            };
            self.switch_to(thread);
            let mut stop = self.cpu.run(SLICE_INSTRUCTIONS);
            while let Stop::Hook { pc } = stop {
                self.fire_watchers(pc);
                stop = self.cpu.resume();
            }
            match stop {
                Stop::Svc { number, .. } => {
                    self.now += SVC_COST_NS;
                    self.handle_svc(thread, number)?;
                }
                Stop::Limit { .. } => {
                    self.now += SLICE_INSTRUCTIONS * NS_PER_INSTRUCTION;
                    let others: Vec<ObjId> = self.ready_threads().into_iter().filter(|&t| t != thread).collect();
                    if !others.is_empty() {
                        let ready = self.next_ready();
                        self.thread_mut(thread).ready_since = ready;
                        self.current = others.into_iter().min_by_key(|&t| self.thread(t).ready_since);
                    }
                }
                Stop::Fault { address, detail } => {
                    self.dump_registers(thread);
                    return Err(Stopped(format!("faute du fil {:#x} à {:#010x} ({}) : {}", self.thread(thread).thread_id,
                        address, self.journal.names.function(address), detail)));
                }
                Stop::Request | Stop::Hook { .. } => {}
            }
        }
    }

    pub fn dump_registers(&mut self, thread: ObjId) {
        let regs: Vec<(Reg, u32)> = DUMP_REGISTERS.iter().map(|&r| (r, self.cpu.get(r))).collect();
        let text = regs.iter().map(|(r, v)| format!("{}={:08x}", r.name(), v)).collect::<Vec<_>>().join(" ");
        let id = self.thread(thread).thread_id;
        let now = self.now;
        self.journal.write(now, &format!("registres du fil {id:#x} : {text}"));
        let sp = self.cpu.get(Reg::Sp);
        if let Ok(stack) = self.memory.words(sp, 16) {
            let line = stack.iter().map(|w| format!("{w:08x}")).collect::<Vec<_>>().join(" ");
            self.journal.write(now, &format!("pile : {line}"));
            let calls: Vec<String> = stack
                .iter()
                .filter(|&&w| (0x10_0000..0x53_F000).contains(&w) && !self.journal.names.function(w).is_empty())
                .map(|&w| format!("{:#x} {}", w, self.journal.names.function(w)))
                .collect();
            self.journal.write(now, &format!("adresses de code sur la pile : {}", calls.join(", ")));
        }
    }

    // --- appels système : voir svc.rs ---

    pub fn arg(&self, reg: Reg) -> u32 {
        self.cpu.get(reg)
    }

    pub fn ret(&mut self, values: &[(Reg, u32)]) {
        for &(reg, value) in values {
            self.cpu.set(reg, value);
        }
    }

    /// Nombre d'octets de tas pris (`committed` du banc).
    pub fn committed(&self) -> u32 {
        self.memory.regions.iter().filter(|r| &*r.name == "tas" || &*r.name == "tas linéaire").map(|r| r.size).sum()
    }

    /// Les fils vivants et leur état, une ligne chacun (pour le résumé).
    pub fn describe_threads(&mut self) -> Vec<String> {
        let mut lines = Vec::new();
        for t in self.threads.clone() {
            let (state, pc_lr) = {
                let th = self.thread(t);
                (th.state, th.context)
            };
            let mut where_ = String::new();
            if state != ThreadState::Dead {
                let (pc, lr) = if self.loaded == Some(t) {
                    (self.cpu.get(Reg::Pc), self.cpu.get(Reg::Lr))
                } else if let Some(ctx) = pc_lr {
                    let saved = self.cpu.save();
                    self.cpu.restore(ctx);
                    let out = (self.cpu.get(Reg::Pc), self.cpu.get(Reg::Lr));
                    if let Some(saved) = saved {
                        self.cpu.restore(saved);
                    }
                    out
                } else {
                    (0, 0)
                };
                where_ = format!("pc {:#010x} {}, lr {:#010x} {}", pc, self.journal.names.function(pc), lr,
                    self.journal.names.function(lr));
            }
            let th = self.thread(t);
            let mut wait = String::new();
            if th.state == ThreadState::Waiting {
                if let Some(w) = &th.wait {
                    wait = format!(" sur {} depuis {:.3} ms", if w.what.is_empty() { "?" } else { &w.what },
                        w.since as f64 / 1e6);
                }
            }
            lines.push(format!("fil {:#x} « {} » priorité {:#x}, entrée {:#x} ({}) : {}{} ; {} ; {} appels système",
                th.thread_id, self.objects[t].name, th.priority, th.entry, self.journal.names.function(th.entry),
                th.state.text(), wait, where_, th.svc_count));
        }
        lines
    }
}
