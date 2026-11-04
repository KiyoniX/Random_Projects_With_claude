//! L'envoi au GPU sur un fil à lui : `CommandEncoder::finish` (où wgpu encode les passes) et `Queue::submit` prenaient
//! 22 % du fil principal (profil du 4/11), qui ne fait plus que les poser dans une file.
//!
//! L'ordre de la file de wgpu est gardé : le fil d'envoi fait, dans l'ordre reçu, les écritures des grands tampons de
//! chaque envoi puis l'envoi lui-même. Qui touche la file autrement (relire une image, la fenêtre qui dessine les
//! écrans) appelle d'abord [`Submitter::wait`]. Les ressources créées avec leurs données (`create_texture_with_data`)
//! n'ont pas besoin d'attendre : neuves, aucun envoi plus ancien ne les lit.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Un envoi : les grands tampons à écrire d'abord (tampon, octets, longueur utile, numéro de l'arène qui reprend les
/// octets), puis les commandes.
struct Job {
    uploads: Vec<(wgpu::Buffer, Vec<u8>, usize, usize)>,
    commands: wgpu::CommandEncoder,
}

struct Shared {
    /// (envois faits, envois posés) : `wait` attend que les deux soient égaux.
    counts: Mutex<(u64, u64)>,
    done: Condvar,
}

/// Partagé par le moteur et la fenêtre (`Gpu`) ; le fil d'envoi s'arrête quand le dernier exemplaire disparaît. Il
/// n'est pas rejoint : à la sortie du programme, un envoi posé après la dernière attente peut ne pas partir, ce qui
/// est sans effet puisque personne ne le relit. La file n'a pas de borne : la fenêtre et les relectures attendent à
/// chaque image, ce qui la garde courte (supposé, non mesuré).
#[derive(Clone)]
pub struct Submitter {
    jobs: Sender<Job>,
    shared: Arc<Shared>,
    thread: Arc<JoinHandle<()>>,
    returned: Arc<Mutex<Receiver<(usize, Vec<u8>)>>>,
}

impl Submitter {
    pub fn new(queue: wgpu::Queue) -> Submitter {
        let (jobs, rx) = channel::<Job>();
        let (back, returned) = channel();
        let shared = Arc::new(Shared { counts: Mutex::new((0, 0)), done: Condvar::new() });
        let worker = shared.clone();
        let thread = std::thread::Builder::new()
            .name("envoi GPU".into())
            .spawn(move || {
                for job in rx {
                    for (buffer, bytes, len, arena) in job.uploads {
                        queue.write_buffer(&buffer, 0, &bytes[..len]);
                        let _ = back.send((arena, bytes));
                    }
                    queue.submit(Some(job.commands.finish()));
                    let mut counts = worker.counts.lock().unwrap();
                    counts.0 += 1;
                    worker.done.notify_all();
                }
            })
            .expect("fil d'envoi au GPU");
        Submitter { jobs, shared, thread: Arc::new(thread), returned: Arc::new(Mutex::new(returned)) }
    }

    /// Pose un envoi : `uploads` (tampon, octets, longueur, arène) sont écrits avant les commandes.
    pub fn send(&self, uploads: Vec<(wgpu::Buffer, Vec<u8>, usize, usize)>, commands: wgpu::CommandEncoder) {
        self.shared.counts.lock().unwrap().1 += 1;
        self.jobs.send(Job { uploads, commands }).expect("fil d'envoi au GPU arrêté");
    }

    /// Les octets d'une arène déjà écrits dans la file, à reprendre (numéro de l'arène, octets).
    pub fn take_returned(&self) -> Vec<(usize, Vec<u8>)> {
        self.returned.lock().unwrap().try_iter().collect()
    }

    /// Attend que tout ce qui a été posé soit dans la file de wgpu. Un fil d'envoi tombé (une erreur de wgpu le fait
    /// paniquer) fait paniquer ici aussi, plutôt que d'attendre sans fin.
    pub fn wait(&self) {
        let mut counts = self.shared.counts.lock().unwrap();
        while counts.0 < counts.1 {
            counts = self.shared.done.wait_timeout(counts, Duration::from_millis(100)).unwrap().0;
            if counts.0 < counts.1 && self.thread.is_finished() {
                panic!("le fil d'envoi au GPU s'est arrêté");
            }
        }
    }
}
