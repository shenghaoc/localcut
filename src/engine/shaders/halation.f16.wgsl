enable f16;

@group(0) @binding(0) var<uniform> u: HalationUniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

struct HalationUniforms {
	threshold: f32,
	radius: i32,
	tintR: f32,
	tintG: f32,
	tintB: f32,
	_pad0: f32,
	_pad1: f32,
	_pad2: f32,
}

fn luminance(c: vec3f) -> f32 {
	return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let colour = textureLoad(src, gid.xy, 0);
	let lum = f16(luminance(colour.rgb));

	if (lum <= f16(u.threshold)) {
		textureStore(dst, gid.xy, colour);
		return;
	}

	let bright = f16(colour.rgb) * smoothstep(f16(u.threshold), f16(1.0), lum);
	let tint = vec3<f16>(f16(u.tintR), f16(u.tintG), f16(u.tintB));
	let glow = bright * tint;

	textureStore(dst, gid.xy, vec4f(vec3f(f16(1.0) - (f16(1.0) - f16(colour.rgb)) * (f16(1.0) - glow)), colour.a));
}
