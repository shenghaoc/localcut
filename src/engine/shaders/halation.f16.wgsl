enable f16;

@group(0) @binding(0) var<uniform> u: HalationUniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

struct HalationUniforms {
	threshold: f32,
	radius: f32,
	tintR: f32,
	tintG: f32,
	tintB: f32,
	_pad0: f32,
	_pad1: f32,
	_pad2: f32,
}

fn brightPass(rgb: vec3<f16>, threshold: f16) -> vec3<f16> {
	let lum = dot(rgb, vec3<f16>(0.2126, 0.7152, 0.0722));
	return rgb * smoothstep(threshold, f16(1.0), lum);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let colour = textureLoad(src, gid.xy, 0);
	let radius = max(u.radius, 1.0);
	let sigma2 = max(radius * radius * 0.5, 1.0);
	let maxXY = vec2i(i32(dims.x) - 1, i32(dims.y) - 1);
	let center = vec2i(gid.xy);
	let threshold16 = f16(u.threshold);

	var halo = brightPass(vec3<f16>(colour.rgb), threshold16);
	var totalWeight = f16(1.0);
	for (var i: u32 = 0u; i < 16u; i = i + 1u) {
		let t = (f32(i) + 0.5) / 16.0;
		let angle = f32(i) * 2.39996323;
		let r = radius * sqrt(t);
		let offset = vec2f(cos(angle), sin(angle)) * r;
		let coord = clamp(center + vec2i(round(offset)), vec2i(0), maxXY);
		let texel = textureLoad(src, coord, 0);
		let weight = f16(exp(-(r * r) / sigma2));
		halo += brightPass(vec3<f16>(texel.rgb), threshold16) * weight;
		totalWeight += weight;
	}
	halo = halo / totalWeight;

	let tint = vec3<f16>(f16(u.tintR), f16(u.tintG), f16(u.tintB));
	let glow = halo * tint;
	let blended = vec3<f16>(1.0) - (vec3<f16>(1.0) - vec3<f16>(colour.rgb)) * (vec3<f16>(1.0) - glow);
	textureStore(dst, gid.xy, vec4f(vec3f(blended), colour.a));
}
