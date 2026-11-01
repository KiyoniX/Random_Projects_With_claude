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
    /// Le haut remplit un 400 x 240 ; les quatre boutons de capacité sont empilés à droite.
    Moves,
}

/// Un morceau d'écran posé dans le repère : (x0, y0, x1, y1) dans la disposition, et ce qu'il montre en pixels de l'écran.
#[derive(Clone, Copy)]
struct Piece {
    bottom: bool,
    to: [f32; 4],
    from: [f32; 4],
}

const TOP_WHOLE: [f32; 4] = [0.0, 0.0, 400.0, 240.0];
const BOTTOM_WHOLE: [f32; 4] = [0.0, 0.0, 320.0, 240.0];
/// Les quatre boutons de l'écran des capacités, deux par deux, en pixels de l'écran du bas.
const MOVE_BUTTONS: [[f32; 4]; 4] = [[0.0, 40.0, 160.0, 99.0], [160.0, 40.0, 320.0, 99.0], [0.0, 101.0, 160.0, 160.0], [160.0, 101.0, 320.0, 160.0]];
/// Le bas de cet écran : le retour et un bouton de plus (id 7 de `DllBattle`, peut-être la Méga-Évolution), à garder.
const MOVE_SCREEN_BOTTOM: [f32; 4] = [0.0, 160.0, 320.0, 240.0];
/// La colonne : une ligne par bouton, puis le bas de l'écran, en bas à droite de la fenêtre.
const MOVE_ROW_HEIGHT: f32 = 34.0;
const MOVE_ROW_WIDTH: f32 = 104.0;
const MOVE_BOTTOM_HEIGHT: f32 = 26.0;
const MAX_PIECES: usize = 6;


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
            Layout::Moves => {
                let (left, bottom_top) = (400.0 - MOVE_ROW_WIDTH, 240.0 - MOVE_BOTTOM_HEIGHT);
                let mut pieces = vec![top];
                for (i, from) in MOVE_BUTTONS.into_iter().enumerate() {
                    let y = bottom_top - (4 - i) as f32 * MOVE_ROW_HEIGHT;
                    pieces.push(Piece { bottom: true, to: [left, y, 400.0, y + MOVE_ROW_HEIGHT], from });
                }
                pieces.push(Piece { bottom: true, to: [left, bottom_top, 400.0, 240.0], from: MOVE_SCREEN_BOTTOM });
                pieces
            }
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

pub fn open(event_loop: &ActiveEventLoop, title: &str, width: f64, height: f64) -> Arc<Window> {
    Arc::new(
        event_loop
            .create_window(Window::default_attributes().with_title(title).with_inner_size(LogicalSize::new(width, height)))
            .expect("fenêtre"),
    )
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
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("fenêtre"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), compilation_options: Default::default(), targets: &[Some(config.format.into())] }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = |filter| device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: filter, min_filter: filter, ..Default::default() });
        let (nearest, linear) = (sampler(wgpu::FilterMode::Nearest), sampler(wgpu::FilterMode::Linear));
        let rect = || device.create_buffer(&wgpu::BufferDescriptor { label: Some("rectangle"), size: 32, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let rects = std::array::from_fn(|_| rect());
        Ok(Screens { window, gpu, surface, config, pipeline, layout, nearest, linear, rects })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&self.gpu.device, &self.config);
        self.window.request_redraw();
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
        let (ww, wh) = (width as f32, height as f32);
        let (f, ox, oy) = layout.fit(ww, wh);
        let mut binds = Vec::new();
        for (piece, rect) in layout.pieces().iter().zip(&self.rects) {
            let Some(texture) = textures[piece.bottom as usize] else { continue };
            let px = |x: f32| (ox + x * f) / ww * 2.0 - 1.0;
            let py = |y: f32| 1.0 - (oy + y * f) / wh * 2.0;
            let (w, h) = if piece.bottom { (320.0, 240.0) } else { (400.0, 240.0) };
            let [tx0, ty0, tx1, ty1] = piece.to;
            let [sx0, sy0, sx1, sy1] = piece.from;
            let words = [px(tx0), py(ty0), px(tx1), py(ty1), sx0 / w, sy0 / h, sx1 / w, sy1 / h];
            self.gpu.queue.write_buffer(rect, 0, bytemuck::cast_slice(&words));
            let texture_view = texture.create_view(&Default::default());
            binds.push(self.gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("écran"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: rect.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&texture_view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(if smooth { &self.linear } else { &self.nearest }) },
                ],
            }));
        }
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
            self.window = Some(open(event_loop, "Pokémon X, portage PC", 800.0, 960.0));
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
    use super::Layout;

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
        // deux écrans l'un sur l'autre : le bas commence à la moitié
        assert_eq!(Layout::Stacked.bottom_point(800.0, 960.0, 80.0, 480.0), Some((0, 0)));
        assert_eq!(Layout::Stacked.bottom_point(800.0, 960.0, 80.0, 479.0), None);
    }
}
