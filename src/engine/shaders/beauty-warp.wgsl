// Phase 32b: Beauty mesh-warp compute shader.
//
// Performs inverse warp for jaw slim, eye enlarge, nose width, and mouth
// adjustments driven by face landmarks. Each feature has a conservative
// region with feathered falloff. Operates in clip-local normalized coords.
//
// Workgroup size: 8×8 (matches existing effect shaders).

@group(0) @binding(0) var inputTex : texture_2d<f32>;
@group(0) @binding(1) var outputTex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> landmarks : array<f32>;
@group(0) @binding(3) var<uniform> params : BeautyUniform;

struct BeautyUniform {
    masterStrength : f32,
    jawSlim : f32,
    eyeEnlarge : f32,
    noseWidth : f32,
    mouth : f32,
    topologyVersion : f32,
    featherFalloff : f32,
    pad : f32,
}

// Landmark indices for feature regions (MediaPipe FaceMesh topology).
// Jaw contour landmarks (chin to jawline).
const JAW_INDICES = array<u32, 16>(
    152u, 377u, 400u, 378u, 379u, 365u, 397u, 288u,
    361u, 323u, 454u, 356u, 389u, 251u, 284u, 332u
);

// Left eye center landmark.
const LEFT_EYE_CENTER = 159u;
// Right eye center landmark.
const RIGHT_EYE_CENTER = 386u;

// Nose tip landmark.
const NOSE_TIP = 1u;
// Nose left/right landmarks.
const NOSE_LEFT = 49u;
const NOSE_RIGHT = 279u;

// Upper lip center.
const UPPER_LIP = 13u;
// Lower lip center.
const LOWER_LIP = 14u;
// Lip left corner.
const LIP_LEFT = 61u;
// Lip right corner.
const LIP_RIGHT = 291u;

// Hermite smoothstep for feathered falloff.
fn smoothstep_h(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Get landmark position (2D) from storage buffer.
fn landmarkPos(index: u32) -> vec2<f32> {
    let base = index * 3u;
    return vec2<f32>(landmarks[base], landmarks[base + 1u]);
}

// Distance from point to line segment.
fn distToSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let ap = p - a;
    let t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    let proj = a + t * ab;
    return length(p - proj);
}

// Compute jaw slim displacement: symmetric inward displacement along
// the jaw contour with cheek feathering.
fn jawSlimDisplacement(pos: vec2<f32>, strength: f32) -> vec2<f32> {
    if (strength <= 0.0) {
        return vec2<f32>(0.0, 0.0);
    }

    // Find nearest jaw contour segment
    let centerX = 0.5;
    var minDist = 1e6;
    var nearestNormal = vec2<f32>(0.0, 0.0);

    for (var i = 0u; i < 15u; i++) {
        let a = landmarkPos(JAW_INDICES[i]);
        let b = landmarkPos(JAW_INDICES[i + 1u]);
        let d = distToSegment(pos, a, b);
        if (d < minDist) {
            minDist = d;
            // Normal pointing inward (toward center)
            let edge = normalize(b - a);
            let toCenter = vec2<f32>(centerX - (a.x + b.x) * 0.5, 0.0);
            nearestNormal = vec2<f32>(-edge.y, edge.x);
            if (dot(nearestNormal, toCenter) < 0.0) {
                nearestNormal = -nearestNormal;
            }
        }
    }

    // Feather: strong near jaw, fading outward
    let feather = params.featherFalloff;
    let falloff = 1.0 - smoothstep_h(0.0, feather, minDist);
    return nearestNormal * strength * falloff * 0.02;
}

// Compute eye enlarge displacement: small radial expansion around each eye.
fn eyeEnlargeDisplacement(pos: vec2<f32>, strength: f32) -> vec2<f32> {
    if (strength <= 0.0) {
        return vec2<f32>(0.0, 0.0);
    }

    let leftCenter = landmarkPos(LEFT_EYE_CENTER);
    let rightCenter = landmarkPos(RIGHT_EYE_CENTER);

    // Approximate eye radius from landmarks
    let leftRadius = length(landmarkPos(33u) - landmarkPos(133u)) * 0.5;
    let rightRadius = length(landmarkPos(362u) - landmarkPos(263u)) * 0.5;

    var disp = vec2<f32>(0.0, 0.0);

    // Left eye
    let dLeft = length(pos - leftCenter);
    if (dLeft < leftRadius * 1.5) {
        let falloff = 1.0 - smoothstep_h(0.0, leftRadius * 1.5, dLeft);
        let dir = normalize(pos - leftCenter + vec2<f32>(1e-8, 1e-8));
        disp += dir * strength * falloff * 0.005;
    }

    // Right eye
    let dRight = length(pos - rightCenter);
    if (dRight < rightRadius * 1.5) {
        let falloff = 1.0 - smoothstep_h(0.0, rightRadius * 1.5, dRight);
        let dir = normalize(pos - rightCenter + vec2<f32>(1e-8, 1e-8));
        disp += dir * strength * falloff * 0.005;
    }

    return disp;
}

