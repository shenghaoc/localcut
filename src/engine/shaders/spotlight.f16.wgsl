enable f16;

@group(0) @binding(0) var<uniform> u: SpotlightUniform;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;

struct SpotlightUniform {
	cx: f32,
	cy: f32,
	rx: f32,
	ry: f32,
	darkenStrength: f32,
	_pad: f32,
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let colour = textureLoad(src, gid.xy, 0);
	let uv = vec2f(gid.xy) / vec2f(dims);

	let dx = (f16(uv.x) - f16(u.cx)) / max(f16(u.rx), f16(1e-5));
	let dy = (f16(uv.y) - f16(u.cy)) / max(f16(u.ry), f16(1e-5));
	let d = dx * dx + dy * dy;

	let factor = select(f16(1.0) - f16(u.darkenStrength), f16(1.0), d <= f16(1.0));
	let darkened = f16(colour.rgb) * factor;

	textureStore(dst, gid.xy, vec4f(vec3f(darkened), colour.a));
}
