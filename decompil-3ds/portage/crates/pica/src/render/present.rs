//! Les passes de service du rendu, toutes sur le GPU : réduction exacte d'un tampon à la définition d'origine,
//! agrandissement, construction de l'image d'un écran (transfert vers l'écran) ; la relecture groupée du GPU ; et les
//! transferts vers l'écran « paresseux », dont l'écriture en mémoire n'a lieu que si quelqu'un la lit.
//!
//! Pourquoi paresseux : le jeu écrit l'image d'un écran dans la mémoire (transfert vers l'écran), mais le portage la
//! présente directement depuis le tampon du GPU. Relire le GPU à chaque image coûte une attente complète de la file ;
//! on garde donc une copie de la source (sur le GPU) et on n'écrit la mémoire que quand une commande de gsp, un dessin
//! ou une texture la lit, la recouvre ou en dépend (`materialize`). Le résultat en mémoire est celui qu'aurait donné
//! l'écriture immédiate, octet pour octet.

use formats::ColorFormat;

use super::*;

const PASSES_WGSL: &str = r#"
struct Params { a: vec4<i32>, b: vec4<i32> }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> p: Params;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let q = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(q * 2.0 - 1.0, 0.0, 1.0);
}

fn bytes(t: vec4<f32>) -> vec4<u32> { return vec4<u32>(t * 255.0 + vec4<f32>(0.5)); }

// réduction d'un tampon de s x s fois sa taille : moyenne des points, arrondie comme `downscale` du processeur
@fragment fn fs_down(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let s = p.a.x;
    let base = vec2<i32>(pos.xy) * s;
    var sum = vec4<u32>(0u);
    for (var dy = 0; dy < s; dy++) {
        for (var dx = 0; dx < s; dx++) {
            sum += bytes(textureLoad(src, base + vec2<i32>(dx, dy), 0));
        }
    }
    let area = u32(s * s);
    return vec4<f32>((sum + vec4<u32>(area / 2u)) / area) / 255.0;
}

// un format de couleur passé par la mémoire (numérotation des transferts GX : 0 RGBA8, 1 RGB8, 2 RGB565, 3 RGB5A1, 4 RGBA4) :
// les mêmes troncatures que `encode_pixels` puis `decode_pixels` du processeur
fn through_format(b: vec4<u32>, fmt: u32) -> vec4<u32> {
    if fmt == 0u { return b; }
    if fmt == 1u { return vec4<u32>(b.xyz, 255u); }
    if fmt == 2u {
        let r = b.x >> 3u; let g = b.y >> 2u; let bl = b.z >> 3u;
        return vec4<u32>((r << 3u) | (r >> 2u), (g << 2u) | (g >> 4u), (bl << 3u) | (bl >> 2u), 255u);
    }
    if fmt == 3u {
        let r = b.x >> 3u; let g = b.y >> 3u; let bl = b.z >> 3u;
        return vec4<u32>((r << 3u) | (r >> 2u), (g << 3u) | (g >> 2u), (bl << 3u) | (bl >> 2u), (b.w >> 7u) * 255u);
    }
    let q = b >> vec4<u32>(4u);
    return (q << vec4<u32>(4u)) | q;
}

// la texture que devient un transfert vers l'écran de copie : retournement éventuel, puis le passage par le format de
// la source et par celui de la destination (a.x : retournement, a.y : format d'entrée, a.z : format de sortie, a.w : hauteur)
@fragment fn fs_xfer(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    var at = vec2<i32>(pos.xy);
    if p.a.x != 0 { at.y = p.a.w - 1 - at.y; }
    let b = bytes(textureLoad(src, at, 0));
    return vec4<f32>(through_format(through_format(b, u32(p.a.y)), u32(p.a.z))) / 255.0;
}

// agrandissement au plus proche
@fragment fn fs_up(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return textureLoad(src, vec2<i32>(pos.xy) / p.a.x, 0);
}

fn load_rgb(x: i32, y: i32) -> vec3<u32> {
    return bytes(textureLoad(src, vec2<i32>(x, y + p.a.x), 0)).xyz;
}
fn avg(a: vec3<u32>, b: vec3<u32>) -> vec3<u32> { return (a + b + vec3<u32>(1u)) >> vec3<u32>(1u); }

