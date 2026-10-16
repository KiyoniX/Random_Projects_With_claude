//! Les appels système que le jeu fait (fiches/kernel11.md, parties 3 à 7), d'après `Kernel.svc_*` de `banc/kernel.py`.
//!
//! Chaque gestionnaire lit ses arguments dans r0-r5, écrit ses résultats dans r0-r5 et rend le résumé du journal. Les
//! textes sont ceux du banc, mot pour mot : le journal Rust se compare ligne à ligne à celui de Python.

use crate::cpu::{R0, R1, R2, R3, R4, R5, Reg};
use crate::kernel::*;
use crate::memory::{PAGE, PERM_R, PERM_RWX, align_up};
use crate::object::*;

fn text(s: String) -> SvcResult {
    Ok(Summary::Text(s))
}

impl Kernel {
    fn a(&self, reg: Reg) -> u32 {
        self.cpu.get(reg)
    }

    /// Traite l'appel système `number` du fil `thread` (`Kernel.handle_svc`).
    pub fn handle_svc(&mut self, thread: ObjId, number: u32) -> Result<(), Stopped> {
        self.thread_mut(thread).svc_count += 1;
        *self.svc_counts.entry(number).or_insert(0) += 1;
        let pc = self.cpu.get(Reg::Pc).wrapping_sub(4);
        let lr = self.cpu.get(Reg::Lr);
        let thread_id = self.thread(thread).thread_id;
        let result = match number {
            0x01 => self.svc_control_memory(thread),
            0x02 => self.svc_query_memory(thread),
            0x03 => self.svc_exit_process(thread),
            0x08 => self.svc_create_thread(thread),
            0x09 => self.svc_exit_thread(thread),
            0x0A => self.svc_sleep_thread(thread),
            0x0B => self.svc_get_thread_priority(thread),
            0x0C => self.svc_set_thread_priority(thread),
            0x13 => self.svc_create_mutex(thread),
            0x14 => self.svc_release_mutex(thread),
            0x15 => self.svc_create_semaphore(thread),
            0x16 => self.svc_release_semaphore(thread),
            0x17 => self.svc_create_event(thread),
            0x18 => self.svc_signal_event(thread),
            0x19 => self.svc_clear_event(thread),
            0x1A => self.svc_create_timer(thread),
            0x1B => self.svc_set_timer(thread),
            0x1C => self.svc_cancel_timer(thread),
            0x1D => self.svc_clear_timer(thread),
            0x1E => self.svc_create_memory_block(thread),
            0x1F => self.svc_map_memory_block(thread),
            0x20 => self.svc_unmap_memory_block(thread),
            0x21 => self.svc_create_address_arbiter(thread),
            0x22 => self.svc_arbitrate_address(thread),
            0x23 => self.svc_close_handle(thread),
            0x24 => self.svc_wait_synchronization1(thread),
            0x25 => self.svc_wait_synchronization_n(thread),
            0x27 => self.svc_duplicate_handle(thread),
            0x28 => self.svc_get_system_tick(thread),
            0x29 => self.svc_get_handle_info(thread),
            0x2A => self.svc_get_system_info(thread),
            0x2B => self.svc_get_process_info(thread),
            0x2D => self.svc_connect_to_port(thread),
            0x32 => self.svc_send_sync_request(thread),
            0x35 => self.svc_get_process_id(thread),
            0x37 => self.svc_get_thread_id(thread),
            0x38 => self.svc_get_resource_limit(thread),
            0x39 => self.svc_get_resource_limit_values(false),
            0x3A => self.svc_get_resource_limit_values(true),
            0x3C => self.svc_break(thread),
            0x3D => self.svc_output_debug_string(thread),
            _ => {
                self.ret(&[(R0, ERR_NOT_IMPLEMENTED)]);
                let now = self.now;
                self.journal.svc(now, thread_id, number, pc, lr,
                    &format!("pas fait par le banc : rend {ERR_NOT_IMPLEMENTED:#x}"));
                return Ok(());
            }
        };
        let summary = match result {
            Ok(summary) => summary,
            Err(SvcError::Memory(error)) => {
                self.ret(&[(R0, ERR_INVALID_ADDRESS)]);
                Summary::Text(format!("adresse invalide ({error}) : rend {ERR_INVALID_ADDRESS:#x}"))
            }
            Err(SvcError::Stopped(stopped)) => return Err(stopped),
        };
        let summary = match summary {
            Summary::Skip => None,
            Summary::Default => {
                if self.log_all_svc && number != 0x28 {
                    let t = self.thread(thread);
                    Some(if t.state == ThreadState::Ready {
                        format!("-> r0={:#x} r1={:#x}", self.cpu.get(R0), self.cpu.get(R1))
                    } else {
                        format!("({})", t.wait.as_ref().map(|w| w.what.as_str()).filter(|_| true).unwrap_or("bloqué"))
                    })
                } else {
                    None
                }
            }
            Summary::Text(s) => Some(s),
        };
        if let Some(summary) = summary {
            let now = self.now;
            self.journal.svc(now, thread_id, number, pc, lr, &summary);
        }
        Ok(())
    }

