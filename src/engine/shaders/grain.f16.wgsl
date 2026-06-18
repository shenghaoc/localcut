enable f16;

@group(0) @binding(0) var<uniform> u: GrainUniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

struct GrainUniforms {
	strength: f32,
	size: f32,
	frameTimeSeed: f32,
	_pad: f32,
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let colour = textureLoad(src, gid.xy, 0);
	let p = vec2f(floor(vec2f(gid.xy) / f32(u.size)) + f32(u.frameTimeSeed));
	let noise = f16(fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453));
	let strength = f16(u.strength);
	let rgb16 = vec3<f16>(colour.rgb);
	let grained = rgb16 + vec3<f16>(noise - f16(0.5)) * strength;
	textureStore(dst, gid.xy, vec4f(vec3f(mix(rgb16, grained, vec3<f16>(strength))), colour.a));
}
