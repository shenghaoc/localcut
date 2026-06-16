enable f16;

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

	var bg = vec4f16(0.0);
	if (u.bgKind == 0u) {
		bg = f16(u.solidColor);
	} else if (u.bgKind == 1u) {
		let centre = vec2f(0.5);
		let dir = vec2f(u.gradAngleCos, u.gradAngleSin);
		let proj = dot(uv - centre, dir) + 0.5;
		let t = f16(clamp(proj, 0.0, 1.0));
		bg = f16(u.gradStops[0]);
		for (var i = 0u; i < u.gradStopCount - 1u; i++) {
			let s0 = f16(u.gradStops[i]);
			let s1 = f16(u.gradStops[i + 1u]);
			if (t >= s0.w && t <= s1.w) {
				let localT = (t - s0.w) / max(s1.w - s0.w, f16(1e-6));
				bg = mix(s0, s1, localT);
				break;
			}
		}
	} else if (u.bgKind == 2u) {
		bg = f16(textureLoad(wallpaperTex, gid.xy, 0));
	}

	let shadowGid = vec2i(gid.xy) + vec2i(0, i32(u.shadowOffsetYN * f32(dims.y)));
	let inBounds = shadowGid.x >= 0 && shadowGid.x < i32(dims.x) &&
	               shadowGid.y >= 0 && shadowGid.y < i32(dims.y);
	let shadowVal = f16(select(0.0, textureLoad(shadowTex, vec2u(shadowGid), 0).r * u.shadowOpacity, inBounds));

	var colour = bg.rgb;
	colour = mix(colour, vec3f16(0.0), shadowVal);

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
		let srcColour = f16(textureLoad(src, gid.xy, 0));
		colour = srcColour.rgb * srcColour.a + colour * (f16(1.0) - srcColour.a);
	} else if (sdf < 1.0 / f32(dims.y)) {
		let aa = f16(smoothstep(0.0, 1.0 / f32(dims.y), sdf));
		let srcColour = f16(textureLoad(src, gid.xy, 0));
		let blended = srcColour.rgb * srcColour.a + colour * (f16(1.0) - srcColour.a);
		colour = mix(blended, colour, aa);
	}

	textureStore(dst, gid.xy, vec4f(vec3f(colour), 1.0));
}
