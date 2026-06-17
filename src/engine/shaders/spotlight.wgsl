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

	// Ellipse distance test
	let dx = (uv.x - u.cx) / max(u.rx, 1e-5);
	let dy = (uv.y - u.cy) / max(u.ry, 1e-5);
	let d = dx * dx + dy * dy;

	// Darken outside the ellipse
	let factor = select(1.0 - u.darkenStrength, 1.0, d <= 1.0);
	let darkened = colour.rgb * factor;

	textureStore(dst, gid.xy, vec4f(darkened, colour.a));
}
