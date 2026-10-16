//! De quoi tester le noyau et les services sans code du jeu : un processeur « scénarisé » et quelques aides.
//!
//! `ScriptCpu` n'exécute rien : à chaque `run`, il applique les registres prévus par le scénario puis rend l'arrêt prévu
//! (un appel système, une faute…). Un test fabrique ainsi « un programme » : la suite des appels système d'un fil.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use crate::bench::Paths;
use crate::cpu::{Cpu, CtxId, Reg, Stop};
use crate::ipc::{Request, Reply};
use crate::journal::Journal;
use crate::kernel::Kernel;
use crate::memory::{AddressSpace, PERM_RW};
use crate::names::Names;
use crate::object::ObjId;

/// Un pas du scénario : registres à poser avant, puis ce que `run` rend.
pub struct Step {
    pub regs: Vec<(Reg, u32)>,
    pub stop: Stop,
}

/// Une pile d'appels système à jouer, partagée avec le test (qui peut y ajouter après avoir donné le processeur au noyau).
pub type Script = Rc<RefCell<VecDeque<Step>>>;

#[derive(Clone, Default)]
struct Regs {
    r: [u32; 17],
    tls: u32,
    pc: u32,
    fpscr: u32,
    fpexc: u32,
}

pub struct ScriptCpu {
    contexts: Vec<Regs>,
    cur: Option<CtxId>,
    pub script: Script,
    /// Les registres vus à chaque arrêt (pour les assertions).
    pub watched: Vec<u32>,
}

impl ScriptCpu {
    pub fn new() -> (ScriptCpu, Script) {
        let script: Script = Rc::new(RefCell::new(VecDeque::new()));
        (ScriptCpu { contexts: Vec::new(), cur: None, script: script.clone(), watched: Vec::new() }, script)
    }

    fn index(reg: Reg) -> Option<usize> {
        match reg {
            Reg::R(n) => Some(n as usize),
            Reg::Sp => Some(13),
            Reg::Lr => Some(14),
            Reg::Cpsr => Some(16),
            _ => None,
        }
    }
}

impl Cpu for ScriptCpu {
    fn get(&self, reg: Reg) -> u32 {
        let c = &self.contexts[self.cur.unwrap()];
        match reg {
            Reg::Pc => c.pc,
            Reg::Tls => c.tls,
            Reg::Fpscr => c.fpscr,
            Reg::Fpexc => c.fpexc,
            other => c.r[Self::index(other).unwrap()],
        }
    }

    fn set(&mut self, reg: Reg, value: u32) {
        let c = &mut self.contexts[self.cur.unwrap()];
        match reg {
            Reg::Pc => c.pc = value,
            Reg::Tls => c.tls = value,
            Reg::Fpscr => c.fpscr = value,
            Reg::Fpexc => c.fpexc = value,
            other => c.r[Self::index(other).unwrap()] = value,
        }
    }

    fn new_context(&mut self, pc: u32, sp: u32, r0: u32, tls: u32, _thumb: bool) -> CtxId {
        let mut regs = Regs { pc, tls, ..Regs::default() };
        regs.r[0] = r0;
        regs.r[13] = sp;
        self.contexts.push(regs);
        self.contexts.len() - 1
    }

    fn save(&mut self) -> Option<CtxId> {
        self.cur
    }

    fn restore(&mut self, ctx: CtxId) {
        self.cur = Some(ctx);
    }

    fn run(&mut self, _max: u64) -> Stop {
        let step = self.script.borrow_mut().pop_front();
        match step {
            Some(step) => {
                for (reg, value) in step.regs {
                    self.set(reg, value);
                }
                if let Stop::Svc { pc, .. } = &step.stop {
                    self.set(Reg::Pc, *pc);
                }
                step.stop
            }
            None => Stop::Fault { address: 0, detail: "fin du scénario".into() },
        }
    }

    fn resume(&mut self) -> Stop {
        self.run(0)
    }

    fn watch(&mut self, _address: u32) -> Result<(), String> {
        Ok(())
    }

    fn unwatch(&mut self, _address: u32) {}
}

/// Un noyau de test : processeur scénarisé, journal en mémoire, la page des stockages locaux projetée.
pub fn test_kernel() -> (Kernel, Script) {
    let (cpu, script) = ScriptCpu::new();
    let journal = Journal::in_memory(Names::empty());
    let mut kernel = Kernel::new(AddressSpace::new(), Box::new(cpu), journal);
    kernel.bench.paths = Paths::default();
    (kernel, script)
}

/// Fabrique un fil « principal » prêt, chargé dans le processeur, et rend son identifiant d'objet. Sa pile est projetée.
pub fn test_main_thread(k: &mut Kernel) -> ObjId {
    if !k.memory.is_mapped(0x0FF0_0000, 1) {
        k.memory.map(0x0FF0_0000, 0x10_0000, PERM_RW, "pile du fil principal", None).unwrap();
    }
    let t = k.create_thread(0x10_0000, 0, 0x1000_0000, 0x30, 0, "principal");
    k.switch_to(t);
    t
}

/// Envoie une requête IPC au service derrière la session `session` depuis le fil `thread` : écrit `words` dans le tampon
/// de commandes (les éventuels tampons de réception sont à poser à `tls + 0x180` par le test), traite la requête comme
/// `SendSyncRequest` et rend la réponse lue dans le tampon.
pub fn call(k: &mut Kernel, thread: ObjId, session: ObjId, words: &[u32]) -> Vec<u32> {
    let tls = k.thread(thread).tls;
    let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
    k.memory.write(tls + 0x80, &bytes).unwrap();
    crate::ipc::dispatch(k, thread, session);
    let header = k.memory.u32(tls + 0x80).unwrap();
    let count = 1 + (header >> 6 & 0x3F) + (header & 0x3F);
    k.memory.words(tls + 0x80, count as usize).unwrap()
}

/// `call` mais en construisant la requête et en rendant aussi la `Reply` n'est pas possible depuis l'extérieur : les
/// tests lisent donc le tampon. Cette aide ne fait que fabriquer l'en-tête `commande << 16 | normaux << 6 | traduits`.
pub fn header(command: u32, normal: u32, translate: u32) -> u32 {
    command << 16 | normal << 6 | translate
}

/// Pour les tests de services qui veulent une requête sans passer par le tampon de commandes.
pub fn make_request(k: &mut Kernel, thread: ObjId, session: ObjId, words: &[u32]) -> Request {
    let tls = k.thread(thread).tls;
    let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
    k.memory.write(tls + 0x80, &bytes).unwrap();
    Request::parse(k, thread, session)
}

pub fn reply_result(reply: &Reply) -> u32 {
    reply.result
}
