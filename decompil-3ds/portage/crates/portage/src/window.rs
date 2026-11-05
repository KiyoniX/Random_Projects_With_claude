//! Les fenêtres : les écrans dessinés avec le GPU même du rendu (la surface vient de l'instance de pica : pas de second
//! appareil). [`Screens`] sert à la capture rejouée (`portage window`, les deux écrans l'un sur l'autre) comme au jeu en
//! direct (`portage play`, voir [`Layout`]).
//!
//! `portage window` : 1 à 4 changent l'échelle de rendu (la capture est rejouée), Gauche et Droite changent d'image, L
//! bascule entre l'agrandissement lissé et au plus proche, Échap quitte.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use pica::ScreenImage;
use pica::render::Gpu;
use wgpu::util::DeviceExt;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

use capture::Capture;

use crate::ui::{Pill, Ui};

const SHADER: &str = r#"
struct Rect { v: vec4<f32>, uv: vec4<f32> }   // x0, y0, x1, y1 en coordonnées d'écran (-1..1, y vers le haut), puis le morceau d'image
@group(0) @binding(0) var<uniform> rect: Rect;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
struct Out { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
    let c = vec2<f32>(f32(i & 1u), f32((i >> 1u) & 1u));
    var o: Out;
    o.p = vec4<f32>(mix(rect.v.x, rect.v.z, c.x), mix(rect.v.w, rect.v.y, c.y), 0.0, 1.0);
    o.uv = mix(rect.uv.xy, rect.uv.zw, vec2<f32>(c.x, 1.0 - c.y));   // la première ligne de l'image est en haut
    return o;
}
@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
    return textureSample(img, samp, in.uv);
}
"#;

/// Où vont les écrans, en pixels de la console.
#[derive(Clone, Copy)]
pub enum Layout {
    /// Le haut sur les 240 premières lignes d'un 400 x 480, le bas centré en dessous.
    Stacked,
    /// Le haut remplit un 400 x 240 ; le bas s'y pose au centre, à la même échelle : les deux écrans ont 240 lignes.
    Overlaid,
    /// Le haut remplit un 400 x 240 ; le bas, à moitié de sa taille, occupe le coin en bas à droite (l'interface de combat).
    Corner,
    /// Échap : le bas dans le coin en bas à droite (`MENU_CORNER`), dans un cadre dessiné par la fenêtre (celui des plaques
    /// de PV), le jeu visible autour.
    MenuCorner,
    /// Le haut remplit un 400 x 240 ; seuls les deux boutons d'une question, l'un au-dessus de l'autre, en bas à droite.
    YesNo,
    /// Le haut remplit un 400 x 240 ; les quatre boutons de capacité sont empilés à droite.
    Moves,
    /// `Corner` et `Moves` plus étroits, avec plusieurs Pokémon de chaque côté (double, triple, rotation) : caméra au repos, le
    /// Pokémon de droite et l'ennemi de droite s'arrêtent vers x = 310.
    SmallCorner,
    SmallMoves,
    /// Les boutons dessinés par la fenêtre (`ui`) : le menu du combat (Attaque, Pokémon, Sac, Fuite) ou les quatre
    /// capacités et le retour, en colonne en bas à droite ; vrai : plus étroite, avec plusieurs Pokémon de chaque côté.
    /// Chaque bouton garde la zone que le jeu touche (`local/analyse/DllBattle/boutons-natifs.md`). La Méga-Évolution et
    /// « Déplacer » du triple n'ont pas encore de pastille (quand le jeu les montre n'est pas lu) : Échap.
    NativeMenu(bool),
    NativeMoves(bool, MoveExtras),
    /// Le sac du combat, dessiné de même : ses catégories, la liste d'une catégorie (six objets, les pages, le retour) ou la
    /// fiche d'un objet (`local/analyse/DllBattle/sac-natif.md`).
    NativeBag(BagPage, bool),
    /// L'apprentissage d'une capacité après une montée de niveau : la question (deux boutons, plus larges), la liste d'oubli
    /// (quatre capacités, la nouvelle, le retour) ou la fiche d'une capacité (`local/analyse/DllBattle/apprendre-natif.md`).
    NativeLearn(LearnPage, bool),
    /// L'équipe : la liste des six (menu, remplacement après un K.O., objet du sac) ou la fiche d'un Pokémon
    /// (`local/analyse/DllBattle/equipe-natif.md`).
    NativeParty(PartyPage, bool),
}

/// L'écran de l'équipe montré.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PartyPage {
    List,
    Command,
    /// Les sous-écrans de la fiche (`fiche-pokemon-natif.md`) : Résumé, Capacités, la fiche d'une capacité, Soigner.
    Summary,
    Moves,
    MoveInfo,
    Heal,
}

/// L'étape de l'apprentissage montrée.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum LearnPage {
    Question,
    Forget,
    Info,
}

/// Les boutons de plus de l'écran des capacités : la Méga-Évolution (si ce Pokémon peut méga-évoluer et que le joueur l'a
/// débloquée), « Déplacer » (en triple) (`local/analyse/DllBattle/questions-mega-double.md`).
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct MoveExtras {
    pub mega: bool,
    pub shift: bool,
}

/// L'écran du sac montré (`+0x1E8` des objets du combat : 1, 2, 3).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum BagPage {
    Pockets,
    List,
    Item,
}

/// Un morceau d'écran posé dans le repère : (x0, y0, x1, y1) dans la disposition, et ce qu'il montre en pixels de l'écran.
#[derive(Clone, Copy)]
struct Piece {
    bottom: bool,
    to: [f32; 4],
    from: [f32; 4],
}

