//! `srv:`, le registre des services (contrat des petits services, partie 1 ; fiche sm). Port de `banc/services/srv.py`.
//!
//! Réel : RegisterClient, EnableNotification (un vrai sémaphore, libéré seulement quand une notification est en file),
//! GetServiceHandle (une session neuve vers le service du même nom), Subscribe, ReceiveNotification. Un nom que le banc
//! ne connaît pas reçoit une session vers un service factice, signalée dans le journal.

use std::collections::BTreeSet;

use kernel::ipc::{Reply, Request, Service, error, unknown_command};
use kernel::kernel::Kernel;
use kernel::object::ObjId;

pub struct Srv {
    pub semaphore: Option<ObjId>,
    subscribed: BTreeSet<u32>,
    queue: Vec<u32>,
}

impl Srv {
    pub fn new(_k: &mut Kernel) -> Srv {
        Srv { semaphore: None, subscribed: BTreeSet::new(), queue: Vec::new() }
    }

    fn register_client(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        if req.header != 0x0001_0002 || req.word(1) != 0x20 {
            return error(0xD900_1830, "en-tête ou descripteur inattendu");
        }
        Reply::new(0).with_note(format!("processus {:#x}", k.process_pid()))
    }

    fn enable_notification(&mut self, k: &mut Kernel) -> Reply {
        let semaphore = match self.semaphore {
            Some(s) => s,
            None => {
                let s = k.create_semaphore(0, 16, "notifications de srv:");
                self.semaphore = Some(s);
                s
            }
        };
        Reply::new(0).copy_handles(&[semaphore]).with_note(k.label(semaphore))
    }

    fn get_service_handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        let raw = k.memory.read(req.cmdbuf + 4, 8).unwrap_or_default();
        let length = req.word(3) as usize;
        let slice = &raw[..length.min(8).min(raw.len())];
        let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
        let name: String = slice[..end].iter().map(|&b| b as char).collect();
        let service = k.service_for(&name);
        let (class, kind) = {
            let s = service.borrow();
            (s.class_name(), s.kind())
        };
        let session = k.new_session(service, &name);
        let mut reply = Reply::new(0).move_handles(&[session]);
        reply.note = format!("{name} -> {class} ({kind})");
        reply
    }

    fn subscribe(&mut self, req: &Request) -> Reply {
        let number = req.word(1);
        if self.semaphore.is_none() {
            return error(0xD880_6404, "Subscribe avant EnableNotification");
        }
        if self.subscribed.contains(&number) {
            return Reply::new(0xD900_6403).with_note("déjà inscrit");
        }
        self.subscribed.insert(number);
        Reply::new(0).with_note(format!("notification {number:#x} retenue (le banc n'en publie aucune)"))
    }

    /// Pour simuler une notification (0x209 : carte SD retirée). Le banc ne s'en sert pas par défaut.
    pub fn publish(&mut self, k: &mut Kernel, number: u32) {
        let Some(semaphore) = self.semaphore else { return };
        self.queue.push(number);
        k.semaphore_mut(semaphore).count += 1;
        k.wake_waiters();
    }
}

impl Service for Srv {
    fn name(&self) -> &str {
        "srv:"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        match req.command {
            0x0001 => self.register_client(k, req),
            0x0002 => self.enable_notification(k),
            0x0005 => self.get_service_handle(k, req),
            0x0009 => self.subscribe(req),
            0x000A => {
                self.subscribed.remove(&req.word(1));
                Reply::new(0)
            }
            0x000B => {
                if self.queue.is_empty() {
                    Reply::new(0xD880_6404).with_note("aucune notification en file")
                } else {
                    Reply::with_words(0, &[self.queue.remove(0)])
                }
            }
            0x000C => Reply::new(0),
            _ => unknown_command(),
        }
    }
}
