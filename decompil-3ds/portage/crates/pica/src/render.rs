//! Le rendu : un ordre de dessin du PICA devient un dessin wgpu (Vulkan). Port de `draw` de `raster.py`, où la
//! rastérisation, le test de profondeur, le mélange et l'écriture sont faits par le GPU du PC.
//!
//! Les tampons de couleur et de profondeur du PICA sont des textures wgpu (RGBA8 et Depth32Float), à `scale` fois la
//! taille native. Ils ne sont rendus à la mémoire du jeu que si une commande de gsp (ou un dessin, ou une texture) lit ou
//! recouvre leur plage de mémoire : `sync_read`, `before_write`, `after_write`, `flush` pour tout. Les textures du jeu
//! sont décodées une fois (`formats`) et gardées tant que la mémoire ne change pas sous elles (horodatage par page).
//! Les dessins qui visent les mêmes tampons s'enchaînent dans une seule passe ; leurs constantes, sommets et indices
//! vont dans de grands tampons remplis côté processeur (`Arena`). Les passes de service (réduction, agrandissement,
//! image d'écran, conversion de la profondeur), la relecture groupée et les transferts vers l'écran paresseux sont dans
//! `render/present.rs`.

mod present;

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Instant;

use bytemuck::{Pod, Zeroable};
use formats::{ColorFormat, TextureFormat};
use wgpu::util::DeviceExt;

pub use present::Presented;
use present::{Passes, Pending};

use crate::fragment;
use crate::memory::{translate, Memory};
use crate::shader::{self, ProgramKey};
use crate::state::{f24_to_f32, GpuState};
use crate::vertex;

/// Octets d'une copie des tables d'éclairage : 24 tables de 256 lignes de deux flottants.
const LUT_BYTES: u64 = 24 * 256 * 8;

const COLOR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const DEPTH_STENCIL_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32FloatStencil8;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct DrawUniform {
    c: [[f32; 4]; 96],
    ints: [[u32; 4]; 4],
    misc: [u32; 4],
    xf0: [f32; 4],
    xf1: [f32; 4],
    tev_const: [[f32; 4]; 6],
    buffer_color: [f32; 4],
    fog_color: [f32; 4],
    tex_dim: [[f32; 4]; 3],
    tex_wrap: [[u32; 4]; 3],
    tex_border: [[f32; 4]; 3],
    alpha_test: [u32; 4],
    fog: [[f32; 4]; 64],
    light: [[u32; 4]; 48],
    misc2: [u32; 4],
    blend_pre: [f32; 4],
}

#[derive(Default, Clone, Debug)]
pub struct Stats {
    pub draws: u64,
    pub triangles: u64,
    pub pipelines: u64,
    pub vertex_programs: u64,
    pub fragment_programs: u64,
    pub textures_decoded: u64,
    pub flushes: u64,
    pub clears: u64,
    /// Textures prises directement dans un tampon de rendu vivant (sans passer par la mémoire).
    pub live_textures: u64,
    pub depth_conversions: u64,
    pub lut_uploads: u64,
    pub mesh_hits: u64,
    pub bind_groups: u64,
    /// Transferts vers l'écran dont l'écriture en mémoire a été remise à plus tard, puis faite, puis jamais nécessaire.
    pub deferred: u64,
    pub materialized: u64,
    pub dropped: u64,
    /// Temps passé (secondes) par étape : mesure du profil, voir `portage bench`.
    pub time: BTreeMap<&'static str, f64>,
}

struct ColorSurface {
    id: u64,
    address: u32,
    width: usize,
    height: usize,
    fmt: ColorFormat,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    dirty: bool,
    valid: bool,
    used: u64,
}

impl ColorSurface {
    /// Les octets que le tampon occupe en mémoire (tuiles de 8 x 8).
    fn bytes(&self) -> usize {
        self.width.div_ceil(8) * self.height.div_ceil(8) * 64 * self.fmt.bytes_per_pixel()
    }
}

fn depth_unit(fmt: u32) -> usize {
    [2usize, 0, 3, 4][fmt as usize]
}

fn overlaps(a: u32, a_len: usize, b: u32, b_len: usize) -> bool {
    (a as u64) < b as u64 + b_len as u64 && (b as u64) < a as u64 + a_len as u64
}

/// Le tampon de profondeur converti en octets de mémoire (RGBA8 natif), pour être lu comme texture ou rendu à la mémoire.
struct Converted {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    id: u64,
    /// La version du tampon de profondeur que la conversion représente.
    built: u64,
}

struct DepthSurface {
    id: u64,
    /// Monte à chaque écriture du tampon sur le GPU.
    version: u64,
    converted: Option<Converted>,
    address: u32,
    width: usize,
    height: usize,
    fmt: u32,
    format: wgpu::TextureFormat,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    stencil: Vec<u8>,
    dirty: bool,
    valid: bool,
    used: u64,
}

impl DepthSurface {
    fn bytes(&self) -> usize {
        self.width.div_ceil(8) * self.height.div_ceil(8) * 64 * depth_unit(self.fmt)
    }
}

/// Un grand tampon dont chaque dessin prend un morceau (écrit par `queue.write_buffer`) ; remis à zéro à chaque envoi
/// au GPU, ce qui est sûr : les écritures de la file passent après les commandes déjà envoyées.
struct Arena {
    buffer: wgpu::Buffer,
    size: u64,
    offset: u64,
    /// Ce qui est écrit dans le tampon, rangé d'abord ici puis envoyé d'un seul coup à l'envoi du travail au GPU.
    cpu: Vec<u8>,
}

impl Arena {
    fn new(device: &wgpu::Device, label: &str, size: u64, usage: wgpu::BufferUsages) -> Arena {
        let buffer = device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size, usage: usage | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        Arena { buffer, size, offset: 0, cpu: Vec::new() }
    }

    fn alloc(&mut self, bytes: u64, align: u64) -> Option<u64> {
        let at = self.offset.div_ceil(align) * align;
        (at + bytes <= self.size).then(|| {
            self.offset = at + bytes;
            if self.cpu.len() < self.offset as usize {
                self.cpu.resize(self.offset as usize, 0);
            }
            at
        })
    }

    fn write(&mut self, at: u64, bytes: &[u8]) {
        self.cpu[at as usize..at as usize + bytes.len()].copy_from_slice(bytes);
    }

    /// Envoie à la file ce qui a été écrit, puis repart de zéro.
    fn upload(&mut self, queue: &wgpu::Queue) {
        if self.offset > 0 {
            queue.write_buffer(&self.buffer, 0, &self.cpu[..self.offset as usize]);
        }
        self.offset = 0;
    }
}

struct MeshEntry {
    /// Horloge de la mémoire quand les sommets ont été décodés.
    checked: u64,
    /// Les plages de mémoire lues (indices et attributs).
    ranges: Vec<(u32, usize)>,
    data: Arc<vertex::VertexData>,
    bytes: usize,
}