const TOP_WHOLE: [f32; 4] = [0.0, 0.0, 400.0, 240.0];
/// L'écran du bas d'Échap : 110 x 82,5 (4 : 3) à 4 du bord, la zone choisie par l'utilisateur ; son cadre a `MENU_FRAME` de large.
pub const MENU_CORNER: [f32; 4] = [286.0, 153.5, 396.0, 236.0];
pub const MENU_FRAME: f32 = 3.5;
const BOTTOM_WHOLE: [f32; 4] = [0.0, 0.0, 320.0, 240.0];
/// Les quatre boutons de l'écran des capacités, deux par deux, en pixels de l'écran du bas.
const MOVE_BUTTONS: [[f32; 4]; 4] = [[0.0, 40.0, 160.0, 99.0], [160.0, 40.0, 320.0, 99.0], [0.0, 101.0, 160.0, 160.0], [160.0, 101.0, 320.0, 160.0]];
/// Le bas de cet écran : le retour et un bouton de plus (id 7 de `DllBattle`, peut-être la Méga-Évolution), à garder.
const MOVE_SCREEN_BOTTOM: [f32; 4] = [0.0, 160.0, 320.0, 240.0];
/// La colonne : une ligne par bouton, puis le bas de l'écran, en bas à droite de la fenêtre.
const MOVE_ROW_HEIGHT: f32 = 34.0;
const MOVE_ROW_WIDTH: f32 = 104.0;
const MOVE_BOTTOM_HEIGHT: f32 = 26.0;
const MAX_PIECES: usize = 12;
/// Les deux boutons d'une question (`app::YesNo` de `DllBattle`), relevés sur une capture de l'utilisateur.
const YES_NO_BUTTONS: [[f32; 4]; 2] = [[20.0, 90.0, 300.0, 128.0], [20.0, 160.0, 300.0, 198.0]];
const YES_NO_WIDTH: f32 = 160.0;
const YES_NO_HEIGHT: f32 = 22.0;
/// Sous cette ligne commence la boîte de dialogue du combat.
const DIALOG_TOP: f32 = 186.0;
const YES_NO_GAP: f32 = 6.0;
/// La largeur de `SmallCorner` et `SmallMoves`.
const SMALL_WIDTH: f32 = 88.0;
/// Les boutons du menu du combat dans l'écran du bas (panneaux du CLYT de `DllBattle`, table +0xcee50), dans l'ordre de la
/// colonne : Attaque, Pokémon, Sac, Fuite (en triple, Fuite est le retour du deuxième Pokémon : supposé).
pub const MENU_BUTTONS: [[f32; 4]; 4] = [[0.0, 26.0, 320.0, 170.0], [224.0, 180.0, 320.0, 240.0], [0.0, 180.0, 96.0, 240.0], [105.0, 184.0, 215.0, 240.0]];
/// Le retour de l'écran des capacités (panneau 0x7f de la table +0xcefa4).
const MOVES_BACK: [f32; 4] = [250.0, 190.0, 320.0, 240.0];
/// La colonne des boutons dessinés : largeur, hauteur d'une ligne, du retour.
const NATIVE_WIDTH: f32 = 124.0;
const NATIVE_ROW: f32 = 30.0;
const NATIVE_BACK: f32 = 22.0;
/// Les boutons du sac dans l'écran du bas (CLYT de `DllBattle`, tables +0xce084, +0xce1a8, +0xce398), dans l'ordre de la
/// colonne. Catégories : Soins PV/PP, Balls, Soins statut, Objets combat, Dernier objet, Retour.
pub const BAG_POCKETS: [[f32; 4]; 6] = [[0.0, 10.0, 160.0, 90.0], [160.0, 10.0, 320.0, 90.0], [0.0, 96.0, 160.0, 176.0], [160.0, 95.0, 320.0, 175.0], [5.0, 185.0, 245.0, 245.0], [250.0, 185.0, 320.0, 245.0]];
/// Les six cases d'objets (deux colonnes, la case i est l'objet page × 6 + i), puis précédente, suivante, retour.
pub const BAG_ITEMS: [[f32; 4]; 6] = [[3.0, 10.0, 157.0, 60.0], [163.0, 10.0, 317.0, 60.0], [3.0, 70.0, 157.0, 120.0], [163.0, 70.0, 317.0, 120.0], [3.0, 130.0, 157.0, 180.0], [163.0, 130.0, 317.0, 180.0]];
pub const BAG_LIST_BOTTOM: [[f32; 4]; 3] = [[5.0, 185.0, 55.0, 235.0], [70.0, 185.0, 120.0, 235.0], [250.0, 190.0, 320.0, 240.0]];
/// La fiche : Utiliser, Retour.
pub const BAG_ITEM_BUTTONS: [[f32; 4]; 2] = [[0.0, 160.0, 250.0, 240.0], [250.0, 180.0, 320.0, 240.0]];
/// L'apprentissage : les deux boutons de la question (table +0xced38), la liste d'oubli (+0xd0e30 : les quatre capacités,
/// la nouvelle, le retour), la fiche (+0xd0d0c : oublier ou arrêter, le retour).
pub const LEARN_QUESTION: [[f32; 4]; 2] = [[20.0, 80.0, 300.0, 140.0], [20.0, 150.0, 300.0, 210.0]];
pub const LEARN_FORGET: [[f32; 4]; 6] = [[0.0, 49.0, 160.0, 103.0], [160.0, 49.0, 320.0, 103.0], [0.0, 113.0, 160.0, 167.0], [160.0, 113.0, 320.0, 167.0], [80.0, 176.0, 240.0, 236.0], [250.0, 190.0, 320.0, 240.0]];
pub const LEARN_INFO: [[f32; 4]; 2] = [[10.0, 179.0, 250.0, 239.0], [250.0, 190.0, 320.0, 240.0]];
/// L'équipe : les six cases (table +0xce490, la case k est l'entrée [L+0x134 + 0x44 k]) puis le retour ; la fiche (CLYT
/// 0x147085a8) : Changer, Soigner, Résumé et Capacités sur une ligne, Retour.
pub const PARTY_LIST: [[f32; 4]; 7] = [[0.0, 5.0, 160.0, 55.0], [160.0, 8.0, 320.0, 58.0], [0.0, 65.0, 160.0, 115.0], [160.0, 68.0, 320.0, 118.0], [0.0, 125.0, 160.0, 175.0], [160.0, 128.0, 320.0, 178.0], [250.0, 190.0, 320.0, 240.0]];
pub const PARTY_COMMAND: [[f32; 4]; 5] = [[5.0, 41.0, 315.0, 151.0], [4.0, 160.0, 250.0, 190.0], [4.0, 195.0, 124.0, 225.0], [130.0, 195.0, 250.0, 225.0], [255.0, 190.0, 320.0, 240.0]];
/// Les sous-écrans de la fiche : chaque panneau d'informations touche une zone sans bouton de l'écran du jeu ; puis les
/// boutons (tables 0xd0654, 0xd0738, 0xd095c, 0xd0578).
pub const SUMMARY_PANEL: [f32; 4] = [10.0, 40.0, 310.0, 180.0];
pub const SUMMARY_BUTTONS: [[f32; 4]; 4] = [[10.0, 185.0, 60.0, 235.0], [70.0, 185.0, 120.0, 235.0], [130.0, 195.0, 250.0, 225.0], [250.0, 190.0, 320.0, 240.0]];
pub const PARTY_MOVES: [[f32; 4]; 4] = [[0.0, 46.0, 160.0, 106.0], [160.0, 46.0, 320.0, 106.0], [0.0, 110.0, 160.0, 170.0], [160.0, 110.0, 320.0, 170.0]];
pub const PARTY_MOVES_BOTTOM: [[f32; 4]; 4] = [[10.0, 185.0, 60.0, 235.0], [70.0, 185.0, 120.0, 235.0], [130.0, 190.0, 250.0, 230.0], [250.0, 190.0, 320.0, 240.0]];
pub const MOVE_INFO_PANEL: [f32; 4] = [10.0, 40.0, 310.0, 180.0];
pub const MOVE_INFO_BUTTONS: [[f32; 4]; 4] = [[110.0, 190.0, 160.0, 210.0], [160.0, 190.0, 210.0, 210.0], [110.0, 210.0, 160.0, 230.0], [160.0, 210.0, 210.0, 230.0]];
pub const HEAL_PANEL: [f32; 4] = [50.0, 32.0, 270.0, 132.0];
pub const HEAL_BUTTONS: [[f32; 4]; 3] = [[4.0, 160.0, 250.0, 190.0], [4.0, 195.0, 250.0, 225.0], [255.0, 190.0, 320.0, 240.0]];
/// La Méga-Évolution (85..235 x 150..240, mais en y 150..160 la capacité l'emporte) et « Déplacer » (0..80 x 200..240).
pub const MEGA_BUTTON: [f32; 4] = [85.0, 160.0, 235.0, 240.0];
pub const SHIFT_BUTTON: [f32; 4] = [0.0, 200.0, 80.0, 240.0];
/// La largeur des deux boutons de la question, aux libellés longs.
const QUESTION_WIDTH: f32 = 190.0;
/// La hauteur d'une ligne de la liste du sac, plus serrée (sept lignes).
const BAG_ROW: f32 = 26.0;

