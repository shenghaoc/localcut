enable f16;

@group(0) @binding(0) var<uniform> u: VignetteUniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;

struct VignetteUniforms {
	amount: f32,
	feather: f32,
	roundness: f32,
	_pad: f32,
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let colour = textureLoad(src, gid.xy, 0);
	let uv = (vec2f(gid.xy) / vec2f(dims)) * 2.0 - 1.0;
	let r = max(f16(u.roundness), f16(1e-5));
	let len = f16(pow(pow(abs(uv.x), f32(r)) + pow(abs(uv.y), f32(r)), 1.0 / f32(r)));
	let falloff = smoothstep(f16(1.0) - f16(u.feather), f16(1.0), len);
	let darkened = f16(colour.rgb) * (f16(1.0) - f16(u.amount) * falloff);

	textureStore(dst, gid.xy, vec4f(vec3f(darkened), colour.a));
}
