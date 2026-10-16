//! Les tests du noyau, sur des programmes fabriqués : un processeur scénarisé qui enchaîne des appels système, comme
//! `banc/tests.py` le fait avec de petits programmes ARM. Rien du jeu ici.

use std::cell::RefCell;
use std::rc::Rc;

use kernel::cpu::{Reg, Stop, R0, R1, R2, R3, R4, R5};
use kernel::ipc::{Reply, Request, Service};
use kernel::kernel::*;
use kernel::memory::{PERM_RW, PERM_RWX};
use kernel::object::*;
use kernel::testing::{Script, Step, call, header, test_kernel, test_main_thread};

fn svc(number: u32, regs: &[(Reg, u32)]) -> Step {
    Step { regs: regs.to_vec(), stop: Stop::Svc { number, pc: 0x10_0004 } }
}

/// Joue des appels système du fil principal, puis s'arrête sur « fin du scénario ».
fn run_program(k: &mut Kernel, script: &Script, steps: Vec<Step>) -> String {
    script.borrow_mut().extend(steps);
    k.run(10_000_000_000, &mut |_| None)
}

fn setup() -> (Kernel, Script) {
    let (mut k, script) = test_kernel();
    k.memory.map(0x0FF0_0000, 0x10_0000, PERM_RW, "pile", None).unwrap();
    k.create_thread(0x10_0000, 0, 0x1000_0000, 0x30, 0, "principal");
    (k, script)
}

fn lines(k: &Kernel) -> Vec<String> {
    k.journal.capture.clone().unwrap()
}

#[test]
fn handle_table_counters_and_removal() {
    let mut table = HandleTable::new();
    let a = table.add(10).unwrap();
    let b = table.add(11).unwrap();
    assert_eq!(a, 1 << 15);
    assert_eq!(b, 1 | 2 << 15);
    assert_eq!(table.get(a), Some(10));
    assert_eq!(table.get(a ^ 0x8000), None, "mauvais compteur");
    assert_eq!(table.remove(a), Some(10));
    assert_eq!(table.get(a), None);
    let c = table.add(12).unwrap(); // l'indice 0 est libre de nouveau, le compteur monte
    assert_eq!(c, 3 << 15);
    assert_eq!(table.handles_of(12), vec![c]);
}

#[test]
fn event_signal_and_wait_cost_time() {
    let (mut k, script) = setup();
    let reason = run_program(&mut k, &script, vec![
        svc(0x17, &[(R1, 0)]),              // CreateEvent(oneshot)
        svc(0x18, &[(R0, 3 << 15 | 0)]),    // SignalEvent d'une poignée qui n'existe pas
    ]);
    assert!(reason.contains("fin du scénario"), "{reason}");
    // 2 appels système = 2 x 2 µs, plus rien
    assert_eq!(k.now, 4000);
    let text = lines(&k).join("\n");
    assert!(text.contains("CreateEvent(type 0) -> événement#4, h=0x8000"), "{text}");
    assert!(text.contains("SignalEvent(0x18000) -> poignée invalide"), "{text}");
    assert_eq!(k.cpu.get(R0), ERR_INVALID_HANDLE);
}

#[test]
fn wait_on_a_free_event_returns_at_once_and_resets_oneshot() {
    let (mut k, script) = setup();
    let event = k.create_event(RESET_ONESHOT, "");
    let handle = k.add_handle(event).unwrap();
    k.event_mut(event).signaled = true;
    run_program(&mut k, &script, vec![svc(0x24, &[(R0, handle), (R2, 0), (R3, 0)])]);
    assert_eq!(k.cpu.get(R0), OK);
    assert!(!k.event(event).signaled, "l'événement oneshot est remis à zéro");
}