impl Layout {
    /// Le repère (largeur, hauteur).
    fn size(self) -> (f32, f32) {
        match self {
            Layout::Stacked => (400.0, 480.0),
            _ => (400.0, 240.0),
        }
    }

    /// Ce qu'on dessine, dans l'ordre.
    fn pieces(self) -> Vec<Piece> {
        let top = Piece { bottom: false, to: TOP_WHOLE, from: TOP_WHOLE };
        let bottom = |to| Piece { bottom: true, to, from: BOTTOM_WHOLE };
        match self {
            Layout::Stacked => vec![top, bottom([40.0, 240.0, 360.0, 480.0])],
            Layout::Overlaid => vec![top, bottom([40.0, 0.0, 360.0, 240.0])],
            Layout::Corner => vec![top, bottom([240.0, 120.0, 400.0, 240.0])],
            Layout::MenuCorner => vec![top, bottom(MENU_CORNER)],
            Layout::YesNo => {
                let mut pieces = vec![top];
                for (i, from) in YES_NO_BUTTONS.into_iter().enumerate() {
                    let y = DIALOG_TOP - (2 - i) as f32 * (YES_NO_HEIGHT + YES_NO_GAP);
                    pieces.push(Piece { bottom: true, to: [400.0 - YES_NO_WIDTH - 4.0, y, 396.0, y + YES_NO_HEIGHT], from });
                }
                pieces
            }
            Layout::Moves | Layout::SmallMoves => {
                let width = if matches!(self, Layout::Moves) { MOVE_ROW_WIDTH } else { SMALL_WIDTH };
                let k = width / MOVE_ROW_WIDTH;
                let (left, bottom_top) = (400.0 - width, 240.0 - MOVE_BOTTOM_HEIGHT * k);
                let mut pieces = vec![top];
                for (i, from) in MOVE_BUTTONS.into_iter().enumerate() {
                    let y = bottom_top - (4 - i) as f32 * MOVE_ROW_HEIGHT * k;
                    pieces.push(Piece { bottom: true, to: [left, y, 400.0, y + MOVE_ROW_HEIGHT * k], from });
                }
                pieces.push(Piece { bottom: true, to: [left, bottom_top, 400.0, 240.0], from: MOVE_SCREEN_BOTTOM });
                pieces
            }
            Layout::SmallCorner => {
                let height = SMALL_WIDTH * 240.0 / 320.0;
                vec![top, bottom([400.0 - SMALL_WIDTH, 240.0 - height, 400.0, 240.0])]
            }
            Layout::NativeMenu(small) | Layout::NativeMoves(small, _) | Layout::NativeBag(_, small) | Layout::NativeLearn(_, small) | Layout::NativeParty(_, small) => {
                // la question et les panneaux d'informations gardent leur taille : leurs textes sont longs
                let question = matches!(self, Layout::NativeLearn(LearnPage::Question, _));
                let wide = question || matches!(self, Layout::NativeParty(PartyPage::Summary | PartyPage::Moves | PartyPage::MoveInfo, _));
                let k = if small && !wide { SMALL_WIDTH / NATIVE_WIDTH } else { 1.0 };
                let width = if wide { QUESTION_WIDTH } else { NATIVE_WIDTH * k };
                let left = 400.0 - width - 2.0;
                // les lignes de la colonne (hauteur, boutons côte à côte)
                let row = |height: f32| move |from: [f32; 4]| (height, vec![from]);
                let rows: Vec<(f32, Vec<[f32; 4]>)> = match self {
                    Layout::NativeMenu(_) => MENU_BUTTONS.map(row(NATIVE_ROW)).to_vec(),
                    Layout::NativeMoves(_, extras) => {
                        let mut rows: Vec<(f32, Vec<[f32; 4]>)> = MOVE_BUTTONS.iter().copied().map(row(NATIVE_ROW)).collect();
                        if extras.mega {
                            rows.push((NATIVE_BACK, vec![MEGA_BUTTON]));
                        }
                        rows.push((NATIVE_BACK, if extras.shift { vec![SHIFT_BUTTON, MOVES_BACK] } else { vec![MOVES_BACK] }));
                        rows
                    }
                    Layout::NativeBag(BagPage::Pockets, _) => BAG_POCKETS.map(row(NATIVE_ROW)).to_vec(),
                    Layout::NativeBag(BagPage::List, _) => BAG_ITEMS.iter().copied().map(row(BAG_ROW)).chain([(BAG_ROW, BAG_LIST_BOTTOM.to_vec())]).collect(),
                    Layout::NativeLearn(LearnPage::Question, _) => LEARN_QUESTION.map(row(NATIVE_ROW)).to_vec(),
                    Layout::NativeLearn(LearnPage::Forget, _) => LEARN_FORGET.map(row(NATIVE_ROW)).to_vec(),
                    Layout::NativeLearn(LearnPage::Info, _) => LEARN_INFO.map(row(NATIVE_ROW)).to_vec(),
                    Layout::NativeParty(PartyPage::List, _) => PARTY_LIST.map(row(BAG_ROW)).to_vec(),
                    Layout::NativeParty(PartyPage::Command, _) => vec![
                        (NATIVE_ROW, vec![PARTY_COMMAND[0]]),
                        (NATIVE_ROW, vec![PARTY_COMMAND[1]]),
                        (NATIVE_ROW, vec![PARTY_COMMAND[2], PARTY_COMMAND[3]]),
                        (NATIVE_ROW, vec![PARTY_COMMAND[4]]),
                    ],
                    Layout::NativeParty(PartyPage::Summary, _) => vec![(150.0, vec![SUMMARY_PANEL]), (BAG_ROW, SUMMARY_BUTTONS.to_vec())],
                    Layout::NativeParty(PartyPage::Moves, _) => PARTY_MOVES.map(row(NATIVE_ROW)).into_iter().chain([(BAG_ROW, PARTY_MOVES_BOTTOM.to_vec())]).collect(),
                    Layout::NativeParty(PartyPage::MoveInfo, _) => vec![(128.0, vec![MOVE_INFO_PANEL]), (BAG_ROW, MOVE_INFO_BUTTONS.to_vec()), (BAG_ROW, vec![MOVES_BACK])],
                    Layout::NativeParty(PartyPage::Heal, _) => vec![(60.0, vec![HEAL_PANEL]), (NATIVE_ROW, vec![HEAL_BUTTONS[0]]), (NATIVE_ROW, vec![HEAL_BUTTONS[1]]), (NATIVE_ROW, vec![HEAL_BUTTONS[2]])],
                    _ => BAG_ITEM_BUTTONS.map(row(NATIVE_ROW)).to_vec(),
                };
                // de bas en haut : la dernière ligne touche le bas de l'image, ou le haut de la boîte de dialogue pour la
                // question (qu'on lise ce qu'elle demande)
                let mut y = if question { DIALOG_TOP - 2.0 } else { 238.0 };
                let mut pieces = Vec::new();
                for (height, froms) in rows.iter().rev() {
                    y -= height * k;
                    let w = (398.0 - left) / froms.len() as f32;
                    for (i, &from) in froms.iter().enumerate().rev() {
                        pieces.push(Piece { bottom: true, to: [left + i as f32 * w, y, left + (i + 1) as f32 * w, y + height * k], from });
                    }
                }
                pieces.reverse();
                pieces.insert(0, top);
                pieces
            }
        }
    }