// la réduction du transfert vers l'écran (0 aucune, 1 en largeur, 2 dans les deux sens), moyennes arrondies vers le haut
fn reduced(r: i32, c: i32) -> vec3<u32> {
    let mode = p.a.y;
    if mode == 0 { return load_rgb(c, r); }
    if mode == 1 { return avg(load_rgb(2 * c, r), load_rgb(2 * c + 1, r)); }
    return avg(avg(load_rgb(2 * c, 2 * r), load_rgb(2 * c + 1, 2 * r)), avg(load_rgb(2 * c, 2 * r + 1), load_rgb(2 * c + 1, 2 * r + 1)));
}

// a.x : première ligne du tampon, a.y : réduction, a.z : retournement ; b.x, b.y : largeur et hauteur après découpe.
// L'écran est le tableau découpé (b.y lignes de b.x colonnes) tourné d'un quart de tour, comme `rotate_screen`.
// profondeur D24S8 -> octets de la mémoire vus comme RGBA8 (R : pochoir, G B A : profondeur sur 24 bits), à la taille native ;
// la profondeur est la moyenne des s x s points, le pochoir celui du point en haut à gauche (comme `flush_depth` du processeur)
@group(0) @binding(2) var stencil_src: texture_2d<u32>;
@fragment fn fs_depth(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let s = p.a.x;
    let base = vec2<i32>(pos.xy) * s;
    var sum = 0.0;
    for (var dy = 0; dy < s; dy++) {
        for (var dx = 0; dx < s; dx++) {
            sum += textureLoad(src, base + vec2<i32>(dx, dy), 0).x;
        }
    }
    let t = (sum / f32(s * s)) * 16777215.0 + 0.5;
    let q = u32(clamp(t, 0.0, 16777215.0));
    let st = textureLoad(stencil_src, base, 0).x;
    return vec4<f32>(f32(st), f32((q >> 16u) & 255u), f32((q >> 8u) & 255u), f32(q & 255u)) / 255.0;
}

@fragment fn fs_screen(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let x = i32(pos.x);
    let y = i32(pos.y);
    var r = x;
    let c = p.b.x - 1 - y;
    if p.a.z != 0 { r = p.b.y - 1 - r; }
    // à l'échelle 1, le passage par les formats de la source (b.z) et de la destination (b.w), comme par la mémoire
    let q = through_format(through_format(vec4<u32>(reduced(r, c), 255u), u32(p.b.z)), u32(p.b.w));
    return vec4<f32>(vec3<f32>(q.xyz) / 255.0, 1.0);
}
"#;

#[derive(Clone)]
pub(super) struct Passes {
    depth_layout: wgpu::BindGroupLayout,
    depth: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    down: wgpu::RenderPipeline,
    up: wgpu::RenderPipeline,
    screen: wgpu::RenderPipeline,
    xfer: wgpu::RenderPipeline,
}

/// Le numéro d'un format de couleur dans les transferts GX (celui des shaders de ce fichier).
fn gx_id(f: ColorFormat) -> i32 {
    match f {
        ColorFormat::Rgba8 => 0,
        ColorFormat::Rgb8 => 1,
        ColorFormat::Rgb565 => 2,
        ColorFormat::Rgb5a1 => 3,
        ColorFormat::Rgba4 => 4,
    }
}

/// Une lecture du GPU : la texture, sa taille, les octets par point et la face lue.
pub(super) struct ReadJob {
    pub texture: wgpu::Texture,
    pub width: usize,
    pub height: usize,
    pub bytes_per_texel: usize,
    pub aspect: wgpu::TextureAspect,
}