#[test]
fn wait_blocks_then_signal_wakes_with_registers() {
    let (mut k, script) = setup();
    let event = k.create_event(RESET_STICKY, "attendu");
    let handle = k.add_handle(event).unwrap();
    // timeout -1 (infini)
    let reason = run_program(&mut k, &script, vec![svc(0x24, &[(R0, handle), (R2, 0xFFFF_FFFF), (R3, 0xFFFF_FFFF)])]);
    assert!(reason.contains("interblocage"), "plus aucun fil prêt et aucune échéance : {reason}");
    let main = k.threads[0];
    assert_eq!(k.thread(main).state, ThreadState::Waiting);
    k.signal_event(event);
    assert_eq!(k.thread(main).state, ThreadState::Ready);
    assert_eq!(k.thread(main).pending.iter().find(|(r, _)| *r == R0).unwrap().1, OK);
    assert_eq!(k.thread(main).pending.iter().find(|(r, _)| *r == R1).unwrap().1, 0);
    let text = lines(&k).join("\n");
    assert!(text.contains("WaitSynchronization1(événement#4 « attendu ») : attend"), "{text}");
}

#[test]
fn wait_timeout_wakes_with_the_timeout_code_and_time_jumps() {
    let (mut k, script) = setup();
    let event = k.create_event(RESET_ONESHOT, "");
    let handle = k.add_handle(event).unwrap();
    // 5 ms d'attente, puis un appel système pour voir le résultat
    let reason = run_program(&mut k, &script, vec![
        svc(0x24, &[(R0, handle), (R2, 5_000_000), (R3, 0)]),
        svc(0x35, &[]),
    ]);
    assert!(reason.contains("fin du scénario"));
    assert!(k.now >= 5_000_000, "l'horloge a sauté à l'échéance : {}", k.now);
    // GetProcessId a été exécuté après le réveil ; avant, r0 valait TIMEOUT (posé à l'entrée dans l'attente)
    assert_eq!(k.cpu.get(R1), 0x30);
}

#[test]
fn sleep_thread_blocks_for_the_given_time() {
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![svc(0x0A, &[(R0, 1_000_000), (R1, 0)]), svc(0x35, &[])]);
    assert!(k.now >= 1_000_000);
    let text = lines(&k).join("\n");
    assert!(text.contains("(sommeil 1000 µs)"), "{text}");
}

#[test]
fn mutex_release_by_non_owner_is_refused() {
    let (mut k, script) = setup();
    let mutex = k.create_mutex(None, "");
    let handle = k.add_handle(mutex).unwrap();
    run_program(&mut k, &script, vec![svc(0x14, &[(R0, handle)])]);
    assert_eq!(k.cpu.get(R0), ERR_NOT_OWNER);
    // pris à la création, rendu par son propriétaire
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![svc(0x13, &[(R1, 1)]), svc(0x14, &[(R0, 0x8000)])]);
    assert_eq!(k.cpu.get(R0), OK);
}

#[test]
fn mutex_blocks_another_thread_until_released() {
    let (mut k, _script) = setup();
    let other = k.create_thread(0x10_0100, 0, 0x1000_0000, 0x30, 0, "autre");
    let mutex = k.create_mutex(Some(k.threads[0]), "");
    assert!(!k.is_free(mutex, other));
    assert!(k.is_free(mutex, k.threads[0]));
    let mut wait = Wait::new(WaitKind::Sync);
    wait.objects = vec![mutex];
    k.block(other, wait);
    k.switch_to(k.threads[0]);
    if let Obj::Mutex(m) = &mut k.objects[mutex].data {
        m.depth = 1;
    }
    // le propriétaire libère : le fil en attente est réveillé
    k.thread_mut(k.threads[0]).state = ThreadState::Ready;
    let (mut m_owner, mut depth) = (None, 0);
    if let Obj::Mutex(m) = &mut k.objects[mutex].data {
        m.depth -= 1;
        if m.depth == 0 {
            m.owner = None;
        }
        (m_owner, depth) = (m.owner, m.depth);
    }
    assert_eq!((m_owner, depth), (None, 0));
    k.wake_waiters();
    assert_eq!(k.thread(other).state, ThreadState::Ready);
    if let Obj::Mutex(m) = &k.objects[mutex].data {
        assert_eq!(m.owner, Some(other));
    }
}

