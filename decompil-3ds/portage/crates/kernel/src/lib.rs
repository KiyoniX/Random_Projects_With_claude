//! Le noyau de la console, réécrit en Rust d'après le banc Python (`banc/kernel.py`, `ipc.py`, `memory.py`).
pub mod bench;
pub mod cpu;
pub mod ipc;
pub mod journal;
pub mod kernel;
pub mod memory;
pub mod names;
pub mod object;
pub mod svc;
pub mod testing;

pub use kernel::Kernel;