    /// Où vont les boutons dessinés par la fenêtre, dans l'ordre (vide hors de `NativeMenu` et `NativeMoves`).
    pub fn native_places(self) -> Vec<[f32; 4]> {
        let bottom = self.pieces().into_iter().filter(|p| p.bottom).map(|p| p.to);
        match self {
            Layout::NativeMenu(_) | Layout::NativeMoves(..) | Layout::NativeBag(..) | Layout::NativeLearn(..) | Layout::NativeParty(..) => bottom.collect(),
            _ => Vec::new(),
        }
    }

    /// Le repère agrandi au mieux dans la fenêtre et centré : (échelle, décalage en x, décalage en y).
    fn fit(self, width: f32, height: f32) -> (f32, f32, f32) {
        let (w, h) = self.size();
        let f = (width / w).min(height / h);
        (f, (width - w * f) / 2.0, (height - h * f) / 2.0)
    }

    /// Le point de l'écran du bas sous ce pixel de la fenêtre, s'il y en a un.
    pub fn bottom_point(self, width: f32, height: f32, x: f32, y: f32) -> Option<(u16, u16)> {
        let (f, ox, oy) = self.fit(width, height);
        let (px, py) = ((x - ox) / f, (y - oy) / f);
        self.pieces().iter().find(|p| p.bottom && p.to[0] <= px && px < p.to[2] && p.to[1] <= py && py < p.to[3]).map(|p| {
            let u = (px - p.to[0]) / (p.to[2] - p.to[0]);
            let v = (py - p.to[1]) / (p.to[3] - p.to[1]);
            ((p.from[0] + u * (p.from[2] - p.from[0])) as u16, (p.from[1] + v * (p.from[3] - p.from[1])) as u16)
        })
    }
}