struct TextureEntry {
    id: u64,
    crc: u32,
    /// Horloge de la mémoire quand le contenu a été vérifié pour la dernière fois.
    checked: u64,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct PipelineKey {
    vs: u64,
    fs: u64,
    blend: Option<[u8; 6]>,
    write_mask: u8,
    depth: Option<DepthKey>,
    cull: u8,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct DepthKey {
    compare: u8,
    write: bool,
    stencil_format: bool,
    /// (fonction, échec, échec de profondeur, réussite, masque de lecture, masque d'écriture) si le pochoir est allumé
    stencil: Option<[u8; 6]>,
}

/// Le GPU du rendu, pour afficher sans second appareil : une fenêtre crée sa surface depuis `instance` et dessine avec
/// `device` les textures que rend pica.
#[derive(Clone)]
pub struct Gpu {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

pub struct Renderer {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub adapter_name: String,
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    scale: u32,
    /// Vrai (par défaut) : un tampon de rendu vivant qui est lu comme texture sert directement, sans passer par la mémoire.
    pub live_textures: bool,
    layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    vs_by_version: HashMap<(u64, u32, u32, [u32; 7]), Option<u64>>,
    vs_by_key: HashMap<ProgramKey, Option<u64>>,
    vs_modules: HashMap<u64, wgpu::ShaderModule>,
    fs_ids: HashMap<String, u64>,
    fs_by_key: HashMap<[u32; 30], u64>,
    fs_modules: HashMap<u64, wgpu::ShaderModule>,
    pipelines: HashMap<PipelineKey, wgpu::RenderPipeline>,
    textures: HashMap<(u32, usize, usize, u32), TextureEntry>,
    color_surfaces: Vec<ColorSurface>,
    depth_surfaces: Vec<DepthSurface>,
    encoder: Option<wgpu::CommandEncoder>,
    dummy_view: wgpu::TextureView,
    depth_upload: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
    stencil_supported: bool,
    /// Les tables d'éclairage (49152 octets chacune) : une copie par version utilisée dans l'envoi en cours.
    lut_arena: Arena,
    lut_align: u64,
    lut_at: Option<(u64, u64)>,
    /// Les contenus déjà copiés dans l'envoi en cours : (CRC32 des tables, décalage).
    lut_copies: Vec<(u32, u64)>,
    /// La passe de dessin ouverte : les dessins qui visent les mêmes tampons s'y enchaînent (clé : couleur, profondeur, pochoir).
    pass: Option<((u64, u64, bool), wgpu::RenderPass<'static>)>,
    meshes: HashMap<Vec<u32>, MeshEntry>,
    mesh_bytes: usize,
    trace: bool,
    trace_textures: bool,
    passes: Option<Passes>,
    pending: Vec<Pending>,
    readback_pool: HashMap<u64, Vec<wgpu::Buffer>>,
    uniform_arena: Arena,
    input_arena: Arena,
    index_arena: Arena,
    uniform_align: u64,
    arena_generation: u64,
    next_id: u64,
    bind_groups: HashMap<[u64; 6], wgpu::BindGroup>,
    clock: u64,
    attributed: f64,
    pub stats: Stats,
    pub notes: BTreeMap<String, u64>,
}

fn align(n: usize, to: usize) -> usize {
    n.div_ceil(to) * to
}

fn blend_factor(code: u32) -> wgpu::BlendFactor {
    use wgpu::BlendFactor as F;
    match code {
        0 => F::Zero,
        1 => F::One,
        2 => F::Src,
        3 => F::OneMinusSrc,
        4 => F::Dst,
        5 => F::OneMinusDst,
        6 => F::SrcAlpha,
        7 => F::OneMinusSrcAlpha,
        8 => F::DstAlpha,
        9 => F::OneMinusDstAlpha,
        10 | 12 => F::Constant,
        11 | 13 => F::OneMinusConstant,
        14 => F::SrcAlphaSaturated,
        _ => F::One,
    }
}

fn blend_operation(code: u32) -> wgpu::BlendOperation {
    use wgpu::BlendOperation as O;
    match code {
        0 => O::Add,
        1 => O::Subtract,
        2 => O::ReverseSubtract,
        3 => O::Min,
        _ => O::Max,
    }
}

fn compare_function(code: u32) -> wgpu::CompareFunction {
    use wgpu::CompareFunction as C;
    match code {
        0 => C::Never,
        1 => C::Always,
        2 => C::Equal,
        3 => C::NotEqual,
        4 => C::Less,
        5 => C::LessEqual,
        6 => C::Greater,
        _ => C::GreaterEqual,
    }
}

fn byte_color(word: u32) -> [f32; 4] {
    [(word & 255) as f32 / 255.0, (word >> 8 & 255) as f32 / 255.0, (word >> 16 & 255) as f32 / 255.0, (word >> 24 & 255) as f32 / 255.0]
}

impl Renderer {
    /// Ouvre un GPU Vulkan (le plus puissant, ou celui dont le nom contient `$PORTAGE_GPU`).
    pub fn new(scale: u32) -> Result<Renderer, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let wanted = std::env::var("PORTAGE_GPU").ok().map(|s| s.to_lowercase());
        let adapters = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::VULKAN));
        let mut chosen: Option<wgpu::Adapter> = None;
        for adapter in adapters {
            let info = adapter.get_info();
            let name = info.name.to_lowercase();
            let better = match (&wanted, &chosen) {
                (Some(w), _) => name.contains(w.as_str()),
                (None, None) => true,
                (None, Some(c)) => {
                    let rank = |t: wgpu::DeviceType| match t {
                        wgpu::DeviceType::DiscreteGpu => 3,
                        wgpu::DeviceType::IntegratedGpu => 2,
                        wgpu::DeviceType::VirtualGpu => 1,
                        _ => 0,
                    };
                    rank(info.device_type) > rank(c.get_info().device_type)
                }
            };
            if better {
                chosen = Some(adapter);
            }
        }
        let adapter = chosen.ok_or("aucun GPU Vulkan trouvé")?;
        let adapter_name = adapter.get_info().name;
        let stencil_supported = adapter.features().contains(wgpu::Features::DEPTH32FLOAT_STENCIL8);
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("pica"),
            required_features: if stencil_supported { wgpu::Features::DEPTH32FLOAT_STENCIL8 } else { wgpu::Features::empty() },
            required_limits: wgpu::Limits::default().using_resolution(adapter.limits()),
            ..Default::default()
        }))
        .map_err(|e| format!("device wgpu : {e}"))?;
        let entry = |binding: u32, visibility: wgpu::ShaderStages, ty: wgpu::BindingType| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty,
            count: None,
        };
        let texture_ty = wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        };
        let both = wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT;
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("pica"),
            entries: &[
                entry(0, both, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: true, min_binding_size: std::num::NonZeroU64::new(std::mem::size_of::<DrawUniform>() as u64) }),
                entry(1, wgpu::ShaderStages::VERTEX, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None }),
                entry(2, wgpu::ShaderStages::FRAGMENT, texture_ty),
                entry(3, wgpu::ShaderStages::FRAGMENT, texture_ty),
                entry(4, wgpu::ShaderStages::FRAGMENT, texture_ty),
                entry(5, wgpu::ShaderStages::FRAGMENT, texture_ty),
                entry(6, wgpu::ShaderStages::FRAGMENT, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: true, min_binding_size: std::num::NonZeroU64::new(LUT_BYTES) }),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pica"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let dummy = device.create_texture_with_data(
            &queue,
            &wgpu::TextureDescriptor {
                label: Some("vide"),
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: COLOR_FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            &[255, 0, 255, 255],
        );
        let dummy_view = dummy.create_view(&wgpu::TextureViewDescriptor::default());
        let uniform_arena = Arena::new(&device, "constantes", 8 << 20, wgpu::BufferUsages::UNIFORM);
        let input_arena = Arena::new(&device, "sommets", 16 << 20, wgpu::BufferUsages::STORAGE);
        let index_arena = Arena::new(&device, "indices", 4 << 20, wgpu::BufferUsages::INDEX);
        let uniform_align = device.limits().min_uniform_buffer_offset_alignment as u64;
        let lut_align = device.limits().min_storage_buffer_offset_alignment as u64;
        let device_lut = device.clone();
        Ok(Renderer {
            device,
            queue,
            adapter_name,
            instance,
            adapter,
            scale: scale.max(1),
            live_textures: true,
            layout,
            pipeline_layout,
            vs_by_version: HashMap::new(),
            vs_by_key: HashMap::new(),
            vs_modules: HashMap::new(),
            fs_ids: HashMap::new(),
            fs_by_key: HashMap::new(),
            fs_modules: HashMap::new(),
            pipelines: HashMap::new(),
            textures: HashMap::new(),
            color_surfaces: Vec::new(),
            depth_surfaces: Vec::new(),
            encoder: None,
            dummy_view,
            depth_upload: HashMap::new(),
            stencil_supported,
            lut_arena: Arena::new(&device_lut, "tables d'éclairage", LUT_BYTES * 64, wgpu::BufferUsages::STORAGE),
            lut_align: lut_align,
            lut_at: None,
            lut_copies: Vec::new(),
            pass: None,
            meshes: HashMap::new(),
            mesh_bytes: 0,
            trace: std::env::var_os("PORTAGE_TRACE").is_some(),
            trace_textures: std::env::var_os("PORTAGE_TRACE_TEX").is_some(),
            passes: None,
            pending: Vec::new(),
            readback_pool: HashMap::new(),
            uniform_arena,
            input_arena,
            index_arena,
            uniform_align,
            arena_generation: 1,
            next_id: 1,
            bind_groups: HashMap::new(),
            clock: 0,
            attributed: 0.0,
            stats: Stats::default(),
            notes: BTreeMap::new(),
        })
    }

    pub fn scale(&self) -> u32 {
        self.scale
    }

    pub fn gpu(&self) -> Gpu {
        Gpu { instance: self.instance.clone(), adapter: self.adapter.clone(), device: self.device.clone(), queue: self.queue.clone() }
    }

    fn now(&self) -> (Instant, f64) {
        (Instant::now(), self.attributed)
    }

    /// Ajoute au compteur de l'étape le temps écoulé depuis `since`, moins celui déjà compté par les étapes imbriquées.
    fn tick(&mut self, name: &'static str, since: (Instant, f64)) {
        let exclusive = since.0.elapsed().as_secs_f64() - (self.attributed - since.1);
        self.attributed += exclusive;
        *self.stats.time.entry(name).or_insert(0.0) += exclusive;
    }

    fn note(&mut self, text: impl Into<String>) {
        *self.notes.entry(text.into()).or_insert(0) += 1;
    }

    // --- le GPU : envoi et relecture ---

    /// L'encodeur pour une commande hors passe : la passe de dessin ouverte est d'abord fermée.
    fn encoder(&mut self) -> &mut wgpu::CommandEncoder {
        self.pass = None;
        self.open_encoder()
    }

    fn open_encoder(&mut self) -> &mut wgpu::CommandEncoder {
        if self.encoder.is_none() {
            self.encoder = Some(self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("pica") }));
        }
        self.encoder.as_mut().unwrap()
    }

    /// Envoie au GPU ce qui a été encodé.
    pub fn submit(&mut self) {
        self.pass = None;
        // ce que les dessins ont écrit dans les grands tampons part avant leurs commandes ; les tampons repartent de zéro
        self.uniform_arena.upload(&self.queue);
        self.input_arena.upload(&self.queue);
        self.index_arena.upload(&self.queue);
        self.lut_arena.upload(&self.queue);
        self.lut_at = None;
        self.lut_copies.clear();
        if let Some(e) = self.encoder.take() {
            let t = self.now();
            self.queue.submit(Some(e.finish()));
            self.tick("envoi", t);
        }
    }

    fn read_texture(&mut self, texture: &wgpu::Texture, width: usize, height: usize, bytes_per_texel: usize, aspect: wgpu::TextureAspect) -> Vec<u8> {
        let job = present::ReadJob { texture: texture.clone(), width, height, bytes_per_texel, aspect };
        self.read_batch(vec![job]).pop().unwrap_or_default()
    }

    // --- les tampons de rendu ---

    fn color_config(state: &GpuState) -> Option<(u32, usize, usize, ColorFormat)> {
        let regs = &state.regs;
        let address = translate((regs[0x11D] & 0x1FFF_FFFF) << 3)?;
        let dim = regs[0x11E];
        let (width, height) = ((dim & 0xFFF) as usize, ((dim >> 12) & 0xFFF) as usize + 1);
        let fmt = ColorFormat::from_color_buffer((regs[0x117] >> 16) & 7).unwrap_or(ColorFormat::Rgba8);
        (width > 0 && height > 0).then_some((address, width, height, fmt))
    }

    fn depth_config(state: &GpuState) -> Option<(u32, usize, usize, u32)> {
        let regs = &state.regs;
        let raw = regs[0x11C] & 0x1FFF_FFFF;
        if raw == 0 {
            return None;
        }
        let address = translate(raw << 3)?;
        let dim = regs[0x11E];
        let (width, height) = ((dim & 0xFFF) as usize, ((dim >> 12) & 0xFFF) as usize + 1);
        let fmt = regs[0x116] & 3;
        (width > 0 && height > 0 && matches!(fmt, 0 | 2 | 3)).then_some((address, width, height, fmt))
    }

    fn color_surface(&mut self, state: &GpuState, memory: &mut Memory) -> Option<usize> {
        let (address, width, height, fmt) = Self::color_config(state)?;
        self.clock += 1;
        if let Some(i) = self.color_surfaces.iter().position(|s| (s.address, s.width, s.height, s.fmt) == (address, width, height, fmt)) {
            self.color_surfaces[i].used = self.clock;
            return Some(i);
        }
        while self.color_surfaces.len() >= 4 {
            let oldest = (0..self.color_surfaces.len()).min_by_key(|&i| self.color_surfaces[i].used).unwrap();
            self.flush_color(oldest, memory);
            self.color_surfaces.remove(oldest);
        }
        let unit = fmt.bytes_per_pixel();
        let size = width.div_ceil(8) * height.div_ceil(8) * 64 * unit;
        self.retire_color_overlaps(memory, address, size);
        let (pixels, valid) = match memory.read(address, size) {
            Some(raw) => (formats::decode_pixels(fmt, &formats::tiled_to_linear(&raw, width, height, unit)), true),
            None => (vec![0u8; width * height * 4], false),
        };
        let texture = self.upload_scaled(&pixels, width, height);
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let id = self.next_id;
        self.next_id += 1;
        self.color_surfaces.push(ColorSurface { id, address, width, height, fmt, texture, view, dirty: false, valid, used: self.clock });
        Some(self.color_surfaces.len() - 1)
    }

    fn depth_surface(&mut self, state: &GpuState, memory: &mut Memory) -> Option<usize> {
        let (address, width, height, fmt) = Self::depth_config(state)?;
        self.clock += 1;
        if let Some(i) = self.depth_surfaces.iter().position(|s| (s.address, s.width, s.height, s.fmt) == (address, width, height, fmt)) {
            self.depth_surfaces[i].used = self.clock;
            return Some(i);
        }
        while self.depth_surfaces.len() >= 4 {
            let oldest = (0..self.depth_surfaces.len()).min_by_key(|&i| self.depth_surfaces[i].used).unwrap();
            self.flush_depth(oldest, memory);
            self.depth_surfaces.remove(oldest);
        }
        let unit = depth_unit(fmt);
        let size = width.div_ceil(8) * height.div_ceil(8) * 64 * unit;
        self.retire_depth_overlaps(memory, address, size);
        let mut depth = vec![0f32; width * height];
        let mut stencil = vec![0u8; width * height];
        let mut valid = false;
        if let Some(raw) = memory.read(address, size) {
            valid = true;
            let linear = formats::tiled_to_linear(&raw, width, height, unit);
            for i in 0..width * height {
                let mut v = 0u32;
                for k in 0..unit {
                    v |= (linear[i * unit + k] as u32) << (8 * k);
                }
                depth[i] = match fmt {
                    0 => v as f32 / 65535.0,
                    _ => (v & 0xFF_FFFF) as f32 / 16_777_215.0,
                };
                if fmt == 3 {
                    stencil[i] = (v >> 24) as u8;
                }
            }
        }
        let s = self.scale;
        let format = if fmt == 3 && self.stencil_supported { DEPTH_STENCIL_FORMAT } else { DEPTH_FORMAT };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("tampon de profondeur"),
            size: wgpu::Extent3d { width: width as u32 * s, height: height as u32 * s, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        // le pochoir : la valeur la plus courante du tampon (un effacement, le cas courant, n'en a qu'une)
        let mut counts = [0usize; 256];
        for &v in &stencil {
            counts[v as usize] += 1;
        }
        let clear_stencil = (0..256).max_by_key(|&v| counts[v]).unwrap_or(0) as u32;
        if counts[clear_stencil as usize] != stencil.len() && fmt == 3 {
            self.note("pochoir initial non uniforme : approché par sa valeur la plus courante");
        }
        self.upload_depth(&view, format, clear_stencil, &depth, width, height);
        let id = self.next_id;
        self.next_id += 1;
        self.depth_surfaces.push(DepthSurface { id, version: 1, converted: None, address, width, height, fmt, format, texture, view, stencil, dirty: false, valid, used: self.clock });
        Some(self.depth_surfaces.len() - 1)
    }

    /// Le contenu initial du tampon de profondeur : une valeur unique (cas courant, après un remplissage) s'écrit par un
    /// effacement ; sinon un dessin plein écran écrit la profondeur depuis une texture R32Float.
    fn upload_depth(&mut self, view: &wgpu::TextureView, format: wgpu::TextureFormat, clear_stencil: u32, depth: &[f32], width: usize, height: usize) {
        let first = depth.first().copied().unwrap_or(0.0);
        let stencil_ops = (format == DEPTH_STENCIL_FORMAT).then_some(wgpu::Operations { load: wgpu::LoadOp::Clear(clear_stencil), store: wgpu::StoreOp::Store });
        if depth.iter().all(|&d| d == first) {
            let encoder = self.encoder();
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("profondeur"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(first), store: wgpu::StoreOp::Store }),
                    stencil_ops,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            return;
        }
        let s = self.scale as usize;
        let mut big = vec![0f32; width * s * height * s];
        for y in 0..height * s {
            for x in 0..width * s {
                big[y * width * s + x] = depth[(y / s) * width + x / s];
            }
        }
        let source = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some("profondeur source"),
                size: wgpu::Extent3d { width: (width * s) as u32, height: (height * s) as u32, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R32Float,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            bytemuck::cast_slice(&big),
        );
        if !self.depth_upload.contains_key(&format) {
            let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("profondeur"),
                source: wgpu::ShaderSource::Wgsl(
                    r#"
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}
struct Out { @builtin(frag_depth) d: f32 }
@fragment fn fs(@builtin(position) pos: vec4<f32>) -> Out {
    var o: Out;
    o.d = textureLoad(src, vec2<i32>(pos.xy), 0).x;
    return o;
}
"#
                    .into(),
                ),
            });
            let bgl = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("profondeur"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                }],
            });
            let layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("profondeur"),
                bind_group_layouts: &[Some(&bgl)],
                immediate_size: 0,
            });
            let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("profondeur"),
                layout: Some(&layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format,
                    depth_write_enabled: Some(true),
                    depth_compare: Some(wgpu::CompareFunction::Always),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), compilation_options: Default::default(), targets: &[] }),
                multiview_mask: None,
                cache: None,
            });
            self.depth_upload.insert(format, pipeline);
        }
        let pipeline = self.depth_upload[&format].clone();
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("profondeur"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&source_view) }],
        });
        let encoder = self.encoder();
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("profondeur"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(0.0), store: wgpu::StoreOp::Store }),
                stencil_ops,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    fn flush_color(&mut self, index: usize, memory: &mut Memory) {
        self.flush_colors(&[index], memory);
    }

    fn flush_depth(&mut self, index: usize, memory: &mut Memory) {
        self.flush_depths(&[index], memory);
    }

    /// Un nouveau tampon va lire la mémoire à cette plage : les autres tampons qui la recouvrent sont rendus puis oubliés
    /// (deux copies vivantes d'une même mémoire divergeraient).
    fn retire_color_overlaps(&mut self, memory: &mut Memory, address: u32, size: usize) {
        self.materialize_overlapping(memory, address, size);
        let mut i = 0;
        while i < self.color_surfaces.len() {
            let s = &self.color_surfaces[i];
            if overlaps(s.address, s.bytes(), address, size) {
                self.flush_color(i, memory);
                self.color_surfaces.remove(i);
                self.note("tampon de couleur chevauchant un autre : oublié");
            } else {
                i += 1;
            }
        }
        for i in 0..self.depth_surfaces.len() {
            let s = &self.depth_surfaces[i];
            if s.dirty && overlaps(s.address, s.bytes(), address, size) {
                self.flush_depth(i, memory);
            }
        }
    }

    fn retire_depth_overlaps(&mut self, memory: &mut Memory, address: u32, size: usize) {
        self.materialize_overlapping(memory, address, size);
        let mut i = 0;
        while i < self.depth_surfaces.len() {
            let s = &self.depth_surfaces[i];
            if overlaps(s.address, s.bytes(), address, size) {
                self.flush_depth(i, memory);
                self.depth_surfaces.remove(i);
                self.note("tampon de profondeur chevauchant un autre : oublié");
            } else {
                i += 1;
            }
        }
        for i in 0..self.color_surfaces.len() {
            let s = &self.color_surfaces[i];
            if s.dirty && overlaps(s.address, s.bytes(), address, size) {
                self.flush_color(i, memory);
            }
        }
    }

    /// Une commande va lire la mémoire à cette plage : rend à la mémoire les tampons sales qui la recouvrent.
    pub fn sync_read(&mut self, memory: &mut Memory, start: u32, len: usize) {
        self.sync_overlaps(memory, start, len, false);
    }

    fn sync_overlaps(&mut self, memory: &mut Memory, start: u32, len: usize, discard_covered: bool) {
        if discard_covered {
            self.settle_pending_for_write(memory, start, len);
        } else {
            self.materialize_overlapping(memory, start, len);
        }
        let mut colors = Vec::new();
        for i in 0..self.color_surfaces.len() {
            let s = &self.color_surfaces[i];
            if s.dirty && overlaps(s.address, s.bytes(), start, len) {
                if discard_covered && start <= s.address && s.address as u64 + s.bytes() as u64 <= start as u64 + len as u64 {
                    self.color_surfaces[i].dirty = false; // entièrement réécrit : l'ancien contenu ne sert plus
                } else {
                    colors.push(i);
                }
            }
        }
        let mut depths = Vec::new();
        for i in 0..self.depth_surfaces.len() {
            let s = &self.depth_surfaces[i];
            if s.dirty && overlaps(s.address, s.bytes(), start, len) {
                if discard_covered && start <= s.address && s.address as u64 + s.bytes() as u64 <= start as u64 + len as u64 {
                    self.depth_surfaces[i].dirty = false;
                } else {
                    depths.push(i);
                }
            }
        }
        self.flush_colors(&colors, memory);
        self.flush_depths(&depths, memory);
    }

    /// Une commande va écraser la mémoire à cette plage : rend ce qui n'est pas entièrement écrasé.
    pub fn before_write(&mut self, memory: &mut Memory, start: u32, len: usize) {
        self.sync_overlaps(memory, start, len, true);
    }

    /// La mémoire vient d'être écrasée à cette plage : un tampon qu'elle remplit entièrement d'une seule valeur est
    /// effacé sur le GPU (sans relire la mémoire), les autres tampons touchés sont oubliés (rechargés au prochain dessin).
    pub fn after_write(&mut self, memory: &mut Memory, start: u32, len: usize) {
        let mut i = 0;
        while i < self.color_surfaces.len() {
            let s = &self.color_surfaces[i];
            if !overlaps(s.address, s.bytes(), start, len) {
                i += 1;
                continue;
            }
            if self.try_clear_color(i, memory, start, len) {
                i += 1;
            } else {
                self.color_surfaces.remove(i);
            }
        }
        let mut i = 0;
        while i < self.depth_surfaces.len() {
            let s = &self.depth_surfaces[i];
            if !overlaps(s.address, s.bytes(), start, len) {
                i += 1;
                continue;
            }
            if self.try_clear_depth(i, memory, start, len) {
                i += 1;
            } else {
                self.depth_surfaces.remove(i);
            }
        }
    }

    /// Le point répété qui remplit tout le tampon (de `bytes` octets à `address`), si la plage écrite le recouvre
    /// entièrement et qu'il n'a qu'une valeur.
    fn uniform_unit(memory: &Memory, address: u32, bytes: usize, unit: usize, start: u32, len: usize) -> Option<Vec<u8>> {
        if !(start <= address && address as u64 + bytes as u64 <= start as u64 + len as u64) {
            return None;
        }
        let raw = memory.read(address, bytes)?;
        // un point répété : le tampon est égal à lui-même décalé d'un point (comparaison d'octets rapide)
        (raw.len() >= unit && raw[unit..] == raw[..raw.len() - unit]).then(|| raw[..unit].to_vec())
    }

    fn try_clear_color(&mut self, index: usize, memory: &mut Memory, start: u32, len: usize) -> bool {
        let (address, bytes, fmt, valid) = {
            let s = &self.color_surfaces[index];
            (s.address, s.bytes(), s.fmt, s.valid)
        };
        if !valid {
            return false;
        }
        let Some(unit) = Self::uniform_unit(memory, address, bytes, fmt.bytes_per_pixel(), start, len) else { return false };
        let px = formats::decode_pixels(fmt, &unit);
        let color = wgpu::Color { r: px[0] as f64 / 255.0, g: px[1] as f64 / 255.0, b: px[2] as f64 / 255.0, a: px[3] as f64 / 255.0 };
        let view = self.color_surfaces[index].view.clone();
        let encoder = self.encoder();
        let pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("effacement"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(color), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        drop(pass);
        self.color_surfaces[index].dirty = false;
        self.stats.clears += 1;
        true
    }

    fn try_clear_depth(&mut self, index: usize, memory: &mut Memory, start: u32, len: usize) -> bool {
        let (address, bytes, fmt, valid, format) = {
            let s = &self.depth_surfaces[index];
            (s.address, s.bytes(), s.fmt, s.valid, s.format)
        };
        if !valid {
            return false;
        }
        let unit = depth_unit(fmt);
        let Some(first) = Self::uniform_unit(memory, address, bytes, unit, start, len) else { return false };
        let mut v = 0u32;
        for (k, &b) in first.iter().enumerate() {
            v |= (b as u32) << (8 * k);
        }
        let depth = match fmt {
            0 => v as f32 / 65535.0,
            _ => (v & 0xFF_FFFF) as f32 / 16_777_215.0,
        };
        let stencil = if fmt == 3 { (v >> 24) as u8 } else { 0 };
        let view = self.depth_surfaces[index].view.clone();
        let stencil_ops = (format == DEPTH_STENCIL_FORMAT).then_some(wgpu::Operations { load: wgpu::LoadOp::Clear(stencil as u32), store: wgpu::StoreOp::Store });
        let encoder = self.encoder();
        let pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("effacement de profondeur"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &view,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(depth), store: wgpu::StoreOp::Store }),
                stencil_ops,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        drop(pass);
        let surface = &mut self.depth_surfaces[index];
        surface.stencil.iter_mut().for_each(|b| *b = stencil);
        surface.dirty = false;
        surface.version += 1;
        self.stats.clears += 1;
        true
    }

    /// Rend à la mémoire ce qui a été dessiné (avant qu'une commande de gsp ne lise ou n'écrive la mémoire).
    pub fn flush(&mut self, memory: &mut Memory) {
        self.submit();
        let colors: Vec<usize> = (0..self.color_surfaces.len()).collect();
        let depths: Vec<usize> = (0..self.depth_surfaces.len()).collect();
        self.flush_colors(&colors, memory);
        self.flush_depths(&depths, memory);
        self.materialize_all(memory);
    }

    /// Oublie les recopies (la mémoire a changé sous elles) après les avoir rendues.
    pub fn invalidate(&mut self, memory: &mut Memory) {
        self.flush(memory);
        self.color_surfaces.clear();
        self.depth_surfaces.clear();
    }

    /// L'image RGBA (à `scale` fois la taille) d'un tampon de couleur vivant, à partir de l'adresse `source` qui peut
    /// tomber au début d'une ligne de tuiles à l'intérieur du tampon (le jeu dessine dans le bas d'un grand tampon).
    /// Rend (pixels, lignes natives disponibles) : pour les sorties haute définition.
    pub fn color_image(&mut self, source: u32, width: usize) -> Option<(Vec<u8>, usize)> {
        let i = self.color_surfaces.iter().position(|s| {
            let row_bytes = s.width.div_ceil(8) * 64 * s.fmt.bytes_per_pixel();
            let end = s.address as usize + s.height.div_ceil(8) * row_bytes;
            s.width == width && source >= s.address && (source as usize) < end && (source - s.address) as usize % row_bytes == 0
        })?;
        let (texture, address, w, h, unit) = {
            let s = &self.color_surfaces[i];
            (s.texture.clone(), s.address, s.width, s.height, s.fmt.bytes_per_pixel())
        };
        let skip = ((source - address) as usize / (w.div_ceil(8) * 64 * unit)) * 8;
        if skip >= h {
            return None;
        }
        let s = self.scale as usize;
        let all = self.read_texture(&texture, w * s, h * s, 4, wgpu::TextureAspect::All);
        Some((all[skip * s * w * s * 4..].to_vec(), h - skip))
    }

    // --- les textures ---

    fn get_texture(&mut self, state: &GpuState, memory: &mut Memory, unit: usize, target: usize) -> Option<(wgpu::TextureView, u64, [f32; 4], [u32; 4], [f32; 4])> {
        let regs = &state.regs;
        let (border_reg, address_reg, format_reg) = [(0x81usize, 0x85usize, 0x8Eusize), (0x91, 0x95, 0x96), (0x99, 0x9D, 0x9E)][unit];
        let (dim, config) = (regs[border_reg + 1], regs[border_reg + 2]);
        let (width, height) = (((dim >> 16) & 0x7FF) as usize, (dim & 0x7FF) as usize);
        let fmt = TextureFormat::from_id(regs[format_reg] & 15);
        let address = translate((regs[address_reg] & 0x1FFF_FFFF) << 3);
        let (Some(fmt), Some(address)) = (fmt, address) else { return None };
        if width == 0 || height == 0 {
            return None;
        }
        let size = formats::texture_size(fmt, width, height);
        let linear = if (config >> 1) & 1 != 0 { 1.0 } else { 0.0 };
        // Un tampon de rendu vivant qui est exactement cette texture (même adresse, mêmes dimensions, RGBA8) sert de texture
        // sans passer par la mémoire : la couleur à la définition de l'échelle (le jeu le relit sans perte), la profondeur
        // convertie sur le GPU en octets de mémoire.
        if fmt == TextureFormat::Rgba8 && self.live_textures {
            let wrap = [(config >> 12) & 7, (config >> 8) & 7, 0, 0];
            let border = byte_color(regs[border_reg]);
            let found = self.color_surfaces.iter().position(|c| c.valid && c.fmt == ColorFormat::Rgba8 && (c.address, c.width, c.height) == (address, width, height));
            if let Some(i) = found.filter(|&i| i != target) {
                let k = self.scale as f32;
                let c = &self.color_surfaces[i];
                self.stats.live_textures += 1;
                return Some((c.view.clone(), c.id, [width as f32 * k, height as f32 * k, linear, 2.0], wrap, border));
            }
            let found = self
                .depth_surfaces
                .iter()
                .position(|d| d.valid && d.dirty && d.fmt == 3 && d.format == DEPTH_STENCIL_FORMAT && (d.address, d.width, d.height) == (address, width, height));
            if let Some(i) = found {
                let (view, id) = self.convert_depth(i);
                self.stats.live_textures += 1;
                return Some((view, id, [width as f32, height as f32, linear, 2.0], wrap, border));
            }
        }
        // Le résultat d'un transfert vers l'écran en attente qui est exactement cette texture (le jeu rend dans une
        // texture par un transfert de copie) : pris sur le GPU, à la définition de l'échelle.
        if self.live_textures {
            let color = match fmt {
                TextureFormat::Rgba8 => Some(ColorFormat::Rgba8),
                TextureFormat::Rgb8 => Some(ColorFormat::Rgb8),
                TextureFormat::Rgb5a1 => Some(ColorFormat::Rgb5a1),
                TextureFormat::Rgb565 => Some(ColorFormat::Rgb565),
                TextureFormat::Rgba4 => Some(ColorFormat::Rgba4),
                _ => None,
            };
            if let Some(color) = color {
                if let Some((view, id)) = self.pending_texture(address, color, width, height) {
                    let k = self.scale as f32;
                    self.stats.live_textures += 1;
                    let wrap = [(config >> 12) & 7, (config >> 8) & 7, 0, 0];
                    return Some((view, id, [width as f32 * k, height as f32 * k, linear, 2.0], wrap, byte_color(regs[border_reg])));
                }
            }
        }
        // un transfert vers l'écran en attente, ou une texture qui est un tampon de rendu : les rendre d'abord
        self.materialize_overlapping(memory, address, size);
        let overlapping: Vec<usize> = (0..self.color_surfaces.len())
            .filter(|&i| {
                let s = &self.color_surfaces[i];
                s.dirty && overlaps(s.address, s.bytes(), address, size)
            })
            .collect();
        for i in overlapping {
            if self.trace {
                let c = &self.color_surfaces[i];
                eprintln!("texture {unit} {:x} {width}x{height} fmt {:?} relit le tampon de couleur {:x} {}x{} {:?}", address, fmt, c.address, c.width, c.height, c.fmt);
            }
            self.flush_color(i, memory);
        }
        // ou un tampon de profondeur (le terrain le relit en RGBA8)
        let overlapping_depth: Vec<usize> = (0..self.depth_surfaces.len())
            .filter(|&i| {
                let s = &self.depth_surfaces[i];
                s.dirty && overlaps(s.address, s.bytes(), address, size)
            })
            .collect();
        for i in overlapping_depth {
            if self.trace {
                let c = &self.depth_surfaces[i];
                eprintln!("texture {unit} {:x} {width}x{height} fmt {:?} relit le tampon de profondeur {:x} {}x{} fmt {}", address, fmt, c.address, c.width, c.height, c.fmt);
            }
            self.flush_depth(i, memory);
        }
        let key = (address, width, height, regs[format_reg] & 15);
        if self.trace_textures {
            eprintln!("texture {unit} {:x} {width}x{height} {:?}", address, fmt);
        }
        // la mémoire n'a pas été écrite sous la texture depuis la dernière vérification : rien à relire
        let stamp = memory.stamp(address, size);
        let clock = memory.clock();
        let unchanged = self.textures.get(&key).map(|e| stamp <= e.checked).unwrap_or(false);
        let mut fresh = false;
        let mut new_crc = 0;
        if !unchanged {
            let Some(raw) = memory.read(address, size) else {
                self.note("texture illisible");
                return None;
            };
            new_crc = crc32fast::hash(&raw);
            match self.textures.get_mut(&key) {
                Some(e) if e.crc == new_crc => e.checked = clock,
                _ => fresh = true,
            }
        }
        if fresh {
            let raw = memory.read(address, size).expect("plage lue");
            let pixels = match formats::decode_texture(fmt, &raw, width, height) {
                Ok(p) => p,
                Err(e) => {
                    self.note(format!("texture illisible : {e}"));
                    return None;
                }
            };
            self.stats.textures_decoded += 1;
            if self.textures.len() > 200 {
                self.textures.clear();
                self.bind_groups.clear();
            }
            let id = self.next_id;
            self.next_id += 1;
            let texture = self.device.create_texture_with_data(
                &self.queue,
                &wgpu::TextureDescriptor {
                    label: Some("texture du jeu"),
                    size: wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: COLOR_FORMAT,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                wgpu::util::TextureDataOrder::LayerMajor,
                &pixels,
            );
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            self.textures.insert(key, TextureEntry { id, crc: new_crc, checked: clock, texture, view });
        }
        let entry = &self.textures[&key];
        let _ = &entry.texture;
        Some((
            entry.view.clone(),
            entry.id,
            [width as f32, height as f32, linear, 2.0],
            [(config >> 12) & 7, (config >> 8) & 7, 0, 0],
            byte_color(regs[border_reg]),
        ))
    }

    // --- le dessin ---

    fn vertex_module(&mut self, state: &GpuState) -> Option<u64> {
        let regs = &state.regs;
        let mut semantics = [0u32; 7];
        for (k, w) in semantics.iter_mut().enumerate() {
            *w = regs[0x50 + k];
        }
        let quick = (state.program_version, regs[0x2BA] & 0xFFFF, regs[0x2BD] & 0xFFFF, semantics);
        if let Some(found) = self.vs_by_version.get(&quick) {
            return *found;
        }
        let key = ProgramKey::from_state(state);
        let id = if let Some(found) = self.vs_by_key.get(&key) {
            *found
        } else {
            let id = match shader::translate(&key) {
                Ok(text) => {
                    let id = self.vs_modules.len() as u64 + 1;
                    let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
                        label: Some("shader de sommets"),
                        source: wgpu::ShaderSource::Wgsl(text.into()),
                    });
                    self.vs_modules.insert(id, module);
                    self.stats.vertex_programs += 1;
                    Some(id)
                }
                Err(e) => {
                    self.note(format!("shader de sommets non traduit : {e}"));
                    None
                }
            };
            self.vs_by_key.insert(key, id);
            id
        };
        self.vs_by_version.insert(quick, id);
        id
    }

    fn fragment_module(&mut self, state: &GpuState, logic: bool, depth_out: bool) -> u64 {
        let quick = fragment::cache_key(state, logic, depth_out);
        if let Some(&id) = self.fs_by_key.get(&quick) {
            return id;
        }
        let text = fragment::generate(state, logic, depth_out);
        if let Some(&id) = self.fs_ids.get(&text) {
            self.fs_by_key.insert(quick, id);
            return id;
        }
        let id = self.fs_ids.len() as u64 + 1;
        let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("shader de fragments"),
            source: wgpu::ShaderSource::Wgsl(text.clone().into()),
        });
        self.fs_modules.insert(id, module);
        self.fs_ids.insert(text, id);
        self.fs_by_key.insert(quick, id);
        self.stats.fragment_programs += 1;
        id
    }

    /// Les sommets d'un dessin : décodés une fois, puis gardés tant que ni les registres qui les décrivent ni la mémoire
    /// qu'ils lisent ne changent (le terrain est redessiné à l'identique d'une image à l'autre).
    fn vertex_data(&mut self, state: &GpuState, memory: &mut Memory, indexed: bool) -> Option<Arc<vertex::VertexData>> {
        let regs = &state.regs;
        let mut key: Vec<u32> = Vec::with_capacity(64);
        key.extend_from_slice(&regs[0x200..=0x22A]);
        key.extend_from_slice(&[regs[0x25E], regs[0x2BB], regs[0x2BC], indexed as u32]);
        let fixed_mask = (regs[0x202] >> 16) & 0xFFF;
        for a in 0..12 {
            if fixed_mask >> a & 1 != 0 {
                key.extend(state.fixed[a].iter().map(|v| v.to_bits()));
            }
        }
        let ranges = match self.meshes.get(&key) {
            Some(entry) => entry.ranges.clone(),
            None => vertex::read_ranges(state, memory, indexed),
        };
        if !self.pending.is_empty() || self.color_surfaces.iter().any(|s| s.dirty) || self.depth_surfaces.iter().any(|s| s.dirty) {
            for &(start, len) in &ranges {
                self.sync_read(memory, start, len);
            }
        }
        if let Some(entry) = self.meshes.get(&key) {
            if entry.ranges.iter().all(|&(start, len)| memory.stamp(start, len) <= entry.checked) {
                self.stats.mesh_hits += 1;
                return Some(entry.data.clone());
            }
            let old = self.meshes.remove(&key).unwrap();
            self.mesh_bytes -= old.bytes;
        }
        let ranges = vertex::read_ranges(state, memory, indexed);
        let clock = memory.clock();
        let data = Arc::new(vertex::load(state, memory, indexed)?);
        let bytes = data.inputs.len() * 16 + data.triangles.len() * 4;
        if self.mesh_bytes + bytes > (256 << 20) {
            self.meshes.clear();
            self.mesh_bytes = 0;
        }
        self.mesh_bytes += bytes;
        self.meshes.insert(key, MeshEntry { checked: clock, ranges, data: data.clone(), bytes });
        Some(data)
    }

    /// Un ordre de dessin (registres 0x22E et 0x22F).
    pub fn draw(&mut self, state: &GpuState, memory: &mut Memory, indexed: bool) {
        let regs = &state.regs;
        self.stats.draws += 1;
        if self.trace {
            eprintln!("dessin {} : n={} indexé={} topologie={} entrée={:x} éclairage={}", self.stats.draws, regs[0x228], indexed, (regs[0x25E] >> 8) & 3, regs[0x2BA] & 0xFFFF, crate::lighting_on(state));
        }
        let t = self.now();
        let Some(color_index) = self.color_surface(state, memory) else {
            self.note("dessin sans tampon de couleur");
            return;
        };
        let depth_index = self.depth_surface(state, memory);
        self.tick("tampons de rendu", t);
        let t = self.now();
        let Some(vertices) = self.vertex_data(state, memory, indexed) else { return };
        self.tick("sommets", t);
        for n in &vertices.notes {
            self.note(*n);
        }
        if vertices.triangles.is_empty() {
            return;
        }
        let t = self.now();
        let Some(vs_id) = self.vertex_module(state) else { return };
        let blending = (regs[0x100] >> 8) & 1 != 0;
        let logic_op = if !blending && state.seen[0x102] { regs[0x102] & 15 } else { 3 };
        let fs_id = self.fragment_module(state, logic_op != 3, depth_index.is_some());
        self.tick("shaders", t);
        self.stats.triangles += (vertices.triangles.len() / 3) as u64;

        // notes sur ce qui n'est pas fait
        if (regs[0x80] >> 10) & 1 != 0 {
            self.note("texture 3 (textures procédurales) non faite");
        }
        if regs[0x229] & 3 == 2 {
            self.note("shader de géométrie demandé (non fait : la référence du banc ne l'a vu dans aucune capture du jeu)");
        }

        // les textures
        let t = self.now();
        let used = fragment::used_texture_units(regs);
        let mut views = [self.dummy_view.clone(), self.dummy_view.clone(), self.dummy_view.clone()];
        let mut view_ids = [0u64; 3];
        let mut uniform = DrawUniform::zeroed();
        for unit in 0..3 {
            if used[unit] && (regs[0x80] >> unit) & 1 != 0 {
                match self.get_texture(state, memory, unit, color_index) {
                    Some((view, id, dim, wrap, border)) => {
                        views[unit] = view;
                        view_ids[unit] = id;
                        uniform.tex_dim[unit] = dim;
                        uniform.tex_wrap[unit] = wrap;
                        uniform.tex_border[unit] = border;
                    }
                    None => {
                        uniform.tex_dim[unit] = [1.0, 1.0, 0.0, 1.0];
                        self.note(format!("texture {unit} introuvable"));
                    }
                }
            }
        }

        self.tick("textures", t);
        let t = self.now();
        // le bloc de constantes du dessin
        for (i, c) in state.uniforms.iter().enumerate().take(96) {
            uniform.c[i] = *c;
        }
        for k in 0..4 {
            let w = regs[0x2B1 + k];
            uniform.ints[k] = [w & 0xFF, (w >> 8) & 0xFF, (w >> 16) & 0xFF, 0];
        }
        uniform.misc = [regs[0x2B0] & 0xFFFF, vertices.stride as u32, 0, 0];
        let (surface_w, surface_h) = (self.color_surfaces[color_index].width as f32, self.color_surfaces[color_index].height as f32);
        let hx = f24_to_f32(regs[0x41] & 0xFF_FFFF);
        let hy = f24_to_f32(regs[0x43] & 0xFF_FFFF);
        let zscale = f24_to_f32(regs[0x4D] & 0xFF_FFFF);
        let zoffset = f24_to_f32(regs[0x4E] & 0xFF_FFFF);
        let (corner_x, corner_y) = ((regs[0x68] & 0x3FF) as f32, ((regs[0x68] >> 16) & 0x3FF) as f32);
        uniform.xf0 = [2.0 * hx / surface_w, (2.0 * hx + 2.0 * corner_x) / surface_w - 1.0, 2.0 * hy / surface_h, (2.0 * hy + 2.0 * corner_y) / surface_h - 1.0];
        uniform.xf1 = [zscale, zoffset, 0.0, 0.0];
        for (k, &base) in fragment::STAGE_BASES.iter().enumerate() {
            uniform.tev_const[k] = byte_color(regs[base + 3]);
        }
        uniform.buffer_color = byte_color(regs[0xFD]);
        uniform.fog_color = byte_color(regs[0xE1]);
        uniform.alpha_test = if regs[0x104] & 1 != 0 { [1, (regs[0x104] >> 4) & 7, (regs[0x104] >> 8) & 255, 0] } else { [0; 4] };
        for e in 0..128 {
            uniform.fog[e / 2][(e % 2) * 2] = state.fog[e][0];
            uniform.fog[e / 2][(e % 2) * 2 + 1] = state.fog[e][1];
        }

        uniform.misc2 = [logic_op, 0, 0, 0];
        uniform.blend_pre = [1.0; 4];
        for i in 0..48 {
            for k in 0..4 {
                uniform.light[i][k] = regs[0x140 + i * 4 + k];
            }
        }

        // l'état de fusion
        let color_write = !state.seen[0x113] || regs[0x113] & 15 != 0;
        let color_mask = ((regs[0x107] >> 8) & 15) as u8;
        let write_mask = if color_write { color_mask } else { 0 };
        let blend_cfg = regs[0x101];
        // Les facteurs « constante » de la source (couleur ou alpha constants, ou leur complément) ne tiennent pas dans le
        // mélange du GPU en même temps que ceux de la destination : la source est multipliée dans le shader (facteur
        // « un » pour le GPU) et la constante du GPU sert à la destination. Rien n'est approché.
        let constant_color = byte_color(regs[0x103]);
        let mut blend_constant = constant_color;
        let blend = blending.then(|| {
            let mut b = [
                (blend_cfg & 7) as u8,
                ((blend_cfg >> 8) & 7) as u8,
                ((blend_cfg >> 16) & 15) as u8,
                ((blend_cfg >> 20) & 15) as u8,
                ((blend_cfg >> 24) & 15) as u8,
                ((blend_cfg >> 28) & 15) as u8,
            ];
            let min_max_rgb = matches!(b[0], 3 | 4);
            let min_max_alpha = matches!(b[1], 3 | 4);
            let factor_value = |code: u8| -> [f32; 3] {
                let (c, a) = (constant_color, constant_color[3]);
                match code {
                    10 => [c[0], c[1], c[2]],
                    11 => [1.0 - c[0], 1.0 - c[1], 1.0 - c[2]],
                    12 => [a; 3],
                    _ => [1.0 - a; 3],
                }
            };
            if (10..=13).contains(&b[2]) && !min_max_rgb {
                let v = factor_value(b[2]);
                uniform.blend_pre[..3].copy_from_slice(&v);
                b[2] = 1;
            }
            if (10..=13).contains(&b[4]) && !min_max_alpha {
                uniform.blend_pre[3] = factor_value(b[4])[0];
                b[4] = 1;
            }
            if matches!(b[3], 12 | 13) && !min_max_rgb {
                blend_constant = [constant_color[3]; 4];
            }
            b
        });
        let depth_cfg = regs[0x107];
        let depth_test = depth_cfg & 1 != 0;
        let depth_write = (depth_cfg >> 12) & 1 != 0 && (!state.seen[0x115] || regs[0x115] & 3 != 0);
        let depth_state = depth_index.map(|i| {
            let surface = &self.depth_surfaces[i];
            let stencil_format = surface.format == DEPTH_STENCIL_FORMAT;
            let stencil = (regs[0x105] & 1 != 0 && surface.fmt == 3 && stencil_format).then(|| {
                [
                    ((regs[0x105] >> 4) & 7) as u8,
                    (regs[0x106] & 7) as u8,
                    ((regs[0x106] >> 4) & 7) as u8,
                    ((regs[0x106] >> 8) & 7) as u8,
                    ((regs[0x105] >> 24) & 255) as u8,
                    ((regs[0x105] >> 8) & 255) as u8,
                ]
            });
            DepthKey { compare: if depth_test { ((depth_cfg >> 4) & 7) as u8 } else { 1 }, write: depth_write, stencil_format, stencil }
        });
        if regs[0x105] & 1 != 0 && depth_index.is_some() && !depth_state.as_ref().map(|d| d.stencil.is_some()).unwrap_or(false) {
            self.note("pochoir demandé sans tampon de pochoir (D24S8 ou pochoir non pris en charge)");
        }
        self.tick("etat", t);
        let t = self.now();
        let stencil_reference = (regs[0x105] >> 16) & 255;
        let key = PipelineKey { vs: vs_id, fs: fs_id, blend, write_mask, depth: depth_state, cull: (regs[0x40] & 3) as u8 };
        if !self.pipelines.contains_key(&key) {
            let pipeline = self.build_pipeline(&key);
            self.pipelines.insert(key.clone(), pipeline);
            self.stats.pipelines += 1;
        }
        let pipeline = self.pipelines[&key].clone();
        self.tick("pipeline", t);
        let t = self.now();

        // les tampons du dessin : des morceaux des grands tampons
        let uniform_bytes = std::mem::size_of::<DrawUniform>() as u64;
        let input_bytes = (vertices.inputs.len() * 16) as u64;
        let index_bytes = (vertices.triangles.len() * 4) as u64;
        let lighting = crate::lighting_on(state);
        let lut_at = if lighting { self.lut_offset(state) } else { 0 };
        let Some((uniform_at, input_at, index_at)) = self.alloc_draw(uniform_bytes, input_bytes, index_bytes) else {
            self.note("dessin trop grand pour les tampons : sauté");
            return;
        };
        uniform.misc[2] = (input_at / 16) as u32;
        self.uniform_arena.write(uniform_at, bytemuck::bytes_of(&uniform));
        self.input_arena.write(input_at, bytemuck::cast_slice(&vertices.inputs));
        self.index_arena.write(index_at, bytemuck::cast_slice(&vertices.triangles));
        // l'opération logique lit le tampon de couleur d'avant le dessin : on le copie
        let dst_copy = (logic_op != 3).then(|| {
            let source = &self.color_surfaces[color_index];
            let size = wgpu::Extent3d { width: source.width as u32 * self.scale, height: source.height as u32 * self.scale, depth_or_array_layers: 1 };
            let copy = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("tampon de couleur avant"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: COLOR_FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let texture = source.texture.clone();
            self.encoder().copy_texture_to_texture(texture.as_image_copy(), copy.as_image_copy(), size);
            copy
        });
        let group_key = [view_ids[0], view_ids[1], view_ids[2], 0, 0, self.arena_generation];
        let bind = match &dst_copy {
            Some(copy) => {
                let dst_view = copy.create_view(&wgpu::TextureViewDescriptor::default());
                self.make_bind_group(&views, &dst_view)
            }
            None => {
                if !self.bind_groups.contains_key(&group_key) {
                    let dummy = self.dummy_view.clone();
                    let group = self.make_bind_group(&views, &dummy);
                    self.stats.bind_groups += 1;
                    self.bind_groups.insert(group_key, group);
                }
                self.bind_groups[&group_key].clone()
            }
        };

        self.tick("tampons", t);
        let t = self.now();
        // les rectangles de ciseaux : « inclure » en un rectangle, « exclure » en quatre autour du trou
        let s = self.scale;
        let (full_w, full_h) = (surface_w as u32, surface_h as u32);
        let (x_min, y_min) = (regs[0x66] & 0x3FF, (regs[0x66] >> 16) & 0x3FF);
        let (x_max, y_max) = (regs[0x67] & 0x3FF, (regs[0x67] >> 16) & 0x3FF);
        let mut rects: Vec<(u32, u32, u32, u32)> = Vec::new(); // x, y, largeur, hauteur en points natifs
        match regs[0x65] & 3 {
            3 => {
                let (x0, y0) = (x_min.min(full_w), y_min.min(full_h));
                let (x1, y1) = ((x_max + 1).min(full_w), (y_max + 1).min(full_h));
                if x1 > x0 && y1 > y0 {
                    rects.push((x0, y0, x1 - x0, y1 - y0));
                }
            }
            1 => {
                let (x0, y0) = (x_min.min(full_w), y_min.min(full_h));
                let (x1, y1) = ((x_max + 1).min(full_w), (y_max + 1).min(full_h));
                if x1 <= x0 || y1 <= y0 {
                    rects.push((0, 0, full_w, full_h));
                } else {
                    rects.push((0, 0, full_w, y0));
                    rects.push((0, y1, full_w, full_h - y1));
                    rects.push((0, y0, x0, y1 - y0));
                    rects.push((x1, y0, full_w - x1, y1 - y0));
                    rects.retain(|r| r.2 > 0 && r.3 > 0);
                }
            }
            _ => rects.push((0, 0, full_w, full_h)),
        }
        let constant = wgpu::Color { r: blend_constant[0] as f64, g: blend_constant[1] as f64, b: blend_constant[2] as f64, a: blend_constant[3] as f64 };
        let color_view = self.color_surfaces[color_index].view.clone();
        let depth_view = depth_index.map(|i| self.depth_surfaces[i].view.clone());
        let has_stencil = depth_index.map(|i| self.depth_surfaces[i].format == DEPTH_STENCIL_FORMAT).unwrap_or(false);
        let count = vertices.triangles.len() as u32;
        let index_buffer = self.index_arena.buffer.clone();
        let pass_key = (self.color_surfaces[color_index].id, depth_index.map(|i| self.depth_surfaces[i].id).unwrap_or(0), has_stencil);
        if self.pass.as_ref().map(|(k, _)| *k) != Some(pass_key) {
            self.pass = None;
            let encoder = self.open_encoder();
            let pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("dessin"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &color_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: depth_view.as_ref().map(|v| wgpu::RenderPassDepthStencilAttachment {
                    view: v,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store }),
                    stencil_ops: has_stencil.then_some(wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store }),
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            self.pass = Some((pass_key, pass.forget_lifetime()));
        }
        {
            let pass = &mut self.pass.as_mut().expect("passe ouverte").1;
            pass.set_pipeline(&pipeline);
            pass.set_stencil_reference(stencil_reference);
            pass.set_bind_group(0, &bind, &[uniform_at as u32, lut_at as u32]);
            pass.set_index_buffer(index_buffer.slice(index_at..index_at + index_bytes), wgpu::IndexFormat::Uint32);
            pass.set_viewport(0.0, 0.0, (full_w * s) as f32, (full_h * s) as f32, 0.0, 1.0);
            pass.set_blend_constant(constant);
            for (x, y, w, h) in rects {
                pass.set_scissor_rect(x * s, y * s, w * s, h * s);
                pass.draw_indexed(0..count, 0, 0..1);
            }
        }
        self.tick("passe", t);
        self.color_surfaces[color_index].dirty = true;
        if let (Some(i), Some(d)) = (depth_index, key.depth.as_ref()) {
            if d.write || d.stencil.map(|st| st[5] != 0).unwrap_or(false) {
                self.depth_surfaces[i].dirty = true;
                self.depth_surfaces[i].version += 1;
            }
        }
    }

    /// Change la taille des grands tampons des dessins (en octets) : pour essayer le passage d'un envoi à l'autre et
    /// l'agrandissement avec de petits tampons. Un tampon de constantes doit contenir au moins un dessin.
    pub fn set_arena_sizes(&mut self, uniform: u64, input: u64, index: u64) {
        self.submit();
        self.uniform_arena = Arena::new(&self.device, "constantes", uniform.max(self.uniform_align + std::mem::size_of::<DrawUniform>() as u64), wgpu::BufferUsages::UNIFORM);
        self.input_arena = Arena::new(&self.device, "sommets", input.max(16), wgpu::BufferUsages::STORAGE);
        self.index_arena = Arena::new(&self.device, "indices", index.max(4), wgpu::BufferUsages::INDEX);
        self.arena_generation += 1;
        self.bind_groups.clear();
    }

    /// Réserve les morceaux d'un dessin dans les grands tampons ; s'ils sont pleins, envoie le travail au GPU et repart de
    /// zéro (et les agrandit si un seul dessin ne tient pas).
    fn alloc_draw(&mut self, uniform: u64, input: u64, index: u64) -> Option<(u64, u64, u64)> {
        for attempt in 0..3 {
            let a = self.uniform_arena.alloc(uniform, self.uniform_align);
            let b = self.input_arena.alloc(input.max(16), 16);
            let c = self.index_arena.alloc(index.max(4), 4);
            if let (Some(a), Some(b), Some(c)) = (a, b, c) {
                return Some((a, b, c));
            }
            self.submit();
            if attempt >= 1 {
                // un dessin plus grand que le tampon : on l'agrandit
                let limit = self.device.limits().max_storage_buffer_binding_size as u64;
                if input.max(16) > limit {
                    return None; // plus que ce que le GPU peut lier : le dessin est sauté
                }
                if input.max(16) > self.input_arena.size {
                    let size = input.max(16).next_power_of_two().min(limit);
                    self.input_arena = Arena::new(&self.device, "sommets", size, wgpu::BufferUsages::STORAGE);
                }
                if index.max(4) > self.index_arena.size {
                    self.index_arena = Arena::new(&self.device, "indices", index.max(4).next_power_of_two(), wgpu::BufferUsages::INDEX);
                }
                self.arena_generation += 1;
                self.bind_groups.clear();
            }
        }
        None
    }

    /// La copie des tables d'éclairage de cette version dans l'envoi en cours (écrite une seule fois).
    fn lut_offset(&mut self, state: &GpuState) -> u64 {
        if let Some((version, at)) = self.lut_at {
            if version == state.lut_version {
                return at;
            }
        }
        // le jeu réécrit souvent les mêmes tables : un contenu déjà copié dans cet envoi est réutilisé
        let bytes: &[u8] = bytemuck::cast_slice(&state.luts);
        let crc = crc32fast::hash(bytes);
        if let Some(&(_, at)) = self.lut_copies.iter().find(|(c, _)| *c == crc) {
            self.lut_at = Some((state.lut_version, at));
            return at;
        }
        let at = match self.lut_arena.alloc(LUT_BYTES, self.lut_align) {
            Some(at) => at,
            None => {
                self.submit();
                self.lut_arena.alloc(LUT_BYTES, self.lut_align).expect("une copie des tables tient dans le tampon")
            }
        };
        self.lut_arena.write(at, bytes);
        self.lut_copies.push((crc, at));
        self.lut_at = Some((state.lut_version, at));
        self.stats.lut_uploads += 1;
        at
    }

    fn make_bind_group(&self, views: &[wgpu::TextureView; 3], dst_view: &wgpu::TextureView) -> wgpu::BindGroup {
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("dessin"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &self.uniform_arena.buffer,
                        offset: 0,
                        size: std::num::NonZeroU64::new(std::mem::size_of::<DrawUniform>() as u64),
                    }),
                },
                wgpu::BindGroupEntry { binding: 1, resource: self.input_arena.buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&views[0]) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&views[1]) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(&views[2]) },
                wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(dst_view) },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding { buffer: &self.lut_arena.buffer, offset: 0, size: std::num::NonZeroU64::new(LUT_BYTES) }),
                },
            ],
        })
    }

    fn build_pipeline(&self, key: &PipelineKey) -> wgpu::RenderPipeline {
        let blend = key.blend.map(|b| wgpu::BlendState {
            color: component(b[0], b[2], b[3]),
            alpha: component(b[1], b[4], b[5]),
        });
        let cull_mode = match key.cull {
            1 => Some(wgpu::Face::Front), // mode 1 : on garde le sens horaire
            2 => Some(wgpu::Face::Back),  // mode 2 : on garde l'antihoraire
            _ => None,
        };
        let depth_stencil = key.depth.as_ref().map(|d| {
            let stencil = match d.stencil {
                Some(st) => {
                    let face = wgpu::StencilFaceState {
                        compare: compare_function(st[0] as u32),
                        fail_op: stencil_operation(st[1]),
                        depth_fail_op: stencil_operation(st[2]),
                        pass_op: stencil_operation(st[3]),
                    };
                    wgpu::StencilState { front: face, back: face, read_mask: st[4] as u32, write_mask: st[5] as u32 }
                }
                None => Default::default(),
            };
            wgpu::DepthStencilState {
                format: if d.stencil_format { DEPTH_STENCIL_FORMAT } else { DEPTH_FORMAT },
                depth_write_enabled: Some(d.write),
                depth_compare: Some(compare_function(d.compare as u32)),
                stencil,
                bias: Default::default(),
            }
        });
        let vs = &self.vs_modules[&key.vs];
        let fs = &self.fs_modules[&key.fs];
        self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("pica"),
            layout: Some(&self.pipeline_layout),
            vertex: wgpu::VertexState { module: vs, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleList, front_face: wgpu::FrontFace::Ccw, cull_mode, ..Default::default() },
            depth_stencil,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: fs,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend, write_mask: wgpu::ColorWrites::from_bits_truncate(key.write_mask as u32) })],
            }),
            multiview_mask: None,
            cache: None,
        })
    }
}

fn stencil_operation(code: u8) -> wgpu::StencilOperation {
    use wgpu::StencilOperation as O;
    match code {
        0 => O::Keep,
        1 => O::Zero,
        2 => O::Replace,
        3 => O::IncrementClamp,
        4 => O::DecrementClamp,
        5 => O::Invert,
        6 => O::IncrementWrap,
        _ => O::DecrementWrap,
    }
}

fn component(equation: u8, src: u8, dst: u8) -> wgpu::BlendComponent {
    let operation = blend_operation(equation as u32);
    if matches!(operation, wgpu::BlendOperation::Min | wgpu::BlendOperation::Max) {
        // les facteurs n'existent pas pour min et max
        return wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation };
    }
    wgpu::BlendComponent { src_factor: blend_factor(src as u32), dst_factor: blend_factor(dst as u32), operation }
}