    fn fname(&self, address: u32) -> String {
        self.journal.names.function(address)
    }

    // 0x01
    fn svc_control_memory(&mut self, _thread: ObjId) -> SvcResult {
        let (op, mut addr0, addr1, size, perms) = (self.a(R0), self.a(R1), self.a(R2), self.a(R3), self.a(R4));
        let kind = op & 0xFF;
        let linear = op & 0x10000 != 0;
        let t = format!("ControlMemory(op={op:#x}, addr0={addr0:#x}, addr1={addr1:#x}, taille={size:#x}, droits={perms})");
        if addr0 % PAGE != 0 || addr1 % PAGE != 0 {
            self.ret(&[(R0, ERR_MISALIGNED_ADDRESS)]);
            return text(t + " -> adresse mal alignée");
        }
        if size % PAGE != 0 {
            self.ret(&[(R0, ERR_MISALIGNED_SIZE)]);
            return text(t + " -> taille mal alignée");
        }
        let uperm = if perms & 3 != 0 { perms & 3 } else { PERM_R };
        if kind == 3 && linear {
            let found = if addr0 == 0 { self.memory.find_free(LINEAR_BASE, LINEAR_END - 0x0080_0000, size) } else { Some(addr0) };
            let bad = match found {
                None => true,
                Some(a) => !(LINEAR_BASE..LINEAR_END).contains(&a) || self.memory.overlaps(a, size),
            };
            if bad {
                self.ret(&[(R0, ERR_INVALID_ADDRESS)]);
                return text(t + " -> plus de place dans le tas linéaire");
            }
            addr0 = found.unwrap();
            let backing = self.linear_backing.clone();
            self.memory.map(addr0, size, PERM_RWX, "tas linéaire", Some((&backing, (addr0 - LINEAR_BASE) as usize)))?;
            self.memory.fill(addr0, size, 0)?;
            self.ret(&[(R0, OK), (R1, addr0)]);
            return text(format!("{t} -> 0, {addr0:#x} (tas linéaire)"));
        }
        if kind == 3 {
            if !(HEAP_BASE..HEAP_END).contains(&addr0) || addr0 as u64 + size as u64 > HEAP_END as u64 {
                self.ret(&[(R0, ERR_INVALID_ADDRESS)]);
                return text(t + " -> hors du tas");
            }
            // Les pages déjà là restent (le jeu agrandit son tas par le haut) ; seules les manquantes sont prises.
            let end = addr0 + size;
            let mut cursor = addr0;
            let backing = self.heap_backing.clone();
            while cursor < end {
                if self.memory.is_mapped(cursor, 1) {
                    cursor += PAGE;
                    continue;
                }
                let mut stop = cursor;
                while stop < end && !self.memory.is_mapped(stop, 1) {
                    stop += PAGE;
                }
                self.memory.map(cursor, stop - cursor, PERM_RWX, "tas", Some((&backing, (cursor - HEAP_BASE) as usize)))?;
                self.memory.fill(cursor, stop - cursor, 0)?;
                cursor = stop;
            }
            self.ret(&[(R0, OK), (R1, addr0)]);
            return text(format!("{t} -> 0, {addr0:#x} (tas)"));
        }
        if kind == 1 {
            self.memory.unmap(addr0, size);
            self.ret(&[(R0, OK), (R1, addr0)]);
            return text(t + " -> 0 (libéré)");
        }
        if kind == 4 {
            let mut cursor = 0u32;
            while cursor < size {
                let found = self.memory.find(addr1 + cursor).map(|r| (r.backing.clone(), r.offset, r.start, r.end()));
                let Some((backing, offset, start, end)) = found else {
                    self.ret(&[(R0, ERR_INVALID_ADDRESS)]);
                    return text(t + " -> source non projetée");
                };
                let step = (size - cursor).min((end - (addr1 + cursor) as u64) as u32);
                let at = offset + (addr1 + cursor - start) as usize;
                self.memory.map(addr0 + cursor, step, PERM_RWX, "alias", Some((&backing, at)))?;
                cursor += step;
            }
            self.ret(&[(R0, OK), (R1, addr0)]);
            return text(t + " -> 0 (alias)");
        }
        if kind == 5 {
            self.memory.unmap(addr0, size);
            self.ret(&[(R0, OK), (R1, addr0)]);
            return text(t + " -> 0 (alias retiré)");
        }
        if kind == 6 {
            self.memory.protect(addr0, size, uperm | (PERM_RWX & 4));
            self.ret(&[(R0, OK), (R1, addr0)]);
            return text(t + " -> 0 (droits)");
        }
        self.ret(&[(R0, ERR_INVALID_ENUM)]);
        text(t + " -> opération inconnue")
    }