/// `background` : une fenêtre de rejeu (tests, captures), qui s'ouvre derrière les autres sans prendre la main.
pub fn open(event_loop: &ActiveEventLoop, title: &str, width: f64, height: f64, background: bool) -> Arc<Window> {
    let mut attributes = Window::default_attributes().with_title(title).with_inner_size(LogicalSize::new(width, height));
    if background {
        attributes = attributes.with_active(false).with_window_level(winit::window::WindowLevel::AlwaysOnBottom);
    }
    Arc::new(event_loop.create_window(attributes).expect("fenêtre"))
}

/// L'affichage des deux écrans dans une fenêtre.
pub struct Screens {
    pub window: Arc<Window>,
    gpu: Gpu,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    nearest: wgpu::Sampler,
    linear: wgpu::Sampler,
    /// Le rectangle de chaque morceau d'écran dessiné.
    rects: [wgpu::Buffer; MAX_PIECES],
    /// Les boutons dessinés par la fenêtre (`ui`) : demandés par [`Screens::set_overlay`] (pastilles, zone dans le repère),
    /// faits en image à la taille de la fenêtre, posés avec leur transparence ; tant qu'ils sont là, les morceaux de
    /// l'écran du bas ne sont plus dessinés (ils gardent les touchers).
    ui: Option<Ui>,
    overlay: Option<(Vec<Pill>, [f32; 4])>,
    overlay_image: Option<(Vec<Pill>, [f32; 4], u32, wgpu::Texture)>,
    blend: wgpu::RenderPipeline,
    overlay_rect: wgpu::Buffer,
}

impl Screens {
    pub fn new(window: Arc<Window>, gpu: Gpu) -> Result<Screens, String> {
        let surface = gpu.instance.create_surface(window.clone()).map_err(|e| format!("surface : {e}"))?;
        let size = window.inner_size();
        let mut config = surface.get_default_config(&gpu.adapter, size.width.max(1), size.height.max(1)).ok_or("surface incompatible avec le GPU du rendu")?;
        // les images (celles de pica comme celles qu'on envoie) sont en Rgba8Unorm et portent déjà les octets des PNG :
        // une surface sans sRGB les affiche telles quelles, sans seconde conversion
        config.format = surface.get_capabilities(&gpu.adapter).formats.into_iter().find(|f| !f.is_srgb()).ok_or("aucun format de surface sans sRGB")?;
        config.present_mode = wgpu::PresentMode::AutoVsync;
        let device = &gpu.device;
        surface.configure(device, &config);
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("fenêtre"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("fenêtre"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::VERTEX, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("fenêtre"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let make = |blend: Option<wgpu::BlendState>| device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("fenêtre"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: config.format, blend, write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });
        // les écrans remplacent ce qui est dessous ; les boutons (alpha prémultiplié) se posent par-dessus
        let (pipeline, blend) = (make(None), make(Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)));
        let sampler = |filter| device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: filter, min_filter: filter, ..Default::default() });
        let (nearest, linear) = (sampler(wgpu::FilterMode::Nearest), sampler(wgpu::FilterMode::Linear));
        let rect = || device.create_buffer(&wgpu::BufferDescriptor { label: Some("rectangle"), size: 32, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let rects = std::array::from_fn(|_| rect());
        let overlay_rect = rect();
        Ok(Screens { window, gpu, surface, config, pipeline, layout, nearest, linear, rects, ui: Ui::new(), overlay: None, overlay_image: None, blend, overlay_rect })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&self.gpu.device, &self.config);
        self.window.request_redraw();
    }

    /// La fenêtre a sa police : elle peut dessiner les boutons du combat.
    pub fn has_ui(&self) -> bool {
        self.ui.is_some()
    }

    /// Les boutons à dessiner par-dessus le haut (`None` : les morceaux de l'écran du bas). Sans police, rien ne change.
    pub fn set_overlay(&mut self, overlay: Option<(Vec<Pill>, [f32; 4])>) {
        self.overlay = overlay.filter(|_| self.ui.is_some());
    }