#[test]
fn semaphore_release_counts_and_limits() {
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![
        svc(0x15, &[(R1, 0), (R2, 2)]),                 // CreateSemaphore(0, max 2)
        svc(0x16, &[(R1, 0x8000), (R2, 2)]),            // ReleaseSemaphore(2) -> compte 2, précédent 0
    ]);
    assert_eq!(k.cpu.get(R0), OK);
    assert_eq!(k.cpu.get(R1), 0);
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![
        svc(0x15, &[(R1, 0), (R2, 2)]),
        svc(0x16, &[(R1, 0x8000), (R2, 3)]),            // au-delà du maximum
    ]);
    assert_eq!(k.cpu.get(R0), ERR_INVALID_COMBINATION);
}

#[test]
fn timer_fires_once_and_periodically() {
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![
        svc(0x1A, &[(R1, 1)]),                                        // CreateTimer(sticky)
        svc(0x1B, &[(R0, 0x8000), (R1, 1_000_000), (R2, 1_000_000), (R3, 0), (R4, 0)]), // SetTimer(1 ms, période 1 ms)
    ]);
    let timer = k.handles.get(0x8000).unwrap();
    k.now = 1_004_000;
    k.run_due_events();
    assert!(matches!(&k.objects[timer].data, Obj::Timer(t) if t.signaled));
    // la période réarme l'échéance
    assert_eq!(k.next_event_time(), Some(2_004_000));
    if let Obj::Timer(t) = &mut k.objects[timer].data {
        t.signaled = false;
    }
    k.now = 2_004_000;
    k.run_due_events();
    assert!(matches!(&k.objects[timer].data, Obj::Timer(t) if t.signaled));
}

#[test]
fn address_arbiter_waits_and_signals() {
    let (mut k, script) = setup();
    k.memory.map(0x0800_0000, 0x1000, PERM_RW, "tas", None).unwrap();
    k.memory.w32(0x0800_0000, 0).unwrap();
    // CreateAddressArbiter ; ArbitrateAddress(attend si la valeur est inférieure à 1, type 1 WAIT_IF_LESS_THAN)
    run_program(&mut k, &script, vec![
        svc(0x21, &[]),
        svc(0x22, &[(R0, 0x8000), (R1, 0x0800_0000), (R2, 1), (R3, 1), (R4, 0), (R5, 0)]),
    ]);
    let main = k.threads[0];
    assert_eq!(k.thread(main).state, ThreadState::Waiting);
    assert_eq!(k.thread(main).wait.as_ref().unwrap().kind, WaitKind::Arbiter);
    // un second fil signale l'adresse (type 0 SIGNAL, tous les fils)
    let other = k.create_thread(0x10_0100, 0, 0x1000_0000, 0x30, 0, "autre");
    k.switch_to(other);
    script.borrow_mut().push_back(svc(0x22, &[(R0, 0x8000), (R1, 0x0800_0000), (R2, 0), (R3, 0xFFFF_FFFF), (R4, 0), (R5, 0)]));
    k.run(10_000_000_000, &mut |_| None);
    assert_eq!(k.thread(main).state, ThreadState::Ready);
}

