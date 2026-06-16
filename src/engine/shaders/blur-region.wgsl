@group(0) @binding(0) var<uniform> u: BlurRegionUniform;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var tmp: texture_storage_2d<rgba8unorm, read_write>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba8unorm, write>;

struct BlurRegionUniform {
	rx: f32,
	ry: f32,
	rw: f32,
	rh: f32,
	radius: f32,
	_pad: vec3<f32>,
}

fn inRect(uv: vec2f) -> bool {
	return uv.x >= u.rx && uv.x <= u.rx + u.rw &&
	       uv.y >= u.ry && uv.y <= u.ry + u.rh;
}

fn gaussianWeight(offset: f32, sigma: f32) -> f32 {
	return exp(-0.5 * (offset * offset) / (sigma * sigma));
}

@compute @workgroup_size(8, 8, 1)
fn horizontal_pass(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let uv = vec2f(gid.xy) / vec2f(dims);

	if (!inRect(uv)) {
		// Outside rect: copy unchanged
		textureStore(tmp, gid.xy, textureLoad(src, gid.xy, 0));
		return;
	}

	let sigma = u.radius / 2.0;
	let radiusI = i32(ceil(u.radius));
	var sum = vec4f(0.0);
	var wSum = 0.0;

	for (var i = -radiusI; i <= radiusI; i++) {
		let sx = clamp(i32(gid.x) + i, 0, i32(dims.x) - 1);
		let w = gaussianWeight(f32(i), sigma);
		sum += textureLoad(src, vec2u(u32(sx), gid.y), 0) * w;
		wSum += w;
	}

	textureStore(tmp, gid.xy, sum / wSum);
}

@compute @workgroup_size(8, 8, 1)
fn vertical_pass(@builtin(global_invocation_id) gid: vec3u) {
	let dims = textureDimensions(src);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let uv = vec2f(gid.xy) / vec2f(dims);

	if (!inRect(uv)) {
		// Outside rect: copy from original source
		textureStore(dst, gid.xy, textureLoad(src, gid.xy, 0));
		return;
	}

	let sigma = u.radius / 2.0;
	let radiusI = i32(ceil(u.radius));
	var sum = vec4f(0.0);
	var wSum = 0.0;

	for (var i = -radiusI; i <= radiusI; i++) {
		let sy = clamp(i32(gid.y) + i, 0, i32(dims.y) - 1);
		let w = gaussianWeight(f32(i), sigma);
		sum += textureLoad(tmp, vec2u(gid.x, u32(sy)), 0) * w;
		wSum += w;
	}

	textureStore(dst, gid.xy, sum / wSum);
}