    /// L'image des boutons à la taille où la fenêtre les montre, refaite seulement si eux ou cette taille changent : avant
    /// de dessiner ou de capturer.
    pub fn update_overlay(&mut self, layout: Layout) {
        let (Some((pills, area)), Some(ui)) = (&self.overlay, &self.ui) else { return };
        let (f, _, _) = layout.fit(self.config.width as f32, self.config.height as f32);
        let px = ((area[2] - area[0]) * f) as u32;
        if self.overlay_image.as_ref().is_some_and(|(p, a, w, _)| p == pills && a == area && *w == px) {
            return;
        }
        let (w, h, rgba) = ui.raster(pills, *area, f);
        let texture = self.gpu.device.create_texture_with_data(
            &self.gpu.queue,
            &wgpu::TextureDescriptor {
                label: Some("boutons"),
                size: wgpu::Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &rgba,
        );
        self.overlay_image = Some((pills.clone(), *area, px, texture));
    }

    /// La texture d'une image d'écran : celle que pica a construite sur le GPU, sinon ses octets envoyés au même format.
    pub fn texture(&self, image: &ScreenImage) -> wgpu::Texture {
        if let Some(texture) = &image.texture {
            return texture.clone();
        }
        let (width, height) = (image.width, image.height);
        self.gpu.device.create_texture_with_data(
            &self.gpu.queue,
            &wgpu::TextureDescriptor {
                label: Some("écran"),
                size: wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &image.rgba,
        )
    }

    /// Encode les écrans du haut et du bas (s'ils existent) dans `view`, une image de `width` x `height`.
    fn compose(&self, view: &wgpu::TextureView, width: u32, height: u32, textures: [Option<&wgpu::Texture>; 2], smooth: bool, layout: Layout) -> wgpu::CommandEncoder {
        // les écrans viennent du moteur : son travail doit être dans la file avant celui de la fenêtre
        self.gpu.submitter.wait();
        let (ww, wh) = (width as f32, height as f32);
        let (f, ox, oy) = layout.fit(ww, wh);
        let px = |x: f32| (ox + x * f) / ww * 2.0 - 1.0;
        let py = |y: f32| 1.0 - (oy + y * f) / wh * 2.0;
        let bind = |rect: &wgpu::Buffer, words: [f32; 8], texture: &wgpu::Texture, sampler: &wgpu::Sampler| {
            self.gpu.queue.write_buffer(rect, 0, bytemuck::cast_slice(&words));
            let texture_view = texture.create_view(&Default::default());
            self.gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("écran"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: rect.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&texture_view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
                ],
            })
        };
        let overlay = self.overlay.as_ref().and(self.overlay_image.as_ref());
        let natives = layout.native_places();
        let mut binds = Vec::new();
        for (piece, rect) in layout.pieces().iter().zip(&self.rects) {
            let Some(texture) = textures[piece.bottom as usize] else { continue };
            if piece.bottom && overlay.is_some() && natives.contains(&piece.to) {
                continue;
            }
            let (w, h) = if piece.bottom { (320.0, 240.0) } else { (400.0, 240.0) };
            let [tx0, ty0, tx1, ty1] = piece.to;
            let [sx0, sy0, sx1, sy1] = piece.from;
            let words = [px(tx0), py(ty0), px(tx1), py(ty1), sx0 / w, sy0 / h, sx1 / w, sy1 / h];
            binds.push(bind(rect, words, texture, if smooth { &self.linear } else { &self.nearest }));
        }
        let overlay_bind = overlay.map(|(_, area, _, texture)| {
            bind(&self.overlay_rect, [px(area[0]), py(area[1]), px(area[2]), py(area[3]), 0.0, 0.0, 1.0, 1.0], texture, &self.linear)
        });
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("fenêtre"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.02, g: 0.02, b: 0.03, a: 1.0 }), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            for bind in &binds {
                pass.set_bind_group(0, bind, &[]);
                pass.draw(0..4, 0..1);
            }
            if let Some(bind) = &overlay_bind {
                pass.set_pipeline(&self.blend);
                pass.set_bind_group(0, bind, &[]);
                pass.draw(0..4, 0..1);
            }
        }
        encoder
    }

    /// Dessine les écrans du haut et du bas (s'ils existent) et présente l'image.
    pub fn draw(&mut self, textures: [Option<&wgpu::Texture>; 2], smooth: bool, layout: Layout) {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.gpu.device, &self.config);
                return;
            }
            _ => return,
        };
        let view = frame.texture.create_view(&Default::default());
        self.update_overlay(layout);
        let encoder = self.compose(&view, self.config.width, self.config.height, textures, smooth, layout);
        self.gpu.queue.submit(Some(encoder.finish()));
        frame.present();
    }

    /// Les deux écrans composés comme dans une fenêtre (même passe, même format de surface), l'un sur l'autre, dans une
    /// image de 400 x 480 fois `scale`, relu : rend les deux écrans (largeur, hauteur, RGBA), pour les comparer aux PNG du banc.
    pub fn capture(&self, textures: [Option<&wgpu::Texture>; 2], scale: u32) -> [(usize, usize, Vec<u8>); 2] {
        let s = scale as usize;
        let image = self.read_back(textures, 400 * scale, 480 * scale, Layout::Stacked);
        let crop = |x0: usize, y0: usize, w: usize, h: usize| {
            let mut out = Vec::with_capacity(w * h * 4);
            for y in y0..y0 + h {
                out.extend_from_slice(&image[(y * 400 * s + x0) * 4..(y * 400 * s + x0 + w) * 4]);
            }
            (w, h, out)
        };
        [crop(0, 0, 400 * s, 240 * s), crop(40 * s, 240 * s, 320 * s, 240 * s)]
    }

    /// L'image de la fenêtre telle qu'elle est présentée, en 400 x 240 fois `scale`, relue en RGBA.
    pub fn capture_window(&self, textures: [Option<&wgpu::Texture>; 2], scale: u32, layout: Layout) -> (usize, usize, Vec<u8>) {
        let (width, height) = (400 * scale, 240 * scale);
        (width as usize, height as usize, self.read_back(textures, width, height, layout))
    }

    fn read_back(&self, textures: [Option<&wgpu::Texture>; 2], width: u32, height: u32, layout: Layout) -> Vec<u8> {
        let device = &self.gpu.device;
        let target = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("capture de la fenêtre"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let mut encoder = self.compose(&target.create_view(&Default::default()), width, height, textures, false, layout);
        let row = (width * 4).div_ceil(256) * 256;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some("capture"), size: (row * height) as u64, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        encoder.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(height) } },
            target.size(),
        );
        self.gpu.queue.submit(Some(encoder.finish()));
        buffer.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("relecture de la capture"));
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
        let data = buffer.slice(..).get_mapped_range();
        let bgra = matches!(self.config.format, wgpu::TextureFormat::Bgra8Unorm);
        let mut out = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height as usize {
            for p in data[y * row as usize..y * row as usize + width as usize * 4].chunks_exact(4) {
                out.extend_from_slice(&if bgra { [p[2], p[1], p[0], 255] } else { [p[0], p[1], p[2], 255] });
            }
        }
        out
    }
}

struct App {
    capture: Capture,
    scale: u32,
    smooth: bool,
    frame: usize,
    tops: Vec<wgpu::Texture>,
    bottoms: Vec<wgpu::Texture>,
    status: String,
    window: Option<Arc<Window>>,
    screens: Option<Screens>,
}