    // 0x02
    fn svc_query_memory(&mut self, _thread: ObjId) -> SvcResult {
        let address = self.a(R2);
        if let Some(region) = self.memory.find(address) {
            let (mut base, mut end, perms) = (region.start as u64, region.end(), region.perms);
            // Les plages voisines de mêmes droits forment un seul bloc pour la console.
            for r in &self.memory.regions {
                if r.end() == base && r.perms == perms {
                    base = r.start as u64;
                }
            }
            for r in &self.memory.regions {
                if r.start as u64 == end && r.perms == perms {
                    end = r.end();
                }
            }
            let state = if (HEAP_BASE..LINEAR_END).contains(&address) { 5 } else { 3 };
            self.ret(&[(R0, OK), (R1, base as u32), (R2, (end - base) as u32), (R3, perms & 3), (R4, state), (R5, 0)]);
            return text(format!("QueryMemory({address:#x}) -> {base:#x} + {:#x}, droits {}", end - base, perms & 3));
        }
        let (mut low, mut high) = (0u64, 0x4000_0000u64);
        for r in &self.memory.regions {
            if r.end() <= address as u64 {
                low = low.max(r.end());
            } else if r.start > address {
                high = high.min(r.start as u64);
            }
        }
        self.ret(&[(R0, OK), (R1, low as u32), (R2, (high - low) as u32), (R3, 0), (R4, 0), (R5, 0)]);
        text(format!("QueryMemory({address:#x}) -> libre {low:#x} + {:#x}", high - low))
    }

    // 0x03
    fn svc_exit_process(&mut self, thread: ObjId) -> SvcResult {
        let (pc, lr, now) = (self.cpu.get(Reg::Pc).wrapping_sub(4), self.cpu.get(Reg::Lr), self.now);
        let id = self.thread(thread).thread_id;
        self.journal.svc(now, id, 3, pc, lr, "ExitProcess");
        Err(Stopped("le jeu a appelé svcExitProcess".into()).into())
    }

    // 0x08
    fn svc_create_thread(&mut self, thread: ObjId) -> SvcResult {
        let (priority, entry, arg, stack_top, core) = (self.a(R0), self.a(R1), self.a(R2), self.a(R3), self.a(R4) as i32);
        if priority >= 0x40 {
            self.ret(&[(R0, ERR_OUT_OF_RANGE)]);
            return text(format!("CreateThread(priorité {priority:#x}) -> refusé"));
        }
        let new = self.create_thread(entry, arg, stack_top, priority, core, "");
        let handle = self.add_handle(new).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        let (new_id, tls) = (self.thread(new).thread_id, self.thread(new).tls);
        let parent = self.thread(thread).thread_id;
        let now = self.now;
        self.journal.thread_created(now, Some(parent), new_id, entry, priority, core, stack_top, tls);
        text(format!(
            "CreateThread(entrée {entry:#x} {}, arg {arg:#x}, pile {stack_top:#x}, priorité {priority:#x}, cœur {core}) -> fil {new_id:#x}, h={handle:#x}",
            self.fname(entry)))
    }

    // 0x09
    fn svc_exit_thread(&mut self, thread: ObjId) -> SvcResult {
        let tls = self.thread(thread).tls;
        self.thread_mut(thread).state = ThreadState::Dead;
        self.tls_used.remove(&((tls - TLS_BASE) / TLS_SLOT));
        let (pc, lr, now, id) = (self.cpu.get(Reg::Pc).wrapping_sub(4), self.cpu.get(Reg::Lr), self.now, self.thread(thread).thread_id);
        self.journal.svc(now, id, 9, pc, lr, "ExitThread");
        self.wake_waiters();
        Ok(Summary::Skip)
    }

    // 0x0A
    fn svc_sleep_thread(&mut self, thread: ObjId) -> SvcResult {
        let ns = self.a(R0) as u64 | (self.a(R1) as u64) << 32;
        if ns & (1 << 63) != 0 {
            self.ret(&[(R0, OK)]);
            return Ok(Summary::Default);
        }
        if ns == 0 {
            let ready = self.ready_order_next();
            self.thread_mut(thread).ready_since = ready;
            self.ret(&[(R0, OK)]);
            let priority = self.thread(thread).priority;
            let others = self.ready_threads().into_iter().any(|t| t != thread && self.thread(t).priority == priority);
            if others {
                self.current = None;
            }
            return Ok(Summary::Default);
        }
        self.ret(&[(R0, OK)]);
        let mut wait = Wait::new(WaitKind::Sleep);
        wait.deadline = Some(self.now + ns);
        wait.what = format!("sommeil {} µs", ns / 1000);
        self.block(thread, wait);
        Ok(Summary::Default)
    }

