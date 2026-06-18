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

fn luminance(c: vec3f) -> f32 {
	return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn brightPass(rgb: vec3f, threshold: f32) -> vec3f {
	let lum = luminance(rgb);
	return rgb * smoothstep(threshold, 1.0, lum);
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

	var halo = brightPass(colour.rgb, u.threshold);
	var totalWeight = 1.0;
	for (var i: u32 = 0u; i < 16u; i = i + 1u) {
		let t = (f32(i) + 0.5) / 16.0;
		let angle = f32(i) * 2.39996323;
		let r = radius * sqrt(t);
		let offset = vec2f(cos(angle), sin(angle)) * r;
		let coord = clamp(center + vec2i(round(offset)), vec2i(0), maxXY);
		let texel = textureLoad(src, coord, 0);
		let weight = exp(-(r * r) / sigma2);
		halo += brightPass(texel.rgb, u.threshold) * weight;
		totalWeight += weight;
	}
	halo = halo / totalWeight;

	let tint = vec3f(u.tintR, u.tintG, u.tintB);
	let glow = halo * tint;
	textureStore(dst, gid.xy, vec4f(1.0 - (1.0 - colour.rgb) * (1.0 - glow), colour.a));
}