impl App {
    /// Rejoue la capture à l'échelle choisie ; l'affichage passe sur le GPU de ce nouveau rendu.
    fn replay(&mut self) {
        let Some(window) = self.window.clone() else { return };
        let start = Instant::now();
        self.screens = None; // la surface de l'ancien GPU est rendue avant d'en créer une sur le nouveau
        self.tops.clear();
        self.bottoms.clear();
        match crate::replay(&self.capture, self.scale).and_then(|r| Ok((Screens::new(window, r.gpu.clone())?, r))) {
            Ok((screens, r)) => {
                let scale = self.scale as usize;
                for image in &r.images {
                    let texture = screens.texture(image);
                    if image.top && image.width == 400 * scale {
                        self.tops.push(texture);
                    } else if !image.top && image.width == 320 * scale {
                        self.bottoms.push(texture);
                    }
                }
                self.frame = self.tops.len().max(self.bottoms.len()).saturating_sub(1);
                self.status = format!("échelle {}  image {}  rejeu {:.0} ms  {}", self.scale, self.frame + 1, 1000.0 * start.elapsed().as_secs_f64(), r.adapter);
                self.screens = Some(screens);
            }
            Err(e) => self.status = format!("erreur : {e}"),
        }
        self.refresh();
    }

    fn refresh(&self) {
        if let Some(window) = &self.window {
            window.set_title(&format!("Pokémon X, portage PC : {}", self.status));
            window.request_redraw();
        }
    }