    // 0x0B
    fn svc_get_thread_priority(&mut self, thread: ObjId) -> SvcResult {
        let target = self.lookup(self.a(R1), Some(thread)).filter(|&o| self.is_thread(o));
        let Some(target) = target else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("GetThreadPriority -> poignée invalide".into());
        };
        let priority = self.thread(target).priority;
        self.ret(&[(R0, OK), (R1, priority)]);
        Ok(Summary::Default)
    }

    // 0x0C
    fn svc_set_thread_priority(&mut self, thread: ObjId) -> SvcResult {
        let target = self.lookup(self.a(R0), Some(thread)).filter(|&o| self.is_thread(o));
        let priority = self.a(R1);
        let Some(target) = target else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("SetThreadPriority -> poignée invalide".into());
        };
        if priority >= 0x40 {
            self.ret(&[(R0, ERR_OUT_OF_RANGE)]);
            return text(format!("SetThreadPriority({priority:#x}) -> hors bornes"));
        }
        self.thread_mut(target).priority = priority;
        self.ret(&[(R0, OK)]);
        text(format!("SetThreadPriority(fil {:#x}, {priority:#x}) -> 0", self.thread(target).thread_id))
    }

    // 0x13, 0x14
    fn svc_create_mutex(&mut self, thread: ObjId) -> SvcResult {
        let locked = self.a(R1) & 0xFF;
        let mutex = self.create_mutex(if locked != 0 { Some(thread) } else { None }, "");
        let handle = self.add_handle(mutex).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("CreateMutex(pris={locked}) -> h={handle:#x}"))
    }

    fn svc_release_mutex(&mut self, thread: ObjId) -> SvcResult {
        let mutex = self.lookup(self.a(R0), None).filter(|&o| matches!(self.objects[o].data, Obj::Mutex(_)));
        let Some(mutex) = mutex else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("ReleaseMutex -> poignée invalide".into());
        };
        let result = {
            let Obj::Mutex(m) = &mut self.objects[mutex].data else { unreachable!() };
            if m.owner != Some(thread) {
                ERR_NOT_OWNER
            } else {
                m.depth -= 1;
                if m.depth == 0 {
                    m.owner = None;
                    OK + 1 // marqueur : à réveiller
                } else {
                    OK
                }
            }
        };
        let result = if result == OK + 1 {
            self.wake_waiters();
            OK
        } else {
            result
        };
        self.ret(&[(R0, result)]);
        if result == OK {
            Ok(Summary::Default)
        } else {
            text(format!("ReleaseMutex({}) -> {result:#x} (pas le propriétaire)", self.label(mutex)))
        }
    }

    // 0x15, 0x16
    fn svc_create_semaphore(&mut self, _thread: ObjId) -> SvcResult {
        let (count, maximum) = (self.a(R1), self.a(R2));
        let semaphore = self.create_semaphore(count, maximum, "");
        let handle = self.add_handle(semaphore).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("CreateSemaphore({count}, max {maximum}) -> h={handle:#x}"))
    }

    fn svc_release_semaphore(&mut self, _thread: ObjId) -> SvcResult {
        let semaphore = self.lookup(self.a(R1), None).filter(|&o| matches!(self.objects[o].data, Obj::Semaphore(_)));
        let count = self.a(R2);
        let Some(semaphore) = semaphore else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("ReleaseSemaphore -> poignée invalide".into());
        };
        let s = self.semaphore_mut(semaphore);
        if s.count as u64 + count as u64 > s.maximum as u64 {
            self.ret(&[(R0, ERR_INVALID_COMBINATION)]);
            return text("ReleaseSemaphore -> au-delà du maximum".into());
        }
        let previous = s.count;
        s.count += count;
        self.ret(&[(R0, OK), (R1, previous)]);
        self.wake_waiters();
        Ok(Summary::Default)
    }

    // 0x17 à 0x19
    fn svc_create_event(&mut self, _thread: ObjId) -> SvcResult {
        let reset = self.a(R1);
        let event = self.create_event(reset, "");
        let handle = self.add_handle(event).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("CreateEvent(type {reset}) -> {}, h={handle:#x}", self.label(event)))
    }

    fn svc_signal_event(&mut self, _thread: ObjId) -> SvcResult {
        let handle = self.a(R0);
        let event = self.lookup(handle, None).filter(|&o| matches!(self.objects[o].data, Obj::Event(_)));
        let Some(event) = event else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text(format!("SignalEvent({handle:#x}) -> poignée invalide"));
        };
        self.ret(&[(R0, OK)]);
        self.signal_event(event);
        if !self.event(event).listeners.is_empty() || !self.objects[event].name.is_empty() {
            text(format!("SignalEvent({})", self.label(event)))
        } else {
            Ok(Summary::Default)
        }
    }

    fn svc_clear_event(&mut self, _thread: ObjId) -> SvcResult {
        let handle = self.a(R0);
        let object = self.lookup(handle, None);
        match object.map(|o| &mut self.objects[o].data) {
            Some(Obj::Event(e)) => e.signaled = false,
            Some(Obj::Timer(t)) => t.signaled = false,
            _ => {
                self.ret(&[(R0, ERR_INVALID_HANDLE)]);
                return text(format!("ClearEvent({handle:#x}) -> poignée invalide"));
            }
        }
        self.ret(&[(R0, OK)]);
        Ok(Summary::Default)
    }

    // 0x1A à 0x1D
    fn svc_create_timer(&mut self, _thread: ObjId) -> SvcResult {
        let reset = self.a(R1);
        let timer = self.create_timer(reset);
        let handle = self.add_handle(timer).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("CreateTimer(type {reset}) -> h={handle:#x}"))
    }

    fn timer_fire(&mut self, timer: ObjId, interval: u64, token: u64) {
        {
            let Obj::Timer(t) = &mut self.objects[timer].data else { return };
            if t.token != Some(token) {
                return;
            }
            t.signaled = true;
        }
        self.wake_waiters();
        if let Obj::Timer(t) = &mut self.objects[timer].data {
            if t.reset_type == RESET_PULSE {
                t.signaled = false;
            }
        }
        if interval > 0 {
            let when = self.now + interval;
            self.schedule(when, Box::new(move |k: &mut Kernel| k.timer_fire(timer, interval, token)));
        }
    }

    fn svc_set_timer(&mut self, _thread: ObjId) -> SvcResult {
        let timer = self.lookup(self.a(R0), None).filter(|&o| matches!(self.objects[o].data, Obj::Timer(_)));
        let initial = self.a(R2) as u64 | (self.a(R3) as u64) << 32;
        let interval = self.a(R1) as u64 | (self.a(R4) as u64) << 32;
        let Some(timer) = timer else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("SetTimer -> poignée invalide".into());
        };
        if initial >> 63 != 0 || interval >> 63 != 0 {
            self.ret(&[(R0, ERR_INVALID_COMBINATION)]);
            return text("SetTimer -> délai négatif".into());
        }
        self.timer_tokens += 1;
        let token = self.timer_tokens;
        if let Obj::Timer(t) = &mut self.objects[timer].data {
            t.token = Some(token);
        }
        let when = self.now + initial;
        self.schedule(when, Box::new(move |k: &mut Kernel| k.timer_fire(timer, interval, token)));
        self.ret(&[(R0, OK)]);
        text(format!("SetTimer({}, {initial} ns, période {interval} ns)", self.label(timer)))
    }

    fn svc_cancel_timer(&mut self, _thread: ObjId) -> SvcResult {
        if let Some(o) = self.lookup(self.a(R0), None) {
            if let Obj::Timer(t) = &mut self.objects[o].data {
                t.token = None;
            }
        }
        self.ret(&[(R0, OK)]);
        Ok(Summary::Default)
    }

    fn svc_clear_timer(&mut self, _thread: ObjId) -> SvcResult {
        if let Some(o) = self.lookup(self.a(R0), None) {
            if let Obj::Timer(t) = &mut self.objects[o].data {
                t.signaled = false;
            }
        }
        self.ret(&[(R0, OK)]);
        Ok(Summary::Default)
    }

    // 0x1E à 0x20
    fn svc_create_memory_block(&mut self, _thread: ObjId) -> SvcResult {
        let (other, address, size, mine) = (self.a(R0), self.a(R1), self.a(R2), self.a(R3));
        let t = format!("CreateMemoryBlock({address:#x}, taille {size:#x}, droits {mine}/{other})");
        if address == 0 {
            self.ret(&[(R0, 0xD920_07EA)]);
            return text(t + " -> adresse 0 refusée à une application");
        }
        let Some((backing, offset)) = self.memory.backing_at(address) else {
            self.ret(&[(R0, ERR_INVALID_ADDRESS)]);
            return text(t + " -> adresse non projetée");
        };
        let block = self.create_shared(size, Some((backing, offset)), address, "bloc du jeu");
        let handle = self.add_handle(block).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("{t} -> h={handle:#x}"))
    }

    fn map_shared(&mut self, block: ObjId, address: u32) -> Result<u32, Stopped> {
        let (size, backing, offset, own_address, name) = {
            let b = self.shared(block);
            (b.size, b.backing.clone(), b.offset, b.address, self.objects[block].name.clone())
        };
        let mut address = address;
        if address == 0 {
            address = own_address;
        }
        if address == 0 {
            address = self.memory.find_free(0x1000_0000, 0x1400_0000, size).unwrap_or(0);
        }
        if self.memory.overlaps(address, size) {
            if let Some(region) = self.memory.find(address) {
                if std::rc::Rc::ptr_eq(&region.backing, &backing) {
                    return Ok(address);
                }
            }
            return Err(Stopped(format!("MapMemoryBlock : {address:#x} est déjà pris")));
        }
        let region_name = if name.is_empty() { "mémoire partagée".to_string() } else { name };
        self.memory
            .map(address, size, PERM_RWX, &region_name, Some((&backing, offset)))
            .map_err(|e| Stopped(format!("MapMemoryBlock : {e}")))?;
        self.shared_mut(block).mappings.push(address);
        Ok(address)
    }

    fn svc_map_memory_block(&mut self, _thread: ObjId) -> SvcResult {
        let (handle, address, mine) = (self.a(R0), self.a(R1), self.a(R2));
        let block = self.lookup(handle, None).filter(|&o| matches!(self.objects[o].data, Obj::Shared(_)));
        let Some(block) = block else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text(format!("MapMemoryBlock({handle:#x}) -> poignée invalide"));
        };
        if address != 0 && !(0x0800_0000..0x1400_0000).contains(&address) {
            self.ret(&[(R0, ERR_INVALID_ADDRESS)]);
            return text(format!("MapMemoryBlock({}, {address:#x}) -> hors de 0x08000000-0x14000000", self.label(block)));
        }
        let mapped = self.map_shared(block, address)?;
        self.ret(&[(R0, OK)]);
        text(format!("MapMemoryBlock({}, {address:#x}, droits {mine}) -> projeté à {mapped:#x}", self.label(block)))
    }

    fn svc_unmap_memory_block(&mut self, _thread: ObjId) -> SvcResult {
        let block = self.lookup(self.a(R0), None).filter(|&o| matches!(self.objects[o].data, Obj::Shared(_)));
        let address = self.a(R1);
        let Some(block) = block else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("UnmapMemoryBlock -> poignée invalide".into());
        };
        if let Some(at) = self.shared(block).mappings.iter().position(|&m| m == address) {
            let size = self.shared(block).size;
            self.shared_mut(block).mappings.remove(at);
            self.memory.unmap(address, size);
        }
        self.ret(&[(R0, OK)]);
        text(format!("UnmapMemoryBlock({}, {address:#x})", self.label(block)))
    }

    // 0x21, 0x22
    fn svc_create_address_arbiter(&mut self, _thread: ObjId) -> SvcResult {
        let arbiter = self.new_object("", Obj::Arbiter);
        let handle = self.add_handle(arbiter).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("CreateAddressArbiter -> h={handle:#x}"))
    }

    fn svc_arbitrate_address(&mut self, thread: ObjId) -> SvcResult {
        let (handle, address, kind, value) = (self.a(R0), self.a(R1), self.a(R2), self.a(R3));
        let timeout = self.a(R4) as u64 | (self.a(R5) as u64) << 32;
        let arbiter = self.lookup(handle, None);
        let signed = value as i32 as i64;
        if address & 3 != 0 {
            self.ret(&[(R0, 0xD8E0_07F1)]);
            return text(format!("ArbitrateAddress({address:#x}) -> mal alignée"));
        }
        let Some(arbiter) = arbiter.filter(|&o| matches!(self.objects[o].data, Obj::Arbiter)) else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("ArbitrateAddress -> poignée invalide".into());
        };
        if kind == 0 {
            let mut waiting: Vec<ObjId> = self
                .threads
                .iter()
                .copied()
                .filter(|&t| {
                    let th = self.thread(t);
                    th.state == ThreadState::Waiting
                        && th.wait.as_ref().is_some_and(|w| w.kind == WaitKind::Arbiter && w.arbiter == Some(arbiter) && w.address == address)
                })
                .collect();
            waiting.sort_by_key(|&t| (self.thread(t).priority, self.thread(t).wait.as_ref().unwrap().since));
            let count = if signed < 0 { waiting.len() } else { (signed as usize).min(waiting.len()) };
            for &t in &waiting[..count] {
                self.make_ready(t, &[(R0, OK)]);
            }
            self.ret(&[(R0, OK)]);
            return Ok(Summary::Default);
        }
        if kind > 4 {
            self.ret(&[(R0, 0xD8E0_93ED)]);
            return text(format!("ArbitrateAddress(type {kind}) -> type inconnu"));
        }
        let current = self.memory.u32(address)?;
        let current_signed = current as i32 as i64;
        if current_signed >= signed {
            self.ret(&[(R0, OK)]);
            return Ok(Summary::Default);
        }
        if kind == 2 || kind == 4 {
            self.memory.w32(address, current.wrapping_sub(1))?;
        }
        let mut deadline = None;
        if (kind == 3 || kind == 4) && timeout >> 63 == 0 {
            deadline = Some(self.now + timeout);
        }
        self.ret(&[(R0, OK)]);
        let mut wait = Wait::new(WaitKind::Arbiter);
        wait.address = address;
        wait.arbiter = Some(arbiter);
        wait.deadline = deadline;
        wait.what = format!("adresse {address:#x} ({})", self.fname(self.cpu.get(Reg::Lr)));
        self.block(thread, wait);
        Ok(Summary::Default)
    }

    // 0x23
    fn svc_close_handle(&mut self, _thread: ObjId) -> SvcResult {
        let handle = self.a(R0);
        let Some(obj) = self.handles.remove(handle) else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text(format!("CloseHandle({handle:#x}) -> poignée invalide"));
        };
        let is_session = matches!(self.objects[obj].data, Obj::Session(_));
        if self.handles.handles_of(obj).is_empty() {
            if let Obj::Session(s) = &self.objects[obj].data {
                let handler = s.handler.clone();
                handler.borrow_mut().on_session_closed(self, obj);
            }
        }
        self.ret(&[(R0, OK)]);
        if is_session {
            text(format!("CloseHandle({handle:#x} : {})", self.label(obj)))
        } else {
            Ok(Summary::Default)
        }
    }

    // 0x24, 0x25
    fn wait_on(&mut self, thread: ObjId, objects: &[ObjId], wait_all: bool, timeout: u64, what: String) -> &'static str {
        let ns: i64 = timeout as i64;
        if !wait_all {
            for (index, &o) in objects.iter().enumerate() {
                if self.is_free(o, thread) {
                    self.acquire(o, thread);
                    self.ret(&[(R0, OK), (R1, index as u32)]);
                    return "libre";
                }
            }
        } else if objects.iter().all(|&o| self.is_free(o, thread)) {
            for &o in objects {
                self.acquire(o, thread);
            }
            self.ret(&[(R0, OK), (R1, 0)]);
            return "libre";
        }
        if ns == 0 {
            self.ret(&[(R0, TIMEOUT)]);
            return "délai 0";
        }
        let deadline = if ns < 0 { None } else { Some(self.now + ns as u64) };
        self.ret(&[(R0, TIMEOUT)]);
        let mut wait = Wait::new(WaitKind::Sync);
        wait.objects = objects.to_vec();
        wait.wait_all = wait_all;
        wait.deadline = deadline;
        wait.what = what;
        self.block(thread, wait);
        "attend"
    }

    fn svc_wait_synchronization1(&mut self, thread: ObjId) -> SvcResult {
        let handle = self.a(R0);
        let timeout = self.a(R2) as u64 | (self.a(R3) as u64) << 32;
        let obj = self.lookup(handle, Some(thread)).filter(|&o| self.objects[o].waitable());
        let Some(obj) = obj else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text(format!("WaitSynchronization1({handle:#x}) -> poignée invalide"));
        };
        let what = format!("{} ({})", self.label(obj), self.fname(self.cpu.get(Reg::Lr)));
        let outcome = self.wait_on(thread, &[obj], false, timeout, what);
        if outcome == "libre" || matches!(self.objects[obj].data, Obj::Mutex(_)) {
            Ok(Summary::Default)
        } else {
            text(format!("WaitSynchronization1({}) : {outcome}", self.label(obj)))
        }
    }

    fn svc_wait_synchronization_n(&mut self, thread: ObjId) -> SvcResult {
        let timeout = self.a(R0) as u64 | (self.a(R4) as u64) << 32;
        let (pointer, count, wait_all) = (self.a(R1), self.a(R2), self.a(R3) & 0xFF);
        if count > 256 {
            self.ret(&[(R0, 0xD860_07F3)]);
            return text(format!("WaitSynchronizationN({count}) -> trop de poignées"));
        }
        let mut objects = Vec::new();
        let handles = if count != 0 { self.memory.words(pointer, count as usize)? } else { Vec::new() };
        for handle in handles {
            let obj = self.lookup(handle, Some(thread)).filter(|&o| self.objects[o].waitable());
            let Some(obj) = obj else {
                self.ret(&[(R0, ERR_INVALID_HANDLE)]);
                return text(format!("WaitSynchronizationN -> poignée invalide {handle:#x}"));
            };
            objects.push(obj);
        }
        let labels = objects.iter().map(|&o| self.label(o)).collect::<Vec<_>>().join(", ");
        let what = format!("{labels} ({})", self.fname(self.cpu.get(Reg::Lr)));
        let outcome = self.wait_on(thread, &objects, wait_all != 0, timeout, what);
        if outcome == "libre" {
            Ok(Summary::Default)
        } else {
            text(format!("WaitSynchronizationN({labels}, tous={wait_all}) : {outcome}"))
        }
    }

    // 0x27 à 0x2B
    fn svc_duplicate_handle(&mut self, thread: ObjId) -> SvcResult {
        let Some(obj) = self.lookup(self.a(R1), Some(thread)) else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("DuplicateHandle -> poignée invalide".into());
        };
        let handle = self.add_handle(obj).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("DuplicateHandle({}) -> h={handle:#x}", self.label(obj)))
    }

    fn svc_get_system_tick(&mut self, _thread: ObjId) -> SvcResult {
        let ticks = self.ticks();
        self.ret(&[(R0, ticks as u32), (R1, (ticks >> 32) as u32)]);
        Ok(Summary::Default)
    }

    fn svc_get_handle_info(&mut self, _thread: ObjId) -> SvcResult {
        self.ret(&[(R0, OK), (R1, 0), (R2, 0)]);
        text(format!("GetHandleInfo({:#x}, {}) -> 0", self.a(R1), self.a(R2)))
    }

    fn svc_get_system_info(&mut self, _thread: ObjId) -> SvcResult {
        let (kind, param) = (self.a(R1), self.a(R2));
        let mut value: u64 = 0;
        if kind == 0 {
            value = if param == 0 || param == 1 { self.committed() as u64 + self.code_size as u64 } else { 0 };
        } else if kind == 0x1A {
            value = 5;
        }
        self.ret(&[(R0, OK), (R1, value as u32), (R2, (value >> 32) as u32)]);
        text(format!("GetSystemInfo({kind:#x}, {param}) -> {value:#x}"))
    }

    fn svc_get_process_info(&mut self, _thread: ObjId) -> SvcResult {
        let kind = self.a(R2);
        let committed = self.committed() as u64;
        let code = self.code_size as u64;
        let handles = self.handles.entries.len() as u64;
        let value = match kind {
            0 => committed + code,
            1 => committed,
            2 => committed + code,
            3 => committed,
            4 | 5 => handles,
            8 => self.threads.len() as u64,
            0x13 => 1,
            0x14 => 0x2000_0000 - LINEAR_BASE as u64,
            _ => {
                self.ret(&[(R0, ERR_UNKNOWN_INFO)]);
                return text(format!("GetProcessInfo(type {kind:#x}) -> type inconnu"));
            }
        };
        self.ret(&[(R0, OK), (R1, value as u32), (R2, (value >> 32) as u32)]);
        text(format!("GetProcessInfo(type {kind:#x}) -> {value:#x}"))
    }

    // 0x2D, 0x32
    fn svc_connect_to_port(&mut self, _thread: ObjId) -> SvcResult {
        let name = self.memory.cstring(self.a(R1), 12);
        let Some(handler) = self.ports.get(&name).cloned() else {
            self.ret(&[(R0, ERR_PORT_NOT_FOUND)]);
            return text(format!("ConnectToPort(\"{name}\") -> port inconnu"));
        };
        let session = self.new_session(handler, &name);
        let handle = self.add_handle(session).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("ConnectToPort(\"{name}\") -> h={handle:#x}"))
    }

    fn svc_send_sync_request(&mut self, thread: ObjId) -> SvcResult {
        let handle = self.a(R0);
        let session = self.lookup(handle, None);
        let Some(session) = session.filter(|&o| matches!(self.objects[o].data, Obj::Session(_))) else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            let shown = match self.lookup(handle, None) {
                Some(o) => self.label(o),
                None => "absente".into(),
            };
            return text(format!("SendSyncRequest({handle:#x}) -> poignée invalide ({shown})"));
        };
        crate::ipc::dispatch(self, thread, session);
        self.ret(&[(R0, OK)]);
        Ok(Summary::Skip)
    }

    // 0x35 à 0x3A
    fn svc_get_process_id(&mut self, _thread: ObjId) -> SvcResult {
        let pid = self.process_pid();
        self.ret(&[(R0, OK), (R1, pid)]);
        Ok(Summary::Default)
    }

    fn svc_get_thread_id(&mut self, thread: ObjId) -> SvcResult {
        let target = self.lookup(self.a(R1), Some(thread)).filter(|&o| self.is_thread(o));
        let Some(target) = target else {
            self.ret(&[(R0, ERR_INVALID_HANDLE)]);
            return text("GetThreadId -> poignée invalide".into());
        };
        let id = self.thread(target).thread_id;
        self.ret(&[(R0, OK), (R1, id)]);
        Ok(Summary::Default)
    }

    fn svc_get_resource_limit(&mut self, _thread: ObjId) -> SvcResult {
        let limit = self.resource_limit;
        let handle = self.add_handle(limit).unwrap_or(0);
        self.ret(&[(R0, OK), (R1, handle)]);
        text(format!("GetResourceLimit -> h={handle:#x}"))
    }

    fn svc_get_resource_limit_values(&mut self, current: bool) -> SvcResult {
        let (out, _handle, names, count) = (self.a(R0), self.a(R1), self.a(R2), self.a(R3));
        let limit = |name: u32| -> u64 {
            match name {
                0 => 0x18,
                1 => self.app_memory as u64,
                2..=4 => 32,
                5 | 6 => 8,
                7 => 16,
                8 => 2,
                _ => 0,
            }
        };
        let used = |name: u32| -> u64 {
            match name {
                1 => self.committed() as u64 + self.code_size as u64,
                2 => self.threads.iter().filter(|&&t| self.thread(t).state != ThreadState::Dead).count() as u64,
                _ => 0,
            }
        };
        let mut texts = Vec::new();
        for i in 0..count {
            let name = self.memory.u32(names + 4 * i)?;
            let value = if current { used(name) } else { limit(name) };
            self.memory.w64(out + 8 * i, value)?;
            texts.push(format!("{name}={value:#x}"));
        }
        self.ret(&[(R0, OK)]);
        let which = if current { "GetResourceLimitCurrentValues" } else { "GetResourceLimitLimitValues" };
        text(format!("{which}({})", texts.join(", ")))
    }

    // 0x3C, 0x3D
    fn svc_break(&mut self, thread: ObjId) -> SvcResult {
        let reason = self.a(R0);
        let (pc, lr, now) = (self.cpu.get(Reg::Pc).wrapping_sub(4), self.cpu.get(Reg::Lr), self.now);
        let id = self.thread(thread).thread_id;
        self.journal.svc(now, id, 0x3C, pc, lr, &format!("Break({reason})"));
        let who = self.fname(lr);
        Err(Stopped(format!(
            "svcBreak({reason}) appelé par {} (lr {lr:#x}) : sur une console du commerce le jeu est terminé",
            if who.is_empty() { "?".to_string() } else { who })).into())
    }

    fn svc_output_debug_string(&mut self, _thread: ObjId) -> SvcResult {
        let raw = self.memory.read(self.a(R0), self.a(R1).min(0x400))?;
        let string: String = raw.iter().map(|&b| b as char).collect();
        self.ret(&[(R0, OK)]);
        text(format!("OutputDebugString(\"{}\")", string.trim_end_matches('\n')))
    }

    fn ready_order_next(&mut self) -> u64 {
        // Le même compteur que `make_ready` et `create_thread`.
        self.take_ready_order()
    }
}

#[allow(dead_code)]
fn _unused(_: u32) -> u32 {
    align_up(0)
}