/// Un transfert vers l'écran dont l'écriture en mémoire est remise à plus tard.
pub(super) struct Pending {
    /// Copie de la source (à `scale` fois la taille, `native_h` lignes natives) au moment du transfert.
    snapshot: wgpu::Texture,
    native_w: usize,
    native_h: usize,
    fmt: ColorFormat,
    source: u32,
    destination: u32,
    in_dim: u32,
    out_dim: u32,
    flags: u32,
    /// La plage de mémoire que le transfert écrira.
    dest: (u32, usize),
    /// Le transfert est une copie fidèle (mêmes dimensions, sans réduction, en tuiles) : son résultat peut servir de
    /// texture sans passer par la mémoire. (format de sortie, largeur, hauteur, retournement)
    as_texture: Option<(ColorFormat, usize, usize, bool)>,
    /// Cette texture, construite à la demande : (texture, vue, identité).
    texture: Option<(wgpu::Texture, wgpu::TextureView, u64)>,
}

/// Ce que rend [`Renderer::present_transfer`].
pub struct Presented {
    pub width: usize,
    pub height: usize,
    /// L'image de l'écran sur le GPU (RGBA8, à la définition de l'échelle), si elle a été construite.
    pub texture: Option<wgpu::Texture>,
    /// Ses octets RGBA, si on les a demandés.
    pub rgba: Vec<u8>,
}