    fn draw(&mut self) {
        fn pick(v: &[wgpu::Texture], frame: usize) -> Option<&wgpu::Texture> {
            v.get(frame.min(v.len().saturating_sub(1)))
        }
        if let Some(screens) = self.screens.as_mut() {
            screens.draw([pick(&self.tops, self.frame), pick(&self.bottoms, self.frame)], self.smooth, Layout::Stacked);
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            self.window = Some(open(event_loop, "Pokémon X, portage PC", 800.0, 960.0, false));
            self.replay();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(screens) = self.screens.as_mut() {
                    screens.resize(size.width, size.height);
                }
            }
            WindowEvent::RedrawRequested => self.draw(),
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                let frames = self.tops.len().max(self.bottoms.len());
                match event.physical_key {
                    PhysicalKey::Code(KeyCode::Escape) => event_loop.exit(),
                    PhysicalKey::Code(code @ (KeyCode::Digit1 | KeyCode::Digit2 | KeyCode::Digit3 | KeyCode::Digit4)) => {
                        self.scale = match code {
                            KeyCode::Digit1 => 1,
                            KeyCode::Digit2 => 2,
                            KeyCode::Digit3 => 3,
                            _ => 4,
                        };
                        self.replay();
                    }
                    PhysicalKey::Code(KeyCode::ArrowRight) if frames > 0 => {
                        self.frame = (self.frame + 1) % frames;
                        self.status = format!("échelle {}  image {}/{}", self.scale, self.frame + 1, frames);
                        self.refresh();
                    }
                    PhysicalKey::Code(KeyCode::ArrowLeft) if frames > 0 => {
                        self.frame = (self.frame + frames - 1) % frames;
                        self.status = format!("échelle {}  image {}/{}", self.scale, self.frame + 1, frames);
                        self.refresh();
                    }
                    PhysicalKey::Code(KeyCode::KeyL) => {
                        self.smooth = !self.smooth;
                        self.refresh();
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

pub fn run(path: String, scale: u32) -> Result<(), String> {
    let capture = Capture::load(Path::new(&path)).map_err(|e| format!("{path} : {e}"))?;
    let event_loop = EventLoop::new().map_err(|e| e.to_string())?;
    let mut app = App { capture, scale: scale.clamp(1, 4), smooth: false, frame: 0, tops: Vec::new(), bottoms: Vec::new(), status: String::new(), window: None, screens: None };
    event_loop.run_app(&mut app).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{BAG_ITEMS, BAG_ITEM_BUTTONS, BAG_LIST_BOTTOM, BAG_POCKETS, BagPage, LEARN_FORGET, LEARN_INFO, LEARN_QUESTION, Layout, LearnPage, MENU_BUTTONS, MEGA_BUTTON, MOVES_BACK, MOVE_BUTTONS, MoveExtras, SHIFT_BUTTON, PARTY_COMMAND, PARTY_LIST, PartyPage, SUMMARY_PANEL, SUMMARY_BUTTONS, PARTY_MOVES, PARTY_MOVES_BOTTOM, MOVE_INFO_PANEL, MOVE_INFO_BUTTONS, HEAL_PANEL, HEAL_BUTTONS};

    #[test]
    fn native_buttons_touch_the_game_buttons() {
        // chaque pastille, touchée en son milieu, renvoie au milieu du bouton du jeu, dans l'ordre de la colonne
        let list: Vec<[f32; 4]> = BAG_ITEMS.iter().chain(&BAG_LIST_BOTTOM).copied().collect();
        for (layout, buttons) in [
            (Layout::NativeMenu(false), MENU_BUTTONS.to_vec()),
            (Layout::NativeMoves(true, MoveExtras::default()), MOVE_BUTTONS.iter().copied().chain([MOVES_BACK]).collect()),
            (Layout::NativeMoves(false, MoveExtras { mega: true, shift: true }), MOVE_BUTTONS.iter().copied().chain([MEGA_BUTTON, SHIFT_BUTTON, MOVES_BACK]).collect()),
            (Layout::NativeBag(BagPage::Pockets, false), BAG_POCKETS.to_vec()),
            (Layout::NativeBag(BagPage::List, true), list),
            (Layout::NativeBag(BagPage::Item, false), BAG_ITEM_BUTTONS.to_vec()),
            (Layout::NativeLearn(LearnPage::Question, true), LEARN_QUESTION.to_vec()),
            (Layout::NativeLearn(LearnPage::Forget, false), LEARN_FORGET.to_vec()),
            (Layout::NativeLearn(LearnPage::Info, false), LEARN_INFO.to_vec()),
            (Layout::NativeParty(PartyPage::List, true), PARTY_LIST.to_vec()),
            (Layout::NativeParty(PartyPage::Command, false), PARTY_COMMAND.to_vec()),
            (Layout::NativeParty(PartyPage::Summary, false), [SUMMARY_PANEL].iter().chain(&SUMMARY_BUTTONS).copied().collect()),
            (Layout::NativeParty(PartyPage::Moves, true), PARTY_MOVES.iter().chain(&PARTY_MOVES_BOTTOM).copied().collect()),
            (Layout::NativeParty(PartyPage::MoveInfo, false), [MOVE_INFO_PANEL].iter().chain(&MOVE_INFO_BUTTONS).chain(&[MOVES_BACK]).copied().collect()),
            (Layout::NativeParty(PartyPage::Heal, true), [HEAL_PANEL].iter().chain(&HEAL_BUTTONS).copied().collect()),
        ] {
            assert_eq!(layout.native_places().len(), buttons.len());
            let places = layout.native_places();
            for (to, from) in places.iter().zip(&buttons) {
                let (x, y) = ((to[0] + to[2]) / 2.0 * 2.0, (to[1] + to[3]) / 2.0 * 2.0);
                let (bx, by) = layout.bottom_point(800.0, 480.0, x, y).expect("une pastille touche l'écran du bas");
                assert!((from[0] + from[2]) / 2.0 - 1.0 <= bx as f32 && bx as f32 <= (from[0] + from[2]) / 2.0 + 1.0, "{from:?} : {bx}");
                assert!((from[1] + from[3]) / 2.0 - 1.0 <= by as f32 && by as f32 <= (from[1] + from[3]) / 2.0 + 1.0, "{from:?} : {by}");
            }
            // la colonne reste dans l'image, à droite, sans chevauchement
            assert!(places.iter().all(|p| p[0] > 200.0 && p[2] <= 400.0 && p[3] <= 240.0));
            assert!(places.windows(2).all(|w| w[0][3] <= w[1][1] + 0.01 || (w[0][1] == w[1][1] && w[0][2] <= w[1][0] + 0.01)));
        }
        assert_eq!(Layout::NativeMoves(false, MoveExtras::default()).native_places().len(), 5, "quatre capacités et le retour");
        // la dernière ligne touche le retour (panneau 0x7f, 250..320 x 190..240)
        assert_eq!(Layout::NativeMoves(false, MoveExtras::default()).bottom_point(800.0, 480.0, 700.0, 466.0).map(|p| p.0 >= 250 && p.1 >= 190), Some(true));
        assert!(Layout::Moves.native_places().is_empty());
    }

    #[test]
    fn bottom_point_follows_the_overlaid_screen() {
        // à l'échelle 2, le bas occupe les colonnes 80 à 719
        let at = |x, y| Layout::Overlaid.bottom_point(800.0, 480.0, x, y);
        assert_eq!(at(80.0, 0.0), Some((0, 0)));
        assert_eq!(at(400.0, 240.0), Some((160, 120)));
        assert_eq!(at(719.9, 479.9), Some((319, 239)));
        assert_eq!(at(79.9, 240.0), None);
        assert_eq!(at(720.0, 240.0), None);
        // une fenêtre trop large : le repère est centré, bandes de 400 pixels de chaque côté
        assert_eq!(Layout::Overlaid.bottom_point(1600.0, 480.0, 480.0, 0.0), Some((0, 0)));
        assert_eq!(Layout::Overlaid.bottom_point(1600.0, 480.0, 479.0, 0.0), None);
        // une fenêtre trop haute : le pixel au-dessus du repère ne touche rien
        assert_eq!(Layout::Overlaid.bottom_point(800.0, 960.0, 400.0, 239.0), None);
        assert_eq!(Layout::Overlaid.bottom_point(800.0, 960.0, 400.0, 240.0), Some((160, 0)));
        // le coin : à l'échelle 2, de 480 à 799 et de 240 à 479, chaque pixel de la console en vaut un de la fenêtre
        assert_eq!(Layout::Corner.bottom_point(800.0, 480.0, 480.0, 240.0), Some((0, 0)));
        assert_eq!(Layout::Corner.bottom_point(800.0, 480.0, 799.0, 479.0), Some((319, 239)));
        assert_eq!(Layout::Corner.bottom_point(800.0, 480.0, 479.0, 300.0), None);
        // la colonne des capacités, à l'échelle 2 : chaque ligne renvoie au milieu du bon bouton
        let moves = |x, y| Layout::Moves.bottom_point(800.0, 480.0, x, y);
        assert_eq!(moves(696.0, 190.0), Some((80, 69)), "première ligne : en haut à gauche");
        assert_eq!(moves(700.0, 394.0), Some((243, 130)), "dernière ligne : en bas à droite");
        assert_eq!(moves(696.0, 454.0), Some((160, 200)), "le bas de l'écran");
        assert_eq!(moves(500.0, 300.0), None, "à côté");
        let question = |x, y| Layout::YesNo.bottom_point(800.0, 480.0, x, y);
        assert_eq!(question(472.0, 260.0), Some((20, 90)), "premier bouton : en haut à gauche");
        assert_eq!(question(632.0, 340.0), Some((160, 180)), "second bouton");
        assert_eq!(question(300.0, 300.0), None, "à côté");
        // le petit coin : 88 x 66 en bas à droite, l'écran du bas en entier
        let small = |x, y| Layout::SmallCorner.bottom_point(800.0, 480.0, x, y);
        assert_eq!(small(624.0, 348.0), Some((0, 0)), "son coin en haut à gauche");
        assert_eq!(small(620.0, 400.0), None, "à côté");
        // la petite colonne garde les mêmes morceaux de l'écran, et s'arrête au même bord
        let small_moves = |x, y| Layout::SmallMoves.bottom_point(800.0, 480.0, x, y);
        assert_eq!(small_moves(624.0, 480.0 - 44.0 - 4.0 * 2.0 * 34.0 * 88.0 / 104.0 + 1.0), Some((0, 41)), "premier bouton");
        assert_eq!(small_moves(620.0, 400.0), None, "à côté");
        // deux écrans l'un sur l'autre : le bas commence à la moitié
        assert_eq!(Layout::Stacked.bottom_point(800.0, 960.0, 80.0, 480.0), Some((0, 0)));
        assert_eq!(Layout::Stacked.bottom_point(800.0, 960.0, 80.0, 479.0), None);
    }
}