#[test]
fn control_memory_heap_linear_alias_and_query() {
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![
        svc(0x01, &[(R0, 3), (R1, 0x0800_0000), (R2, 0), (R3, 0x4000), (R4, 3)]),          // heap
        svc(0x01, &[(R0, 0x10003), (R1, 0), (R2, 0), (R3, 0x2000), (R4, 3)]),              // linéaire
    ]);
    assert_eq!(k.cpu.get(R0), OK);
    assert_eq!(k.cpu.get(R1), 0x1400_0000);
    k.memory.w32(0x0800_0000, 0xCAFE_BABE).unwrap();
    // alias du tas à une autre adresse (op 4 : MAP)
    k.cpu.set(R0, 0);
    script.borrow_mut().extend(vec![
        svc(0x01, &[(R0, 4), (R1, 0x0900_0000), (R2, 0x0800_0000), (R3, 0x1000), (R4, 3)]),
        svc(0x02, &[(R2, 0x0800_1000)]),                                                    // QueryMemory
    ]);
    k.run(10_000_000_000, &mut |_| None);
    assert_eq!(k.memory.u32(0x0900_0000).unwrap(), 0xCAFE_BABE, "l'alias voit les mêmes octets");
    assert_eq!(k.cpu.get(R1), 0x0800_0000);
    assert_eq!(k.cpu.get(R2), 0x4000);
    let text = lines(&k).join("\n");
    assert!(text.contains("(tas)") && text.contains("(tas linéaire)") && text.contains("(alias)"), "{text}");
    // adresse mal alignée
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![svc(0x01, &[(R0, 3), (R1, 0x0800_0010), (R2, 0), (R3, 0x1000), (R4, 3)])]);
    assert_eq!(k.cpu.get(R0), ERR_MISALIGNED_ADDRESS);
}

#[test]
fn shared_memory_block_maps_to_its_own_address() {
    let (mut k, script) = setup();
    let block = k.create_shared(0x2000, None, 0x1000_2000, "bloc");
    k.shared(block).w32(0x10, 0x1234_5678);
    let handle = k.add_handle(block).unwrap();
    run_program(&mut k, &script, vec![svc(0x1F, &[(R0, handle), (R1, 0x1000_2000), (R2, 3), (R3, 3)])]);
    assert_eq!(k.cpu.get(R0), OK);
    assert_eq!(k.memory.u32(0x1000_2010).unwrap(), 0x1234_5678);
    // hors de la plage permise
    let (mut k, script) = setup();
    let block = k.create_shared(0x1000, None, 0, "bloc");
    let handle = k.add_handle(block).unwrap();
    run_program(&mut k, &script, vec![svc(0x1F, &[(R0, handle), (R1, 0x2000_0000), (R2, 3), (R3, 3)])]);
    assert_eq!(k.cpu.get(R0), ERR_INVALID_ADDRESS);
}

#[test]
fn threads_are_created_and_scheduled_by_priority() {
    let (mut k, script) = setup();
    // le fil principal crée un fil plus prioritaire (0x10) : il passe devant à la sortie de l'appel système
    run_program(&mut k, &script, vec![svc(0x08, &[(R0, 0x10), (R1, 0x10_0200), (R2, 7), (R3, 0x0FF0_8000), (R4, 0xFFFF_FFFE)])]);
    assert_eq!(k.threads.len(), 2);
    let text = lines(&k).join("\n");
    assert!(text.contains("fil 0x41 créé : entrée 0x100200"), "{text}");
    assert!(text.contains("CreateThread(entrée 0x100200"), "{text}");
    assert!(text.contains("cœur -2"), "{text}");
    // le fil créé a r0 = 7 et le stockage local suivant
    let second = k.threads[1];
    assert_eq!(k.thread(second).tls, TLS_BASE + TLS_SLOT);
    assert_eq!(k.current, Some(second), "le plus prioritaire a pris la place");
    assert_eq!(k.cpu.get(R0), 7);
}

#[test]
fn a_slice_hands_over_to_the_longest_waiting_thread() {
    let (mut k, script) = setup();
    let other = k.create_thread(0x10_0100, 0, 0x1000_0000, 0x30, 0, "autre");
    script.borrow_mut().push_back(Step { regs: vec![], stop: Stop::Limit { pc: 0x10_0010 } });
    script.borrow_mut().push_back(svc(0x35, &[]));
    k.run(10_000_000_000, &mut |_| None);
    // 200 000 instructions x 4 ns = 0,8 ms pour la tranche, 2 µs pour l'appel système
    assert_eq!(k.now, 800_000 + 2000);
    assert_eq!(k.current, Some(other), "le fil qui attendait passe, à priorité égale");
}

