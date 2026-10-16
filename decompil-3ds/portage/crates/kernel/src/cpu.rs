//! Ce que le noyau attend d'un processeur : une interface étroite (même rôle que `banc/cpu.py`).
//!
//! Le noyau et les services ne parlent qu'à ce trait. Il sait : lire et écrire les registres du fil en cours, garder et
//! reprendre l'état d'un fil (`save`, `restore`, `new_context`), faire avancer le fil en cours jusqu'à un appel système,
//! un repère, une faute ou un nombre d'instructions (`run`).
//!
//! Les repères (`watch`) sont servis par le noyau, pas par le processeur : `run` rend `Stop::Hook` ; le noyau appelle ses
//! rappels puis `resume`, qui continue la même tranche avec le budget qu'il restait (c'est ce que fait la boucle de
//! `NativeCpu.run` du banc).

/// Un registre, tel que le noyau le demande.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Reg {
    R(u8),
    Sp,
    Lr,
    Pc,
    Cpsr,
    Tls,
    Fpscr,
    Fpexc,
}

pub const R0: Reg = Reg::R(0);
pub const R1: Reg = Reg::R(1);
pub const R2: Reg = Reg::R(2);
pub const R3: Reg = Reg::R(3);
pub const R4: Reg = Reg::R(4);
pub const R5: Reg = Reg::R(5);
pub const R6: Reg = Reg::R(6);
pub const R12: Reg = Reg::R(12);

impl Reg {
    pub fn name(self) -> String {
        match self {
            Reg::R(n) => format!("r{n}"),
            Reg::Sp => "sp".into(),
            Reg::Lr => "lr".into(),
            Reg::Pc => "pc".into(),
            Reg::Cpsr => "cpsr".into(),
            Reg::Tls => "tls".into(),
            Reg::Fpscr => "fpscr".into(),
            Reg::Fpexc => "fpexc".into(),
        }
    }
}

/// Les registres de la ligne « registres du fil » du journal, dans l'ordre de `cpu.REGISTERS`.
pub const DUMP_REGISTERS: [Reg; 17] = [
    Reg::R(0), Reg::R(1), Reg::R(2), Reg::R(3), Reg::R(4), Reg::R(5), Reg::R(6), Reg::R(7), Reg::R(8), Reg::R(9),
    Reg::R(10), Reg::R(11), Reg::R(12), Reg::Sp, Reg::Lr, Reg::Pc, Reg::Cpsr,
];

/// Un contexte de fil rangé dans le processeur.
pub type CtxId = usize;

/// Pourquoi `run` a rendu la main.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Stop {
    /// Un appel système : `pc` est déjà après l'instruction.
    Svc { number: u32, pc: u32 },
    /// Le nombre d'instructions demandé est atteint.
    Limit { pc: u32 },
    /// Une faute : `detail` dit laquelle, `address` où.
    Fault { address: u32, detail: String },
    /// Un repère est atteint (voir `Cpu::watch`) : le noyau le sert, puis appelle `resume`.
    Hook { pc: u32 },
    /// Le noyau a demandé l'arrêt.
    Request,
}

pub trait Cpu {
    fn get(&self, reg: Reg) -> u32;
    fn set(&mut self, reg: Reg, value: u32);

    /// Un état neuf de fil, à reprendre par `restore`.
    fn new_context(&mut self, pc: u32, sp: u32, r0: u32, tls: u32, thumb: bool) -> CtxId;
    /// Le contexte en cours (rien n'est copié : le fil reste « chargé » dans le processeur).
    fn save(&mut self) -> Option<CtxId>;
    fn restore(&mut self, ctx: CtxId);

    /// Fait tourner le fil en cours pendant au plus `max_instructions` instructions comptées comme le banc.
    fn run(&mut self, max_instructions: u64) -> Stop;
    /// Continue la tranche interrompue par `Stop::Hook`, avec le budget qui restait.
    fn resume(&mut self) -> Stop;

    /// Oublie ce qui a été traduit d'une plage de code réécrite (sans objet pour le code recompilé).
    fn invalidate(&mut self, _start: u32, _size: u32) {}

    /// Arme un repère à cette adresse ; erreur si le processeur ne peut pas en poser un là.
    fn watch(&mut self, address: u32) -> Result<(), String>;
    fn unwatch(&mut self, address: u32);

    fn request_stop(&mut self) {}

    /// Le chargeur de modules vient de finir de charger `name` à `base` : si le processeur a le C recompilé de ce module
    /// pour ce code exact, les sauts vers ce code vont au natif. Rend vrai si le module est branché.
    fn module_loaded(&mut self, _name: &str, _base: u32, _memory: &crate::memory::AddressSpace) -> bool {
        false
    }

    /// Le module part : plus aucun saut ne doit aller à son code recompilé.
    fn module_unloaded(&mut self, _name: &str) {}

    /// Compteurs propres au processeur, pour le résumé (modules branchés, etc.).
    fn stats(&self) -> Vec<(String, u64)> {
        Vec::new()
    }
}
