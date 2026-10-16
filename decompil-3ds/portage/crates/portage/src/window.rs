//! Les fenêtres : les deux écrans l'un sur l'autre, dessinés avec le GPU même du rendu (la surface vient de l'instance
//! de pica : pas de second appareil). [`Screens`] sert à la capture rejouée (`portage window`) comme au jeu en direct
//! (`portage play`).
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
struct Rect { v: vec4<f32> }   // x0, y0, x1, y1 en coordonnées d'écran (-1..1, y vers le haut)
@group(0) @binding(0) var<uniform> rect: Rect;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
struct Out { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
    let c = vec2<f32>(f32(i & 1u), f32((i >> 1u) & 1u));
    var o: Out;
    o.p = vec4<f32>(mix(rect.v.x, rect.v.z, c.x), mix(rect.v.w, rect.v.y, c.y), 0.0, 1.0);
    o.uv = vec2<f32>(c.x, 1.0 - c.y);   // la première ligne de l'image est en haut
    return o;
}
@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
    return textureSample(img, samp, in.uv);
}
"#;

/// Une fenêtre de la taille des deux écrans à l'échelle 2.
pub fn open(event_loop: &ActiveEventLoop, title: &str) -> Arc<Window> {
    Arc::new(
        event_loop
            .create_window(Window::default_attributes().with_title(title).with_inner_size(LogicalSize::new(800.0, 960.0)))
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
    /// Le rectangle de chaque écran (haut, bas).
    rects: [wgpu::Buffer; 2],
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
        let rect = || device.create_buffer(&wgpu::BufferDescriptor { label: Some("rectangle"), size: 16, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let rects = [rect(), rect()];
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

    /// Encode les écrans du haut et du bas (s'ils existent) dans `view`, une image de `width` x `height` : le haut sur
    /// les 240 premières lignes du 400 x 480 agrandi au mieux, le bas centré en dessous.
    fn compose(&self, view: &wgpu::TextureView, width: u32, height: u32, textures: [Option<&wgpu::Texture>; 2], smooth: bool) -> wgpu::CommandEncoder {
        let (ww, wh) = (width as f32, height as f32);
        let f = (ww / 400.0).min(wh / 480.0);
        let (ox, oy) = ((ww - 400.0 * f) / 2.0, (wh - 480.0 * f) / 2.0);
        let areas = [(0.0, 0.0, 400.0, 240.0), (40.0, 240.0, 360.0, 480.0)];
        let mut binds = Vec::new();
        for ((texture, rect), r) in textures.iter().zip(&self.rects).zip(areas) {
            let Some(texture) = texture else { continue };
            let px = |x: f32| (ox + x * f) / ww * 2.0 - 1.0;
            let py = |y: f32| 1.0 - (oy + y * f) / wh * 2.0;
            self.gpu.queue.write_buffer(rect, 0, bytemuck::cast_slice(&[px(r.0), py(r.1), px(r.2), py(r.3)]));
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
    pub fn draw(&mut self, textures: [Option<&wgpu::Texture>; 2], smooth: bool) {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.gpu.device, &self.config);
                return;
            }
            _ => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let encoder = self.compose(&view, self.config.width, self.config.height, textures, smooth);
        self.gpu.queue.submit(Some(encoder.finish()));
        frame.present();
    }

    /// Ce que la fenêtre présente, composé de la même façon (même passe, même format de surface) dans une image de
    /// 400 x 480 fois `scale`, relu : rend les deux écrans (largeur, hauteur, RGBA), pour les comparer aux PNG du banc.
    pub fn capture(&self, textures: [Option<&wgpu::Texture>; 2], scale: u32) -> [(usize, usize, Vec<u8>); 2] {
        let (width, height) = (400 * scale, 480 * scale);
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
        let mut encoder = self.compose(&target.create_view(&Default::default()), width, height, textures, false);
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
        let s = scale as usize;
        let crop = |x0: usize, y0: usize, w: usize, h: usize| {
            let mut out = Vec::with_capacity(w * h * 4);
            for y in y0..y0 + h {
                for p in data[y * row as usize + x0 * 4..y * row as usize + (x0 + w) * 4].chunks_exact(4) {
                    out.extend_from_slice(&if bgra { [p[2], p[1], p[0], 255] } else { [p[0], p[1], p[2], 255] });
                }
            }
            (w, h, out)
        };
        [crop(0, 0, 400 * s, 240 * s), crop(40 * s, 240 * s, 320 * s, 240 * s)]
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
            screens.draw([pick(&self.tops, self.frame), pick(&self.bottoms, self.frame)], self.smooth);
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            self.window = Some(open(event_loop, "Pokémon X, portage PC"));
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
