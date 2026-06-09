enable f16;

// Phase 13 transition-mix compute shader (f16 variant).
// Blends two premultiplied layers (outgoing + incoming) according to the active
// transition kind and mixT uniform. Intermediate arithmetic runs in f16.

struct TransitionUniforms {
    mixT: f32,
    kind: u32,
    direction: u32,
}

@group(0) @binding(0) var<uniform> uniforms : TransitionUniforms;
@group(0) @binding(1) var outgoingTexture : texture_2d<f32>;
@group(0) @binding(2) var incomingTexture : texture_2d<f32>;
@group(0) @binding(3) var outSampler : sampler;
@group(0) @binding(4) var inSampler : sampler;
@group(0) @binding(5) var dstTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let size = textureDimensions(dstTexture);
    if (gid.x >= size.x || gid.y >= size.y) {
        return;
    }

    let coord = vec2<i32>(gid.xy);
    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(size);

    let outColor = vec4<f16>(textureLoad(outgoingTexture, coord, 0));
    let inColor = vec4<f16>(textureLoad(incomingTexture, coord, 0));
    let t = f16(uniforms.mixT);

    var result: vec4<f16>;

    switch uniforms.kind {
        case 0u: {
            // cross-dissolve
            result = mix(outColor, inColor, t);
        }
        case 1u: {
            // dip-to-black: lerp to opaque black first, then from opaque black to incoming
            if (t < 0.5h) {
                result = mix(outColor, vec4<f16>(0.0h, 0.0h, 0.0h, 1.0h), t * 2.0h);
            } else {
                result = mix(vec4<f16>(0.0h, 0.0h, 0.0h, 1.0h), inColor, (t - 0.5h) * 2.0h);
            }
        }
        case 2u: {
            // wipe: 0=left, 1=right, 2=up, 3=down
            let isHorizontal = uniforms.direction <= 1u;
            let edge = isHorizontal ? f16(uv.x) : f16(uv.y);
            let flip = uniforms.direction == 1u || uniforms.direction == 3u;
            // smoothstep in f32 for precision, then narrow to f16 for the mix.
            // Remap t so the feather window stays entirely inside [0,1], preventing a
            // partial blend at the boundaries that would cause a visible pop/flash.
            let feather = 0.005;
            let adjustedT = f32(t) * (1.0 + 2.0 * feather) - feather;
            let visible = select(
                f16(1.0 - smoothstep(adjustedT - feather, adjustedT + feather, f32(edge))),
                f16(smoothstep(1.0 - adjustedT - feather, 1.0 - adjustedT + feather, f32(edge))),
                flip
            );
            result = mix(outColor, inColor, visible);
        }
        case 3u: {
            // slide: 0=left, 1=right, 2=up, 3=down
            let isHorizontal = uniforms.direction <= 1u;
            let slideT = 1.0h - t;
            var slideInUV = uv;
            var slideOutUV = uv;
            let signVal: f32 = (uniforms.direction == 1u || uniforms.direction == 3u) ? -1.0 : 1.0;
            if isHorizontal {
                slideInUV.x = uv.x + signVal * f32(slideT);
                slideOutUV.x = uv.x + signVal * f32(t) * -1.0;
            } else {
                slideInUV.y = uv.y + signVal * f32(slideT);
                slideOutUV.y = uv.y + signVal * f32(t) * -1.0;
            }
            let inSlide = vec4<f16>(textureSampleLevel(incomingTexture, inSampler, slideInUV, 0.0));
            let outSlide = vec4<f16>(textureSampleLevel(outgoingTexture, outSampler, slideOutUV, 0.0));
            let inBounds = slideInUV.x >= 0.0 && slideInUV.x <= 1.0 && slideInUV.y >= 0.0 && slideInUV.y <= 1.0;
            let outBounds = slideOutUV.x >= 0.0 && slideOutUV.x <= 1.0 && slideOutUV.y >= 0.0 && slideOutUV.y <= 1.0;
            let inWeight = select(0.0h, 1.0h, inBounds);
            let outWeight = select(0.0h, 1.0h, outBounds);
            result = outSlide * outWeight + inSlide * inWeight * (1.0h - outWeight);
        }
        default: {
            result = mix(outColor, inColor, t);
        }
    }

    textureStore(dstTexture, coord, vec4<f32>(result));
}
