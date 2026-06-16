@group(0) @binding(0) var<uniform> u: PaddedBgUniform;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var shadowTex: texture_2d<f32>;
@group(0) @binding(3) var wallpaperTex: texture_2d<f32>;
@group(0) @binding(4) var dst: texture_storage_2d<rgba8unorm, write>;

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

// SDF rounded-rect: distance from point to rounded rectangle
fn sdfRoundedRect(p: vec2f, centre: vec2f, halfExtent: vec2f, radius: f32) -> f32 {
	let q = abs(p - centre) - halfExtent + vec2f(radius);
	return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let px = vec2f(gid.xy);
	let uv = px / vec2f(dims);

	// 1. Background
	var bg = vec4f(0.0);
	if (u.bgKind == 0u) {
		bg = u.solidColor;
	} else if (u.bgKind == 1u) {
		// Gradient: project position onto gradient axis
		let centre = vec2f(0.5);
		let dir = vec2f(u.gradAngleCos, u.gradAngleSin);
		let proj = dot(uv - centre, dir) + 0.5;
		let t = clamp(proj, 0.0, 1.0);
		// Find the two gradient stops bracketing t
		bg = u.gradStops[0].xyzw; // default to first stop
		for (var i = 0u; i < u.gradStopCount - 1u; i++) {
			let s0 = u.gradStops[i];
			let s1 = u.gradStops[i + 1u];
			if (t >= s0.w && t <= s1.w) {
				let localT = (t - s0.w) / max(s1.w - s0.w, 1e-6);
				bg = mix(s0, s1, localT);
				break;
			}
		}
	} else if (u.bgKind == 2u) {
		bg = textureLoad(wallpaperTex, gid.xy, 0);
	}

	// 2. Shadow (pre-cached SDF shadow texture)
	let shadowSample = textureLoad(shadowTex, gid.xy, 0);
	let shadowAlpha = shadowSample.r * u.shadowOpacity;
	// Shadow is offset downward
	let shadowGid = vec2i(gid.xy) + vec2i(0, i32(u.shadowOffsetYN * f32(dims.y)));
	let inBounds = shadowGid.x >= 0 && shadowGid.x < i32(dims.x) &&
	               shadowGid.y >= 0 && shadowGid.y < i32(dims.y);
	let shadowVal = select(0.0, textureLoad(shadowTex, vec2u(shadowGid), 0).r * u.shadowOpacity, inBounds);

	// Composite shadow over background (premultiplied)
	var colour = bg.rgb;
	let shadowDark = vec3f(0.0);
	colour = mix(colour, shadowDark, shadowVal);

	// 3. Clip mask (SDF rounded-rect for inset region)
	let insetCentre = vec2f(
		(u.insetL + (1.0 - u.insetR)) * 0.5,
		(u.insetT + (1.0 - u.insetB)) * 0.5
	);
	let insetHalf = vec2f(
		(1.0 - u.insetR - u.insetL) * 0.5,
		(1.0 - u.insetB - u.insetT) * 0.5
	);
	let sdf = sdfRoundedRect(uv, insetCentre, insetHalf, u.cornerRadius);

	if (sdf < 0.0) {
		// Inside: sample source frame
		let srcColour = textureLoad(src, gid.xy, 0);
		// Straight-alpha composite
		colour = srcColour.rgb * srcColour.a + colour * (1.0 - srcColour.a);
	} else if (sdf < 1.0 / f32(dims.y)) {
		// Boundary: anti-alias via smoothstep
		let aa = smoothstep(0.0, 1.0 / f32(dims.y), sdf);
		let srcColour = textureLoad(src, gid.xy, 0);
		let blended = srcColour.rgb * srcColour.a + colour * (1.0 - srcColour.a);
		colour = mix(blended, colour, aa);
	}
	// else: outside, keep background+shadow

	textureStore(dst, gid.xy, vec4f(colour, 1.0));
}
