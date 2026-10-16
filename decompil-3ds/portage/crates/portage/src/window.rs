//! La petite fenêtre : affiche une capture rejouée, les deux écrans l'un sur l'autre, à l'échelle réglable.
//!
//! Touches : 1 à 4 changent l'échelle de rendu (la capture est rejouée), Gauche et Droite changent d'image, L bascule
//! entre l'agrandissement lissé et au plus proche, Échap quitte.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use wgpu::util::DeviceExt;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

use capture::Capture;

struct Picture {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

struct Quad {
    uniform: wgpu::Buffer,
    bind: wgpu::BindGroup,
}

struct Gfx {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    nearest: wgpu::Sampler,
    linear: wgpu::Sampler,
    quads: Vec<Quad>,
}

struct App {
    capture: Capture,
    scale: u32,
    smooth: bool,
    frame: usize,
    tops: Vec<Picture>,
    bottoms: Vec<Picture>,
    status: String,
    gfx: Option<Gfx>,
}

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
    o.uv = c;
    return o;
}
@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
    return textureSample(img, samp, in.uv);
}
"#;

impl App {
    fn replay(&mut self) {
        let start = Instant::now();
        match crate::replay(&self.capture, self.scale) {
            Ok(r) => {
                let scale = self.scale as usize;
                self.tops.clear();
                self.bottoms.clear();
                for image in r.images {
                    let (w, h) = (image.width, image.height);
                    let picture = Picture { width: w, height: h, rgba: image.rgba };
                    if image.top && w == 400 * scale {
                        self.tops.push(picture);
                    } else if !image.top && w == 320 * scale {
                        self.bottoms.push(picture);
                    }
                }
                self.frame = self.tops.len().max(self.bottoms.len()).saturating_sub(1);
                self.status = format!("échelle {}  image {}  rejeu {:.0} ms  {}", self.scale, self.frame + 1, 1000.0 * start.elapsed().as_secs_f64(), r.adapter);
            }
            Err(e) => self.status = format!("erreur : {e}"),
        }
        self.upload();
    }

    fn pictures(&self) -> [Option<&Picture>; 2] {
        fn pick(v: &[Picture], frame: usize) -> Option<&Picture> {
            v.get(frame.min(v.len().saturating_sub(1)))
        }
        [pick(&self.tops, self.frame), pick(&self.bottoms, self.frame)]
    }

    fn upload(&mut self) {
        let pictures: Vec<Option<(usize, usize, Vec<u8>)>> =
            self.pictures().iter().map(|p| p.map(|p| (p.width, p.height, p.rgba.clone()))).collect();
        let Some(g) = self.gfx.as_mut() else { return };
        g.quads.clear();
        for picture in pictures {
            let Some((w, h, rgba)) = picture else { continue };
            let texture = g.device.create_texture_with_data(
                &g.queue,
                &wgpu::TextureDescriptor {
                    label: Some("écran"),
                    size: wgpu::Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                },
                wgpu::util::TextureDataOrder::LayerMajor,
                &rgba,
            );
            let view = texture.create_view(&Default::default());
            let uniform = g.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("rectangle"),
                size: 16,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let sampler = if self.smooth { &g.linear } else { &g.nearest };
            let bind = g.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("écran"),
                layout: &g.layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
                ],
            });
            g.quads.push(Quad { uniform, bind });
        }
        g.window.set_title(&format!("Pokémon X, portage PC : {}", self.status));
        g.window.request_redraw();
    }

    fn draw(&mut self) {
        let Some(g) = self.gfx.as_mut() else { return };
        let (ww, wh) = (g.config.width as f32, g.config.height as f32);
        let f = (ww / 400.0).min(wh / 480.0);
        let (ox, oy) = ((ww - 400.0 * f) / 2.0, (wh - 480.0 * f) / 2.0);
        // le haut occupe les 240 premières lignes, le bas est centré en dessous
        let rects = [(0.0, 0.0, 400.0, 240.0), (40.0, 240.0, 360.0, 480.0)];
        for (quad, r) in g.quads.iter().zip(rects) {
            let px = |x: f32| (ox + x * f) / ww * 2.0 - 1.0;
            let py = |y: f32| 1.0 - (oy + y * f) / wh * 2.0;
            let data = [px(r.0), py(r.1), px(r.2), py(r.3)];
            g.queue.write_buffer(&quad.uniform, 0, bytemuck::cast_slice(&data));
        }
        let frame = match g.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                g.surface.configure(&g.device, &g.config);
                return;
            }
            _ => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = g.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("fenêtre"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.02, g: 0.02, b: 0.03, a: 1.0 }), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&g.pipeline);
            for quad in &g.quads {
                pass.set_bind_group(0, &quad.bind, &[]);
                pass.draw(0..4, 0..1);
            }
        }
        g.queue.submit(Some(encoder.finish()));
        frame.present();
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gfx.is_some() {
            return;
        }
        let window = Arc::new(
            event_loop
                .create_window(Window::default_attributes().with_title("Pokémon X, portage PC").with_inner_size(LogicalSize::new(800.0, 960.0)))
                .expect("fenêtre"),
        );
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::VULKAN, ..wgpu::InstanceDescriptor::new_without_display_handle() });
        let surface = instance.create_surface(window.clone()).expect("surface");
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .expect("adaptateur");
        let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).expect("device");
        let size = window.inner_size();
        let mut config = surface.get_default_config(&adapter, size.width.max(1), size.height.max(1)).expect("configuration");
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&device, &config);
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
        self.gfx = Some(Gfx { window, surface, config, device, queue, pipeline, layout, nearest, linear, quads: Vec::new() });
        self.replay();
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(g) = self.gfx.as_mut() {
                    g.config.width = size.width.max(1);
                    g.config.height = size.height.max(1);
                    g.surface.configure(&g.device, &g.config);
                    g.window.request_redraw();
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
                        self.upload();
                    }
                    PhysicalKey::Code(KeyCode::ArrowLeft) if frames > 0 => {
                        self.frame = (self.frame + frames - 1) % frames;
                        self.status = format!("échelle {}  image {}/{}", self.scale, self.frame + 1, frames);
                        self.upload();
                    }
                    PhysicalKey::Code(KeyCode::KeyL) => {
                        self.smooth = !self.smooth;
                        self.upload();
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
    let mut app = App { capture, scale: scale.clamp(1, 4), smooth: false, frame: 0, tops: Vec::new(), bottoms: Vec::new(), status: String::new(), gfx: None };
    event_loop.run_app(&mut app).map_err(|e| e.to_string())
}