// Compute nose width displacement: horizontal scale around nose centerline.
fn noseWidthDisplacement(pos: vec2<f32>, strength: f32) -> vec2<f32> {
    if (strength <= 0.0) {
        return vec2<f32>(0.0, 0.0);
    }

    let noseTip = landmarkPos(NOSE_TIP);
    let noseLeft = landmarkPos(NOSE_LEFT);
    let noseRight = landmarkPos(NOSE_RIGHT);

    let noseCenter = (noseLeft + noseRight) * 0.5;
    let noseHalfWidth = length(noseRight - noseLeft) * 0.5;

    let dx = pos.x - noseCenter.x;
    let dy = pos.y - noseCenter.y;

    // Only affect horizontal direction near nose
    if (abs(dy) > noseHalfWidth * 2.0) {
        return vec2<f32>(0.0, 0.0);
    }

    let falloff = 1.0 - smoothstep_h(0.0, noseHalfWidth * 2.0, abs(dy));
    let horizontalFalloff = smoothstep_h(0.0, noseHalfWidth * 1.5, abs(dx));

    return vec2<f32>(sign(dx) * strength * falloff * horizontalFalloff * 0.005, 0.0);
}

// Compute mouth displacement: subtle lip-spacing/proportion adjustment.
fn mouthDisplacement(pos: vec2<f32>, strength: f32) -> vec2<f32> {
    if (strength <= 0.0) {
        return vec2<f32>(0.0, 0.0);
    }

    let upperLip = landmarkPos(UPPER_LIP);
    let lowerLip = landmarkPos(LOWER_LIP);
    let lipLeft = landmarkPos(LIP_LEFT);
    let lipRight = landmarkPos(LIP_RIGHT);

    let lipCenter = (upperLip + lowerLip) * 0.5;
    let lipHeight = length(lowerLip - upperLip);
    let lipWidth = length(lipRight - lipLeft);

    let dx = pos.x - lipCenter.x;
    let dy = pos.y - lipCenter.y;

    // Only affect area near lips
    if (abs(dx) > lipWidth * 0.8 || abs(dy) > lipHeight * 2.0) {
        return vec2<f32>(0.0, 0.0);
    }

    let falloffX = 1.0 - smoothstep_h(0.0, lipWidth * 0.8, abs(dx));
    let falloffY = 1.0 - smoothstep_h(0.0, lipHeight * 2.0, abs(dy));
    let falloff = falloffX * falloffY;

    // Vertical displacement: push upper lip up, lower lip down
    return vec2<f32>(0.0, sign(dy) * strength * falloff * 0.003);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let dims = textureDimensions(inputTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let pos = vec2<f32>(f32(gid.x) / f32(dims.x), f32(gid.y) / f32(dims.y));

    // Compute total displacement from all features
    var disp = vec2<f32>(0.0, 0.0);
    disp += jawSlimDisplacement(pos, params.jawSlim);
    disp += eyeEnlargeDisplacement(pos, params.eyeEnlarge);
    disp += noseWidthDisplacement(pos, params.noseWidth);
    disp += mouthDisplacement(pos, params.mouth);

    // Apply master strength
    disp *= params.masterStrength;

    // Inverse warp: sample source at displaced position with bilinear interpolation
    let samplePos = pos - disp;
    let sampleCoord = vec2<f32>(
        clamp(samplePos.x, 0.0, 1.0) * f32(dims.x) - 0.5,
        clamp(samplePos.y, 0.0, 1.0) * f32(dims.y) - 0.5
    );

    // Bilinear interpolation: sample 4 nearest texels
    let x0 = i32(floor(sampleCoord.x));
    let y0 = i32(floor(sampleCoord.y));
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let fx = fract(sampleCoord.x);
    let fy = fract(sampleCoord.y);

    // Clamp to valid texture bounds
    let cx0 = clamp(x0, 0, i32(dims.x) - 1);
    let cy0 = clamp(y0, 0, i32(dims.y) - 1);
    let cx1 = clamp(x1, 0, i32(dims.x) - 1);
    let cy1 = clamp(y1, 0, i32(dims.y) - 1);

    let c00 = textureLoad(inputTex, vec2<i32>(cx0, cy0), 0);
    let c10 = textureLoad(inputTex, vec2<i32>(cx1, cy0), 0);
    let c01 = textureLoad(inputTex, vec2<i32>(cx0, cy1), 0);
    let c11 = textureLoad(inputTex, vec2<i32>(cx1, cy1), 0);

    // Bilinear blend
    let color = mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);
    textureStore(outputTex, gid.xy, color);
}