#[test]
fn unknown_svc_returns_not_implemented() {
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![svc(0x7E, &[])]);
    assert_eq!(k.cpu.get(R0), ERR_NOT_IMPLEMENTED);
    assert!(lines(&k).join("\n").contains("pas fait par le banc : rend 0xf8c007f4"));
}

#[test]
fn close_handle_and_duplicate() {
    let (mut k, script) = setup();
    run_program(&mut k, &script, vec![
        svc(0x17, &[(R1, 0)]),                  // CreateEvent -> 0x8000
        svc(0x27, &[(R1, 0x8000)]),             // DuplicateHandle
    ]);
    let duplicate = k.cpu.get(R1);
    assert_ne!(duplicate, 0x8000);
    assert_eq!(k.handles.get(duplicate), k.handles.get(0x8000));
    run_program(&mut k, &script, vec![svc(0x23, &[(R0, 0x8000)]), svc(0x23, &[(R0, 0x8000)])]);
    assert_eq!(k.cpu.get(R0), ERR_INVALID_HANDLE, "la seconde fermeture échoue");
}

#[test]
fn exit_thread_frees_the_tls_slot_and_wait_on_thread_works() {
    let (mut k, script) = setup();
    let other = k.create_thread(0x10_0100, 0, 0x1000_0000, 0x30, 0, "autre");
    let handle = k.add_handle(other).unwrap();
    assert!(k.tls_used.contains(&1));
    k.switch_to(other);
    run_program(&mut k, &script, vec![svc(0x09, &[])]);
    assert_eq!(k.thread(other).state, ThreadState::Dead);
    assert!(!k.tls_used.contains(&1));
    assert!(k.is_free(k.handles.get(handle).unwrap(), k.threads[0]), "un fil fini est « libre » pour une attente");
}

// --- IPC ---

/// Un service de test : renvoie le premier mot plus 1, et déplace une poignée d'événement.
struct Echo {
    seen: Rc<RefCell<Vec<(u32, Vec<u32>)>>>,
    event: ObjId,
}

impl Service for Echo {
    fn name(&self) -> &str {
        "echo"
    }

    fn kind(&self) -> &'static str {
        "simplifié"
    }

    fn handle(&mut self, k: &mut Kernel, req: &Request) -> Reply {
        self.seen.borrow_mut().push((req.header, req.w.clone()));
        match req.command {
            1 => Reply::with_words(0, &[req.word(1) + 1]).with_note("un de plus"),
            2 => {
                // tampon statique reçu -> renvoyé dans le tampon de réception 0, poignée copiée
                let data = req.static_data(k, 1);
                Reply::with_words(0, &[data.len() as u32]).static_buffer(0, &data).copy_handles(&[self.event])
            }
            _ => kernel::ipc::unknown_command(),
        }
    }
}

#[test]
fn ipc_request_reply_header_and_journal_line() {
    let (mut k, _script) = test_kernel();
    let main = test_main_thread(&mut k);
    let event = k.create_event(RESET_ONESHOT, "");
    let seen = Rc::new(RefCell::new(Vec::new()));
    let service: SharedService = Rc::new(RefCell::new(Echo { seen: seen.clone(), event }));
    let session = k.new_session(service, "echo");
    let words = call(&mut k, main, session, &[header(1, 1, 0), 41]);
    assert_eq!(words, vec![header(1, 2, 0), 0, 42]);
    assert_eq!(seen.borrow()[0].1, vec![header(1, 1, 0), 41]);
    let line = lines(&k).into_iter().find(|l| l.contains("IPC echo")).unwrap();
    assert!(line.contains("IPC echo 00010040 ? (simplifié) [00000029] -> 00010080 00000000 [0000002a]  « un de plus »"),
        "{line}");
    // commande inconnue : en-tête 0x40 et code 0xD900182F
    let words = call(&mut k, main, session, &[header(9, 0, 0)]);
    assert_eq!(words, vec![0x40, 0xD900_182F]);
}

