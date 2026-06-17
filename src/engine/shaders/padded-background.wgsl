@group(0) @binding(0) var<uniform> u: PaddedBgUniform;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var wallpaper: texture_2d<f32>;
@group(0) @binding(4) var wallpaperSampler: sampler;

struct PaddedBgUniform {
	insetL: f32,
	insetT: f32,
	insetR: f32,
	insetB: f32,
	cornerRadius: f32,
	shadowOpacity: f32,
	shadowOffsetYN: f32,
	bgKind: u32,
	solidColor: vec4<f32>,
	gradAngleCos: f32,
	gradAngleSin: f32,
	gradStopCount: u32,
	_pad: u32,
	gradStops: array<vec4<f32>, 5>,
}

fn sdfRoundedRect(p: vec2f, centre: vec2f, halfExtent: vec2f, radius: f32) -> f32 {
	let q = abs(p - centre) - halfExtent + vec2f(radius);
	return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

fn backgroundColour(uv: vec2f) -> vec4f {
	if (u.bgKind == 0u) {
		return u.solidColor;
	}
	if (u.bgKind == 2u) {
		return textureSampleLevel(wallpaper, wallpaperSampler, uv, 0.0);
	}

	let centre = vec2f(0.5);
	let dir = vec2f(u.gradAngleCos, u.gradAngleSin);
	let t = clamp(dot(uv - centre, dir) + 0.5, 0.0, 1.0);
	var colour = u.gradStops[0].xyzw;
	for (var i = 0u; i + 1u < u.gradStopCount; i++) {
		let s0 = u.gradStops[i];
		let s1 = u.gradStops[i + 1u];
		if (t >= s0.w && t <= s1.w) {
			let localT = (t - s0.w) / max(s1.w - s0.w, 1e-6);
			colour = mix(s0, s1, localT);
			break;
		}
	}
	return colour;
}

fn sampleInsetSource(uv: vec2f, dims: vec2u) -> vec4f {
	let innerSize = vec2f(max(1e-6, 1.0 - u.insetL - u.insetR), max(1e-6, 1.0 - u.insetT - u.insetB));
	let local = clamp((uv - vec2f(u.insetL, u.insetT)) / innerSize, vec2f(0.0), vec2f(1.0));
	let coord = min(vec2u(local * vec2f(dims)), dims - vec2u(1u, 1u));
	return textureLoad(src, coord, 0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(dims);
	let insetCentre = vec2f(
		(u.insetL + (1.0 - u.insetR)) * 0.5,
		(u.insetT + (1.0 - u.insetB)) * 0.5
	);
	let insetHalf = vec2f(
		(1.0 - u.insetR - u.insetL) * 0.5,
		(1.0 - u.insetB - u.insetT) * 0.5
	);

	var colour = backgroundColour(uv).rgb;
	let shadowCentre = insetCentre + vec2f(0.0, u.shadowOffsetYN);
	let shadowSdf = sdfRoundedRect(uv, shadowCentre, insetHalf, u.cornerRadius);
	let shadowFeather = max(1.0 / f32(dims.y), abs(u.shadowOffsetYN) + 0.02);
	let shadow = (1.0 - smoothstep(0.0, shadowFeather, shadowSdf)) * u.shadowOpacity;
	colour = mix(colour, vec3f(0.0), clamp(shadow, 0.0, 1.0));

	let sdf = sdfRoundedRect(uv, insetCentre, insetHalf, u.cornerRadius);
	let aa = 1.0 / f32(dims.y);
	if (sdf < aa) {
		let srcColour = sampleInsetSource(uv, dims);
		let inside = 1.0 - smoothstep(0.0, aa, sdf);
		let blended = srcColour.rgb * srcColour.a + colour * (1.0 - srcColour.a);
		colour = mix(colour, blended, inside);
	}

	textureStore(dst, gid.xy, vec4f(colour, 1.0));
}