impl Renderer {
    fn passes(&mut self) -> Passes {
        if let Some(p) = &self.passes {
            return p.clone();
        }
        let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("passes"), source: wgpu::ShaderSource::Wgsl(PASSES_WGSL.into()) });
        let layout = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("passes"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
            ],
        });
        let pipeline_layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("passes"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let depth_layout = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("profondeur"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Uint,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let depth_pipeline_layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("profondeur"), bind_group_layouts: &[Some(&depth_layout)], immediate_size: 0 });
        let depth = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("fs_depth"),
            layout: Some(&depth_pipeline_layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_depth"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend: None, write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let make = |entry: &str| {
            self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format: COLOR_FORMAT, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let passes = Passes { depth_layout, depth, down: make("fs_down"), up: make("fs_up"), screen: make("fs_screen"), xfer: make("fs_xfer"), layout };
        self.passes = Some(passes.clone());
        passes
    }

    fn color_target(&self, width: usize, height: usize, label: &str) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    /// Un dessin plein écran de `pipeline` qui lit `source` et écrit `target`.
    fn fullscreen_pass(&mut self, pipeline: &wgpu::RenderPipeline, layout: &wgpu::BindGroupLayout, source: &wgpu::Texture, params: [i32; 8], target: &wgpu::Texture) {
        let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("paramètres"),
            contents: bytemuck::cast_slice(&params),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("passe"),
            layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&source_view) },
                wgpu::BindGroupEntry { binding: 1, resource: uniform.as_entire_binding() },
            ],
        });
        let encoder = self.encoder();
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("passe"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &target_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Convertit le tampon de profondeur D24S8 en octets de mémoire (RGBA8 natif) si la conversion n'est pas à jour ;
    /// rend la vue et l'identité de la texture.
    pub(super) fn convert_depth(&mut self, index: usize) -> (wgpu::TextureView, u64) {
        let (width, height, version) = {
            let d = &self.depth_surfaces[index];
            (d.width, d.height, d.version)
        };
        if self.depth_surfaces[index].converted.is_none() {
            let texture = self.color_target(width, height, "profondeur convertie");
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let id = self.next_id;
            self.next_id += 1;
            self.depth_surfaces[index].converted = Some(Converted { texture, view, id, built: 0 });
        }
        let (built, id, view) = {
            let c = self.depth_surfaces[index].converted.as_ref().unwrap();
            (c.built, c.id, c.view.clone())
        };
        if built != version {
            let passes = self.passes();
            let (depth_texture, target) = {
                let d = &self.depth_surfaces[index];
                (d.texture.clone(), d.converted.as_ref().unwrap().texture.clone())
            };
            let depth_view = depth_texture.create_view(&wgpu::TextureViewDescriptor { aspect: wgpu::TextureAspect::DepthOnly, ..Default::default() });
            let stencil_view = depth_texture.create_view(&wgpu::TextureViewDescriptor { aspect: wgpu::TextureAspect::StencilOnly, ..Default::default() });
            let params: [i32; 8] = [self.scale as i32, 0, 0, 0, 0, 0, 0, 0];
            let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("paramètres"),
                contents: bytemuck::cast_slice(&params),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("conversion"),
                layout: &passes.depth_layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&depth_view) },
                    wgpu::BindGroupEntry { binding: 1, resource: uniform.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&stencil_view) },
                ],
            });
            let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
            let encoder = self.encoder();
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("conversion de la profondeur"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&passes.depth);
            pass.set_bind_group(0, &bind, &[]);
            pass.draw(0..3, 0..1);
            drop(pass);
            self.depth_surfaces[index].converted.as_mut().unwrap().built = version;
            self.stats.depth_conversions += 1;
        }
        (view, id)
    }

    /// Une texture à `scale` fois la taille native -> la même à la taille native (moyenne exacte des points).
    pub(super) fn downscale_texture(&mut self, big: &wgpu::Texture, width: usize, height: usize) -> wgpu::Texture {
        if self.scale == 1 {
            return big.clone();
        }
        let passes = self.passes();
        let native = self.color_target(width, height, "réduction");
        self.fullscreen_pass(&passes.down, &passes.layout, big, [self.scale as i32, 0, 0, 0, 0, 0, 0, 0], &native);
        native
    }

    /// Rend à `scale` fois leur taille des points natifs (RGBA8) : envoyés au GPU puis agrandis au plus proche.
    pub(super) fn upload_scaled(&mut self, pixels: &[u8], width: usize, height: usize) -> wgpu::Texture {
        let native = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some("tampon de couleur (natif)"),
                size: wgpu::Extent3d { width: width as u32, height: height as u32, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: COLOR_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::LayerMajor,
            pixels,
        );
        if self.scale == 1 {
            return native;
        }
        let passes = self.passes();
        let s = self.scale as usize;
        let big = self.color_target(width * s, height * s, "tampon de couleur");
        self.fullscreen_pass(&passes.up, &passes.layout, &native, [self.scale as i32, 0, 0, 0, 0, 0, 0, 0], &big);
        big
    }

    // --- la relecture groupée ---

    fn staging_buffer(&mut self, size: u64) -> wgpu::Buffer {
        if let Some(list) = self.readback_pool.get_mut(&size) {
            if let Some(b) = list.pop() {
                return b;
            }
        }
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("relecture"),
            size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        })
    }

    /// Lit plusieurs textures d'un seul envoi et d'une seule attente.
    pub(super) fn read_batch(&mut self, jobs: Vec<ReadJob>) -> Vec<Vec<u8>> {
        if jobs.is_empty() {
            return Vec::new();
        }
        let mut buffers = Vec::new();
        for job in &jobs {
            let row = align(job.width * job.bytes_per_texel, 256);
            let size = (row * job.height) as u64;
            let buffer = self.staging_buffer(size);
            let encoder = self.encoder();
            encoder.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo { texture: &job.texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: job.aspect },
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row as u32), rows_per_image: Some(job.height as u32) },
                },
                wgpu::Extent3d { width: job.width as u32, height: job.height as u32, depth_or_array_layers: 1 },
            );
            buffers.push((buffer, row, size));
        }
        self.submit();
        let t0 = self.now();
        for (buffer, _, _) in &buffers {
            buffer.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("relecture du GPU"));
        }
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        let mut out = Vec::new();
        for (job, (buffer, row, size)) in jobs.iter().zip(buffers) {
            let slice = buffer.slice(..);
            let data = slice.get_mapped_range();
            let line = job.width * job.bytes_per_texel;
            let mut bytes = Vec::with_capacity(line * job.height);
            for y in 0..job.height {
                bytes.extend_from_slice(&data[y * row..y * row + line]);
            }
            drop(data);
            buffer.unmap();
            self.readback_pool.entry(size).or_default().push(buffer);
            out.push(bytes);
        }
        self.tick("relecture", t0);
        out
    }

    /// Les points natifs (RGBA8) de textures de couleur à `scale` fois la taille : réduits sur le GPU puis lus d'un coup.
    pub(super) fn read_native_colors(&mut self, textures: &[(wgpu::Texture, usize, usize)]) -> Vec<Vec<u8>> {
        let mut jobs = Vec::new();
        for (texture, width, height) in textures {
            let native = self.downscale_texture(texture, *width, *height);
            jobs.push(ReadJob { texture: native, width: *width, height: *height, bytes_per_texel: 4, aspect: wgpu::TextureAspect::All });
        }
        self.read_batch(jobs)
    }

    // --- l'écriture en mémoire des tampons ---

    /// Rend à la mémoire les tampons de couleur désignés (dont la copie est sale), en un seul envoi.
    pub(super) fn flush_colors(&mut self, indices: &[usize], memory: &mut Memory) {
        let mut list = Vec::new();
        for &i in indices {
            let s = &self.color_surfaces[i];
            if s.dirty && s.valid {
                list.push(i);
            }
        }
        if list.is_empty() {
            return;
        }
        let textures: Vec<(wgpu::Texture, usize, usize)> = list
            .iter()
            .map(|&i| {
                self.color_surfaces[i].dirty = false;
                let s = &self.color_surfaces[i];
                (s.texture.clone(), s.width, s.height)
            })
            .collect();
        self.stats.flushes += list.len() as u64;
        let natives = self.read_native_colors(&textures);
        for (&i, native) in list.iter().zip(natives) {
            let (width, height, fmt, address) = {
                let s = &self.color_surfaces[i];
                (s.width, s.height, s.fmt, s.address)
            };
            let data = formats::linear_to_tiled(&formats::encode_pixels(fmt, &native), width, height, fmt.bytes_per_pixel());
            self.materialize_overlapping(memory, address, data.len());
            if !memory.write(address, &data) {
                self.note("écriture d'un tampon refusée");
            }
        }
    }

    /// Idem pour les tampons de profondeur (et de pochoir).
    pub(super) fn flush_depths(&mut self, indices: &[usize], memory: &mut Memory) {
        let mut list = Vec::new();
        for &i in indices {
            let s = &self.depth_surfaces[i];
            if s.dirty && s.valid {
                list.push(i);
            }
        }
        if list.is_empty() {
            return;
        }
        let s = self.scale as usize;
        let mut jobs = Vec::new();
        for &i in &list {
            self.depth_surfaces[i].dirty = false;
            let surface = &self.depth_surfaces[i];
            jobs.push(ReadJob { texture: surface.texture.clone(), width: surface.width * s, height: surface.height * s, bytes_per_texel: 4, aspect: wgpu::TextureAspect::DepthOnly });
            if surface.format == DEPTH_STENCIL_FORMAT {
                jobs.push(ReadJob { texture: surface.texture.clone(), width: surface.width * s, height: surface.height * s, bytes_per_texel: 1, aspect: wgpu::TextureAspect::StencilOnly });
            }
        }
        self.stats.flushes += list.len() as u64;
        let mut results = self.read_batch(jobs).into_iter();
        for &i in &list {
            let (width, height, fmt, address, with_stencil) = {
                let surface = &self.depth_surfaces[i];
                (surface.width, surface.height, surface.fmt, surface.address, surface.format == DEPTH_STENCIL_FORMAT)
            };
            let raw = results.next().expect("profondeur lue");
            if with_stencil {
                let st = results.next().expect("pochoir lu");
                // le pochoir prend le point en haut à gauche de chaque bloc de l'échelle
                for y in 0..height {
                    for x in 0..width {
                        self.depth_surfaces[i].stencil[y * width + x] = st[(y * s) * width * s + x * s];
                    }
                }
            }
            let floats: &[f32] = bytemuck::cast_slice(&raw);
            let unit = depth_unit(fmt);
            let scale = if fmt == 0 { 65535.0 } else { 16_777_215.0 };
            let mut planes = vec![0u8; width * height * unit];
            for y in 0..height {
                for x in 0..width {
                    let mut sum = 0.0f32;
                    for dy in 0..s {
                        for dx in 0..s {
                            sum += floats[(y * s + dy) * width * s + x * s + dx];
                        }
                    }
                    let z = ((sum / (s * s) as f32) * scale + 0.5).clamp(0.0, scale) as u32;
                    let mut v = z;
                    if fmt == 3 {
                        v |= (self.depth_surfaces[i].stencil[y * width + x] as u32) << 24;
                    }
                    for k in 0..unit {
                        planes[(y * width + x) * unit + k] = (v >> (8 * k)) as u8;
                    }
                }
            }
            let data = formats::linear_to_tiled(&planes, width, height, unit);
            self.materialize_overlapping(memory, address, data.len());
            if !memory.write(address, &data) {
                self.note("écriture d'un tampon de profondeur refusée");
            }
        }
    }

    // --- les transferts vers l'écran ---

    /// Le tampon de couleur dont l'image sert un transfert (même largeur, adresse en début de ligne de tuiles) et la
    /// première ligne native à lire.
    fn transfer_source(&self, source: u32, width: usize) -> Option<(usize, usize)> {
        let i = self.color_surfaces.iter().position(|s| {
            let row_bytes = s.width.div_ceil(8) * 64 * s.fmt.bytes_per_pixel();
            let end = s.address as usize + s.height.div_ceil(8) * row_bytes;
            s.width == width && source >= s.address && (source as usize) < end && (source - s.address) as usize % row_bytes == 0
        })?;
        let s = &self.color_surfaces[i];
        let skip = ((source - s.address) as usize / (s.width.div_ceil(8) * 64 * s.fmt.bytes_per_pixel())) * 8;
        (skip < s.height).then_some((i, skip))
    }

    /// Un transfert vers l'écran fait sur le GPU : construit l'image de l'écran et remet à plus tard l'écriture en
    /// mémoire. `None` si le cas n'est pas couvert (le moteur passe alors par la mémoire, comme avant).
    pub fn present_transfer(&mut self, memory: &mut Memory, source: u32, destination: u32, in_dim: u32, out_dim: u32, flags: u32, want_pixels: bool) -> Option<Presented> {
        let (in_w, in_h) = ((in_dim & 0xFFFF) as usize, (in_dim >> 16) as usize);
        let (rows, cols) = ((out_dim >> 16) as usize, (out_dim & 0xFFFF) as usize);
        if in_w == 0 || in_h == 0 || rows == 0 || cols == 0 {
            return None;
        }
        let (index, skip) = self.transfer_source(source, in_w)?;
        let (surface_fmt, surface_h, valid) = {
            let s = &self.color_surfaces[index];
            (s.fmt, s.height, s.valid)
        };
        let available = surface_h - skip;
        let scaling = match (flags >> 24) & 3 {
            0 => 0,
            2 => 2,
            _ => 1,
        };
        // les lignes d'entrée dont dépend l'écran (le reste du tampon d'entrée est rogné par la découpe)
        let needed = (rows * if scaling == 2 { 2 } else { 1 }).min(in_h);
        let in_fmt = ColorFormat::from_gx((flags >> 8) & 7);
        let out_fmt = ColorFormat::from_gx((flags >> 12) & 7);
        let raw_copy = (flags >> 3) & 1 != 0;
        let (source_len, dest_len) = {
            let (r, w) = crate::transfer::display_ranges(source, destination, in_dim, out_dim, flags);
            (r.1, w.1)
        };
        let lossless = matches!(surface_fmt, ColorFormat::Rgba8 | ColorFormat::Rgb8) && in_fmt == Some(surface_fmt) && matches!(out_fmt, Some(ColorFormat::Rgba8 | ColorFormat::Rgb8));
        // à l'échelle 1, l'image doit être celle que donnerait la mémoire : sans perte par les formats, ou passée par eux
        // (la réduction moyenne avant le passage par le format de sortie : on ne la mêle pas aux formats avec perte)
        // (une sortie en tuiles n'est pas une image d'écran : la mémoire en donne une image brouillée que l'on garde telle quelle)
        let out_tiled = (flags >> 1) & 1 != 0;
        let image_ok = self.scale > 1 || (!out_tiled && (lossless || (scaling == 0 && in_fmt == Some(surface_fmt) && out_fmt.is_some())));
        let page = |start: u32, len: usize| (start & !0xFFF, (start as usize & 0xFFF) + len + 0xFFF & !0xFFF);
        let (source_page, dest_page) = (page(source, source_len), page(destination, dest_len));
        let pending_ok = valid
            && memory.read(destination, dest_len).is_some()
            && !overlaps(source_page.0, source_page.1, dest_page.0, dest_page.1)
            && needed <= available
            && !raw_copy
            && in_fmt == Some(surface_fmt)
            && out_fmt.is_some()
            && !overlaps(source, source_len, destination, dest_len)
            && !self.color_surfaces.iter().any(|s| overlaps(s.address, s.bytes(), destination, dest_len))
            && !self.depth_surfaces.iter().any(|s| overlaps(s.address, s.bytes(), destination, dest_len));
        if std::env::var_os("PORTAGE_TRACE").is_some() {
            eprintln!("présenter : source {source:x} {in_w}x{in_h} lignes dispo {available} valide {valid} lossless {lossless} image_ok {image_ok} pending_ok {pending_ok}");
        }
        if !pending_ok || !(image_ok || !want_pixels) {
            return None;
        }

        // une copie fidèle (même taille, sans réduction ni découpe, écrite en tuiles) peut servir de texture telle quelle
        let exact_copy = in_dim == out_dim && scaling == 0 && (flags >> 1) & 1 != 0 && needed == in_h;
        // la mémoire de destination : les transferts en attente qui la recouvrent sont écrits ou remplacés
        self.before_write(memory, destination, dest_len);
        let s = self.scale as usize;
        let snapshot = self.color_target(in_w * s, needed * s, "copie du transfert");
        {
            let texture = self.color_surfaces[index].texture.clone();
            self.encoder().copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d { x: 0, y: (skip * s) as u32, z: 0 }, aspect: wgpu::TextureAspect::All },
                snapshot.as_image_copy(),
                wgpu::Extent3d { width: (in_w * s) as u32, height: (needed * s) as u32, depth_or_array_layers: 1 },
            );
        }
        self.pending.push(Pending {
            snapshot: snapshot.clone(),
            native_w: in_w,
            native_h: needed,
            fmt: surface_fmt,
            source,
            destination,
            in_dim,
            out_dim,
            flags,
            dest: (destination, dest_len),
            as_texture: exact_copy.then(|| (out_fmt.unwrap_or(ColorFormat::Rgba8), cols, rows, flags & 1 != 0)),
            texture: None,
        });
        while self.pending.len() > 24 {
            // au-delà, on écrit le plus ancien : la mémoire des copies gardées reste bornée
            self.materialize(memory, 0);
        }
        self.stats.deferred += 1;

        if !image_ok {
            return Some(Presented { width: 0, height: 0, texture: None, rgba: Vec::new() });
        }
        // l'image : réduction, découpe, retournement et quart de tour, en un seul passage
        let (w, h) = match scaling {
            0 => (in_w * s, needed * s),
            1 => (in_w * s / 2, needed * s),
            _ => (in_w * s / 2, needed * s / 2),
        };
        let (cw, ch) = ((cols * s).min(w), (rows * s).min(h));
        let (width, height) = (ch, cw);
        let flip = (flags & 1) as i32;
        let passes = self.passes();
        let screen = self.color_target(width, height, "écran");
        let (in_id, out_id) = if s == 1 { (gx_id(surface_fmt), out_fmt.map(gx_id).unwrap_or(0)) } else { (0, 0) };
        self.fullscreen_pass(&passes.screen, &passes.layout, &snapshot, [0, scaling, flip, 0, cw as i32, ch as i32, in_id, out_id], &screen);
        let rgba = if want_pixels {
            let job = ReadJob { texture: screen.clone(), width, height, bytes_per_texel: 4, aspect: wgpu::TextureAspect::All };
            self.read_batch(vec![job]).pop().unwrap_or_default()
        } else {
            Vec::new()
        };
        Some(Presented { width, height, texture: Some(screen), rgba })
    }

    /// Le transfert en attente dont le résultat est exactement la texture demandée (adresse, format, dimensions), si
    /// ce résultat peut servir de texture : rend sa vue et son identité, après l'avoir construit.
    pub(super) fn pending_texture(&mut self, address: u32, fmt: ColorFormat, width: usize, height: usize) -> Option<(wgpu::TextureView, u64)> {
        let index = self.pending.iter().position(|p| p.dest.0 == address && matches!(p.as_texture, Some((f, w, h, _)) if (f, w, h) == (fmt, width, height)))?;
        if self.pending[index].texture.is_none() {
            let passes = self.passes();
            let s = self.scale as usize;
            let (snapshot, in_fmt, flip) = {
                let p = &self.pending[index];
                (p.snapshot.clone(), p.fmt, p.as_texture.map(|t| t.3).unwrap_or(false))
            };
            let target = self.color_target(width * s, height * s, "texture d'un transfert");
            let params = [flip as i32, gx_id(in_fmt), gx_id(fmt), (height * s) as i32, 0, 0, 0, 0];
            self.fullscreen_pass(&passes.xfer, &passes.layout, &snapshot, params, &target);
            let view = target.create_view(&wgpu::TextureViewDescriptor::default());
            let id = self.next_id;
            self.next_id += 1;
            self.pending[index].texture = Some((target, view, id));
        }
        let (_, view, id) = self.pending[index].texture.as_ref().unwrap();
        Some((view.clone(), *id))
    }

    /// Écrit en mémoire le transfert en attente numéro `index`, tel que l'aurait fait l'écriture immédiate.
    pub(super) fn materialize(&mut self, memory: &mut Memory, index: usize) {
        let p = self.pending.remove(index);
        self.stats.materialized += 1;
        let native = self.read_native_colors(&[(p.snapshot.clone(), p.native_w, p.native_h)]).pop().unwrap_or_default();
        let unit = p.fmt.bytes_per_pixel();
        let mut tiled = formats::linear_to_tiled(&formats::encode_pixels(p.fmt, &native), p.native_w, p.native_h, unit);
        // le transfert lit toute la hauteur d'entrée ; les lignes au-delà de celles de l'écran sont rognées (zéros ici)
        let (in_w, in_h) = ((p.in_dim & 0xFFFF) as usize, (p.in_dim >> 16) as usize);
        tiled.resize(in_w.div_ceil(8) * in_h.div_ceil(8) * 64 * unit, 0);
        // le transfert est rejoué sur une mémoire de travail : la source telle qu'elle était, la destination telle qu'elle est
        let mut scratch = Memory::default();
        scratch.map(p.source, &tiled);
        let current = memory.read(p.dest.0, p.dest.1).map(|c| c.into_owned()).unwrap_or_else(|| vec![0; p.dest.1]);
        scratch.map(p.destination, &current);
        if crate::transfer::display_transfer(&mut scratch, p.source, p.destination, p.in_dim, p.out_dim, p.flags).is_ok() {
            if let Some(result) = scratch.read(p.dest.0, p.dest.1) {
                if !memory.write(p.dest.0, &result) {
                    self.note("écriture d'un transfert refusée");
                }
            }
        }
    }

    /// Écrit en mémoire les transferts en attente qui recouvrent la plage.
    pub(super) fn materialize_overlapping(&mut self, memory: &mut Memory, start: u32, len: usize) {
        let mut i = 0;
        while i < self.pending.len() {
            let d = self.pending[i].dest;
            if overlaps(d.0, d.1, start, len) {
                self.materialize(memory, i);
            } else {
                i += 1;
            }
        }
    }

    /// Une commande va écraser la plage : les transferts en attente qu'elle recouvre entièrement sont inutiles, les
    /// autres sont écrits d'abord.
    pub(super) fn settle_pending_for_write(&mut self, memory: &mut Memory, start: u32, len: usize) {
        let mut i = 0;
        while i < self.pending.len() {
            let d = self.pending[i].dest;
            if !overlaps(d.0, d.1, start, len) {
                i += 1;
            } else if start <= d.0 && d.0 as u64 + d.1 as u64 <= start as u64 + len as u64 {
                self.pending.remove(i);
                self.stats.dropped += 1;
            } else {
                self.materialize(memory, i);
            }
        }
    }

    /// Envoie le travail au GPU et attend qu'il soit fini (sans rien écrire en mémoire).
    pub fn wait_idle(&mut self) {
        self.submit();
        let t = self.now();
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        self.tick("attente", t);
    }

    /// Écrit tous les transferts en attente.
    pub(super) fn materialize_all(&mut self, memory: &mut Memory) {
        while !self.pending.is_empty() {
            self.materialize(memory, 0);
        }
    }
}