#[test]
fn ipc_static_buffers_and_handle_translation() {
    let (mut k, _script) = test_kernel();
    let main = test_main_thread(&mut k);
    k.memory.map(0x0800_0000, 0x1000, PERM_RWX, "tas", None).unwrap();
    k.memory.write(0x0800_0100, b"abcdef").unwrap();
    let event = k.create_event(RESET_ONESHOT, "");
    let seen = Rc::new(RefCell::new(Vec::new()));
    let service: SharedService = Rc::new(RefCell::new(Echo { seen, event }));
    let session = k.new_session(service, "echo");
    // le client déclare son tampon de réception 0 à tls + 0x180 : (taille << 14 | 2), adresse
    let tls = k.thread(main).tls;
    k.memory.w32(tls + 0x180, 6 << 14 | 2).unwrap();
    k.memory.w32(tls + 0x184, 0x0800_0200).unwrap();
    // requête : 0 mot ordinaire, 1 descripteur de tampon statique (indice 0, taille 6) + adresse
    let words = call(&mut k, main, session, &[header(2, 0, 2), 6 << 14 | 2, 0x0800_0100]);
    assert_eq!(k.memory.read(0x0800_0200, 6).unwrap(), b"abcdef");
    // réponse : 1 mot (résultat) + 1 mot (longueur) ; 2 + 2 traduits (statique, poignée copiée)
    assert_eq!(words[0], header(2, 2, 4));
    assert_eq!(words[2], 6);
    assert_eq!(words[3], 6 << 14 | 2);
    assert_eq!(words[4], 0x0800_0200);
    assert_eq!(words[5], 0, "copie d'une poignée : 1 poignée, ni déplacée ni pid");
    assert_ne!(words[6], 0);
    assert_eq!(k.handles.get(words[6]), Some(event));
}

#[test]
fn ipc_moved_handles_are_closed_in_the_client() {
    let (mut k, _script) = test_kernel();
    let main = test_main_thread(&mut k);
    let event = k.create_event(RESET_ONESHOT, "");
    let handle = k.add_handle(event).unwrap();
    let seen = Rc::new(RefCell::new(Vec::new()));
    let service: SharedService = Rc::new(RefCell::new(Echo { seen, event }));
    let session = k.new_session(service, "echo");
    // descripteur 0x10 : une poignée déplacée
    call(&mut k, main, session, &[header(1, 1, 2), 5, 0x10, handle]);
    assert_eq!(k.handles.get(handle), None, "la poignée déplacée est fermée chez le client");
}

#[test]
fn connect_to_port_and_send_sync_request_through_svcs() {
    let (mut k, script) = setup();
    let event = k.create_event(RESET_ONESHOT, "");
    let seen = Rc::new(RefCell::new(Vec::new()));
    let service: SharedService = Rc::new(RefCell::new(Echo { seen: seen.clone(), event }));
    k.ports.insert("echo".into(), service);
    let tls = k.thread(k.threads[0]).tls;
    k.memory.write(0x0FF0_0000, b"echo\0").unwrap();
    k.memory.write(tls + 0x80, &[header(1, 1, 0).to_le_bytes(), 9u32.to_le_bytes()].concat()).unwrap();
    run_program(&mut k, &script, vec![
        svc(0x2D, &[(R1, 0x0FF0_0000)]),
        svc(0x32, &[(R0, 0x8000)]),
    ]);
    assert_eq!(k.cpu.get(R0), OK);
    assert_eq!(k.memory.u32(tls + 0x88).unwrap(), 10);
    assert_eq!(seen.borrow().len(), 1);
    let text = lines(&k).join("\n");
    assert!(text.contains("ConnectToPort(\"echo\") -> h=0x8000"), "{text}");
}
