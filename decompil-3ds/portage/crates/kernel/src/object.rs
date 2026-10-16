//! Les objets du noyau (kernel11.md, partie 4) : événements, sémaphores, mutex, minuteries, arbitres, blocs de mémoire
//! partagée, processus, sessions, fils. Même rôle que les classes de `banc/kernel.py`.
//!
//! Les objets vivent dans une table du noyau (`Kernel::objects`) et se désignent par un `ObjId` (l'indice). Le numéro de
//! série `serial` est donné dans l'ordre de création, exactement comme le banc : il apparaît dans le journal
//! (`événement#42`), donc l'ordre de création des objets doit être le même.

use std::cell::RefCell;
use std::rc::Rc;

use crate::cpu::{CtxId, Reg};
use crate::ipc::Service;
use crate::kernel::Kernel;
use crate::memory::{Backing, align_up};

pub type ObjId = usize;

pub type SharedService = Rc<RefCell<dyn Service>>;

/// Rappel quand le jeu déclenche un événement (les services du banc s'y accrochent).
pub type EventListener = Rc<dyn Fn(&mut Kernel, ObjId)>;

pub const RESET_ONESHOT: u32 = 0;
pub const RESET_STICKY: u32 = 1;
pub const RESET_PULSE: u32 = 2;

pub struct EventObj {
    pub reset_type: u32,
    pub signaled: bool,
    pub listeners: Vec<EventListener>,
    pub signal_count: u64,
}

pub struct SemaphoreObj {
    pub count: u32,
    pub maximum: u32,
}

pub struct MutexObj {
    pub owner: Option<ObjId>,
    pub depth: u32,
}

pub struct TimerObj {
    pub reset_type: u32,
    pub signaled: bool,
    /// Le jeton de la dernière armée : une échéance d'un jeton périmé ne fait rien.
    pub token: Option<u64>,
}

/// Un bloc de mémoire partagée. `address` : là où il se projette quand on demande l'adresse 0.
pub struct SharedMemory {
    pub size: u32,
    pub backing: Rc<Backing>,
    pub offset: usize,
    pub address: u32,
    pub mappings: Vec<u32>,
}

impl SharedMemory {
    pub fn read(&self, offset: usize, size: usize) -> Vec<u8> {
        self.backing.read(self.offset + offset, size)
    }

    pub fn write(&self, offset: usize, data: &[u8]) {
        self.backing.write(self.offset + offset, data);
    }

    pub fn u8(&self, offset: usize) -> u8 {
        self.backing.u8(self.offset + offset)
    }

    pub fn u32(&self, offset: usize) -> u32 {
        self.backing.u32(self.offset + offset)
    }

    pub fn w32(&self, offset: usize, value: u32) {
        self.backing.w32(self.offset + offset, value);
    }

    pub fn aligned_size(size: u32) -> u32 {
        align_up(size)
    }
}

/// Le bout client d'une session : `handler` est l'objet qui répond (un service du banc).
pub struct ClientSession {
    pub handler: SharedService,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ThreadState {
    Ready,
    Waiting,
    Dead,
}

impl ThreadState {
    pub fn text(self) -> &'static str {
        match self {
            ThreadState::Ready => "prêt",
            ThreadState::Waiting => "attend",
            ThreadState::Dead => "fini",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WaitKind {
    Sync,
    Arbiter,
    Sleep,
}

/// Une attente : sur des objets (tous ou un seul), sur une adresse (arbitre), ou un simple sommeil.
#[derive(Clone, Debug)]
pub struct Wait {
    pub id: u64,
    pub kind: WaitKind,
    pub objects: Vec<ObjId>,
    pub wait_all: bool,
    pub deadline: Option<u64>,
    pub address: u32,
    pub arbiter: Option<ObjId>,
    pub what: String,
    pub since: u64,
}

impl Wait {
    pub fn new(kind: WaitKind) -> Wait {
        Wait { id: 0, kind, objects: Vec::new(), wait_all: false, deadline: None, address: 0, arbiter: None,
            what: String::new(), since: 0 }
    }
}

pub struct Thread {
    pub thread_id: u32,
    pub entry: u32,
    pub priority: u32,
    pub core: i32,
    pub tls: u32,
    pub stack_top: u32,
    pub state: ThreadState,
    pub context: Option<CtxId>,
    /// Registres à écrire quand le fil reprendra.
    pub pending: Vec<(Reg, u32)>,
    pub wait: Option<Wait>,
    pub ready_since: u64,
    pub svc_count: u64,
    pub created_at: u64,
}

pub enum Obj {
    Event(EventObj),
    Semaphore(SemaphoreObj),
    Mutex(MutexObj),
    Timer(TimerObj),
    Arbiter,
    ResourceLimit,
    Shared(SharedMemory),
    Process { pid: u32 },
    Session(ClientSession),
    Thread(Thread),
}

pub struct KObject {
    pub serial: u64,
    pub name: String,
    pub data: Obj,
}

impl KObject {
    pub fn kind_name(&self) -> &'static str {
        match self.data {
            Obj::Event(_) => "événement",
            Obj::Semaphore(_) => "sémaphore",
            Obj::Mutex(_) => "mutex",
            Obj::Timer(_) => "minuterie",
            Obj::Arbiter => "arbitre",
            Obj::ResourceLimit => "limite",
            Obj::Shared(_) => "mémoire partagée",
            Obj::Process { .. } => "processus",
            Obj::Session(_) => "session",
            Obj::Thread(_) => "fil",
        }
    }

    /// `événement#42` ou `fil#13 « principal »`.
    pub fn label(&self) -> String {
        if self.name.is_empty() {
            format!("{}#{}", self.kind_name(), self.serial)
        } else {
            format!("{}#{} « {} »", self.kind_name(), self.serial, self.name)
        }
    }

    pub fn waitable(&self) -> bool {
        matches!(self.data, Obj::Event(_) | Obj::Semaphore(_) | Obj::Mutex(_) | Obj::Timer(_) | Obj::Thread(_))
    }
}
