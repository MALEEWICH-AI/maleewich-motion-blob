// WebGL2 GLSL Shaders — Forensic Octane/Redshift Reconstruction of motionRef.mp4
window.BlobStudio = window.BlobStudio || {};

window.BlobStudio.VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

window.BlobStudio.FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

#define MAX_BLOBS 16

uniform vec2 uResolution;
uniform float uTime;
uniform float uLoopDuration;

// Blob arrays:
// uBlobPosRad[i] = vec4(x, y, z, radius)
// uBlobMeta[i]   = vec4(type, greenRatio, animAmp, animPhase)
//   type: 0.0 = Dual-Layer Blob (Outer Glass + Inner Green Core)
//         1.0 = Clear Glass Only (Floating Droplet if r < 0.11, Outer Glass Dome if 0.11..0.30, or Dark Corner Sphere if r > 0.30)
//         2.0 = Inner Green Core Lobe Only
//         3.0 = Internal Glass Chamber / Circular Black Window (carves smooth circular aperture into green shell)
uniform int uBlobCount;
uniform int uPrecomputedAnim;
uniform vec4 uBlobPosRad[MAX_BLOBS];
uniform vec4 uBlobMeta[MAX_BLOBS];
uniform vec4 uBlobAnimPosRad[MAX_BLOBS];
uniform vec4 uBlobGreenPosRad[MAX_BLOBS];

// Global Material & Scene Controls
uniform float uSmoothGlass;      // smin k for outer glass
uniform float uSmoothGreen;      // smin k for inner green core
uniform float uSmoothCavity;     // bevel smoothness for internal circular windows
uniform float uGlassIOR;         // Refraction index (e.g. 1.50)
uniform float uGlassDispersion;  // Chromatic dispersion / inner meniscus strength
uniform float uFresnelIntensity; // Rim light power
uniform float uBubbleDensity;    // Suspended micro-bubbles inside glass
uniform float uCoreDetail;       // Organic cellular/vein/spore greebles inside green core (0.0..2.0)
uniform vec3 uGreenColor;        // Primary acid green color
uniform vec3 uGreenDeepColor;    // Deep subsurface shadow color
uniform vec3 uBgTopColor;        // Studio background top-left
uniform vec3 uBgGlowColor;       // Studio background glow

// Rock Terrain Controls
uniform float uRockEnabled;      // 1.0 or 0.0
uniform float uRockHeight;       // Vertical offset of rock base
uniform float uRockRoughness;    // Facet sharpness
uniform float uMossIntensity;    // Acid-green moss speckles on rock

// Camera / Framing
uniform float uCamZoom;
uniform vec2 uCamPan;

// Typography Overlay Texture
uniform sampler2D uTextBackTex;  // Text behind glass (refracted!)
uniform sampler2D uTextFrontTex; // Text in front of glass

// --- Hash & Procedural Noise Functions ---
float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash31(vec3 p3) {
    p3  = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash31(i + vec3(0,0,0));
    float n100 = hash31(i + vec3(1,0,0));
    float n010 = hash31(i + vec3(0,1,0));
    float n110 = hash31(i + vec3(1,1,0));
    float n001 = hash31(i + vec3(0,0,1));
    float n101 = hash31(i + vec3(1,0,1));
    float n011 = hash31(i + vec3(0,1,1));
    float n111 = hash31(i + vec3(1,1,1));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);

    return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

// Domain-rotated ridged multifractal noise for sharp chipped volcanic basalt rock
const mat3 mRot = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64
);

float fbmRidgedRock(vec3 p) {
    float f = 0.0;
    float amp = 0.54;
    vec3 q = p;
    for (int i = 0; i < 4; i++) {
        float n = 1.0 - abs(noise3D(q) * 2.0 - 1.0);
        f += amp * (n * n);
        q = mRot * q * 2.05 + vec3(1.7, 3.2, 2.4);
        amp *= 0.46;
    }
    return f;
}

// 6-octave high-frequency granular rock bump height for razor-sharp fractured obsidian/basalt
float fbmRockBump(vec3 p) {
    float f = 0.0;
    float amp = 0.52;
    vec3 q = p;
    for (int i = 0; i < 6; i++) {
        float n = 1.0 - abs(noise3D(q) * 2.0 - 1.0);
        f += amp * (n * n);
        q = mRot * q * 2.18 + vec3(2.9, 1.4, 3.8);
        amp *= 0.48;
    }
    return f;
}

// Polynomial Smooth Minimum (C2 continuous)
float smin(float a, float b, float k) {
    if (k <= 0.0001) return min(a, b);
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

float smax(float a, float b, float k) {
    return -smin(-a, -b, k);
}

// Crisp Star-like 3D Micro-Bubbles suspended inside glass (matches the fine white star-dust in ref_01.png)
float sparkleMicroBubbles(vec3 p, float density) {
    if (density <= 0.01) return 0.0;
    float acc = 0.0;

    // Layer 1: Crisp bright micro-bubbles
    vec3 q1 = p * 44.0;
    vec3 i1 = floor(q1);
    vec3 f1 = fract(q1);
    vec3 r1 = hash33(i1);
    if (r1.z < 0.19 * density) {
        vec3 c1 = 0.20 + 0.60 * r1;
        float d1 = length(f1 - c1);
        float sz1 = 0.038 + 0.048 * r1.x;
        acc += (1.0 - smoothstep(sz1 * 0.15, sz1, d1)) * (0.50 + 0.50 * r1.y);
    }

    // Layer 2: Ultra-fine star-dust pinpricks
    vec3 q2 = p * 88.0 + vec3(4.1, 1.9, 7.3);
    vec3 i2 = floor(q2);
    vec3 f2 = fract(q2);
    vec3 r2 = hash33(i2);
    if (r2.z < 0.25 * density) {
        vec3 c2 = 0.20 + 0.60 * r2;
        float d2 = length(f2 - c2);
        float sz2 = 0.035 + 0.045 * r2.x;
        acc += (1.0 - smoothstep(sz2 * 0.10, sz2, d2)) * (0.40 + 0.60 * r2.y);
    }

    return clamp(acc, 0.0, 1.3);
}

// Hyperbolic Catenary Liquid Bridge between P0 and P2 passing through waist control point P1
vec2 sdHyperbolicBridge(vec3 p, vec3 p0, vec3 p1, vec3 p2, float rWaist, float greenRatio) {
    vec3 ba = p2 - p0;
    float lenSq = max(dot(ba, ba), 0.001);
    float h = clamp(dot(p - p0, ba) / lenSq, 0.0, 1.0);

    // Project sag (p1 - midLinear) perpendicular to ba so the spine never self-displaces along ba!
    vec3 midLinear = 0.5 * (p0 + p2);
    vec3 vSag = p1 - midLinear;
    vec3 sagPerp = vSag - ba * (dot(vSag, ba) / lenSq);
    vec3 curveCenter = mix(p0, p2, h) + 4.0 * h * (1.0 - h) * sagPerp;

    // u = 0 at waist center, u = -1 at left sphere, u = +1 at right cluster
    float u = 2.0 * (h - 0.5);
    float u2 = u * u;
    float u4 = u2 * u2;

    // Outer glass profile: continuous taut hourglass neck
    float rGlass = rWaist * (1.0 + 2.25 * u4);
    float distToAxis = length(p - curveCenter);
    float dG = (distToAxis - rGlass) * 0.76;

    // Inner green profile:
    // For reference preset (greenRatio <= 0.58), the bridge center is pure clear dark glass!
    float dGr = 1e5;
    if (greenRatio > 0.60) {
        float pinch = (greenRatio - 0.58) * 1.35;
        float rGreen = rWaist * (pinch + 1.65 * u4);
        dGr = (distToAxis - rGreen) * 0.76;
    }

    return vec2(dG, dGr);
}

// Animated position helper (15s seamless loop matching motionRef.mp4)
vec3 getAnimatedBlobPos(int idx, vec3 basePos, float amp, float phase, float type) {
    float tau = 6.28318530718;
    float loopT = (uLoopDuration > 0.1) ? (uTime / uLoopDuration) * tau : uTime;
    float p = phase * tau;

    // Zero-anchored at t=0 via sin(loopT * 0.5) envelope or harmonic difference, with bounded [-1, 1] excursion
    float env = sin(loopT * 0.5);
    float s1 = sin(loopT + p) * env;
    float c1 = cos(loopT + p * 0.85) * env;
    float s2 = sin(loopT * 2.0 + p * 1.3) * env;
    float c2 = cos(loopT * 2.0 + p * 1.1) * env;

    vec3 offset = vec3(
        s1 * 0.016 + c2 * 0.006,
        c1 * 0.018 + s2 * 0.007,
        sin(loopT + p * 1.7) * env * 0.008
    );

    if (type > 2.5) {
        // Type 3: Internal circular windows move cohesively with their host sphere + subtle organic wall undulation
        offset.x = s1 * 0.018 + c2 * 0.010;
        offset.y = c1 * 0.020 + s2 * 0.010;
        offset.z = 0.0;
    } else if (type > 0.5 && type < 1.5) {
        // Type 1: Floating droplets weightless vertical drift (matching ref_01.png -> ref_03.png)
        float isSmallDroplet = (idx >= 7 && idx <= 9) ? 1.0 : 0.22;
        offset.x = sin(loopT + p * 1.2) * env * 0.042 * isSmallDroplet;
        offset.y = sin(loopT * 0.5) * sin(loopT * 0.5) * (0.14 * isSmallDroplet) + c1 * 0.018;
    }
    return basePos + offset * amp;
}

// Per-frame cached animated blob positions & radii (eliminates ~2,000 trig calls per pixel during raymarching!)
vec4 gAnimPosRad[MAX_BLOBS];
vec4 gGreenPosRad[MAX_BLOBS];
float gLoopT = 0.0;

void initAnimatedBlobs() {
    float tau = 6.28318530718;
    gLoopT = (uLoopDuration > 0.1) ? (uTime / uLoopDuration) * tau : uTime;

    if (uPrecomputedAnim == 1) {
        for (int i = 0; i < MAX_BLOBS; i++) {
            if (i >= uBlobCount) break;
            gAnimPosRad[i] = uBlobAnimPosRad[i];
            gGreenPosRad[i] = uBlobGreenPosRad[i];
        }
        return;
    }

    float env = sin(gLoopT * 0.5);
    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= uBlobCount) break;
        vec4 pr = uBlobPosRad[i];
        vec4 meta = uBlobMeta[i];
        float type = meta.x;
        float greenRatio = meta.y;
        float amp = meta.z;
        float phase = meta.w;

        vec3 bPos = getAnimatedBlobPos(i, pr.xyz, amp, phase, type);
        float rOuter = pr.w * (1.0 + 0.012 * amp * sin(gLoopT + phase * 6.28318) * env);
        gAnimPosRad[i] = vec4(bPos, rOuter);

        vec3 greenOffset = vec3(
            cos(gLoopT + phase * 6.28) * env * 0.010 * amp,
            sin(gLoopT + phase * 6.28) * env * 0.012 * amp,
            0.0
        );
        gGreenPosRad[i] = vec4(bPos + greenOffset, rOuter * greenRatio);
    }
}

vec3 computeSpatialWarp(vec3 p) {
    return vec3(
        sin(p.y * 2.6 + gLoopT) * 0.0035,
        cos(p.x * 2.4 - gLoopT) * 0.0035,
        sin(p.x * 2.2 + p.y * 2.0 + gLoopT) * 0.0030
    );
}

// Dedicated Outer Glass SDF (Zero per-blob trig!)
float mapGlassOnly(vec3 p) {
    // Fast Z bounding slab check when far from the scene plane
    if (abs(p.z) > 0.72) {
        return abs(p.z) - 0.52;
    }

    float dGlass = 1e5;
    vec3 warp = computeSpatialWarp(p);

    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= uBlobCount) break;
        vec4 meta = uBlobMeta[i];
        float type = meta.x;
        if (type > 1.5) continue;

        vec4 anim = gAnimPosRad[i];
        vec3 bPos = anim.xyz;
        float rOuter = anim.w;
        float amp = meta.z;
        vec3 pWarped = p + warp * clamp(amp, 0.0, 1.0);

        if (type < 0.5 && i == 1 && rOuter < 0.14 && uBlobCount > 2) {
            vec2 br = sdHyperbolicBridge(p + warp * 0.35, gAnimPosRad[0].xyz, bPos, gAnimPosRad[2].xyz, rOuter, meta.y);
            dGlass = smin(dGlass, br.x, uSmoothGlass * 0.92);
        } else {
            float k = (rOuter < 0.11 || rOuter > 0.31) ? 0.006 : uSmoothGlass;
            float dg = length(pWarped - bPos) - rOuter;
            dGlass = smin(dGlass, dg, k);
        }
    }
    return dGlass;
}

// Dedicated Circular Window Aperture SDF (Zero per-blob trig!)
float mapChamberOnly(vec3 p) {
    float dChamber = 1e5;
    vec3 warp = computeSpatialWarp(p);

    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= uBlobCount) break;
        vec4 meta = uBlobMeta[i];
        if (meta.x < 2.5) continue;

        vec4 anim = gAnimPosRad[i];
        vec3 dVec = (p + warp * clamp(meta.z, 0.0, 1.0)) - anim.xyz;
        dVec.z *= 0.10;
        float dc = length(dVec) - anim.w;
        dChamber = min(dChamber, dc);
    }
    return dChamber;
}

// Dedicated Inner Green Core Envelope SDF (Zero per-blob trig!)
float mapGreenOnly(vec3 p) {
    float dGreenRaw = 1e5;
    vec3 warp = computeSpatialWarp(p);

    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= uBlobCount) break;
        vec4 meta = uBlobMeta[i];
        float type = meta.x;
        if (type > 0.5 && type < 1.5) continue;
        if (type > 2.5) continue;

        vec4 anim = gAnimPosRad[i];
        vec3 bPos = anim.xyz;
        float rOuter = anim.w;
        float greenRatio = meta.y;
        vec3 pWarped = p + warp * clamp(meta.z, 0.0, 1.0);

        if (type < 0.5) {
            if (i == 1 && rOuter < 0.14 && uBlobCount > 2) {
                if (greenRatio > 0.60) {
                    vec2 br = sdHyperbolicBridge(p + warp * 0.35, gAnimPosRad[0].xyz, bPos, gAnimPosRad[2].xyz, rOuter, greenRatio);
                    dGreenRaw = smin(dGreenRaw, br.y, uSmoothGreen * 0.75);
                }
            } else if (greenRatio > 0.01 && rOuter <= 0.31) {
                vec4 grAnim = gGreenPosRad[i];
                float dgr = length(pWarped - grAnim.xyz) - grAnim.w;
                dGreenRaw = smin(dGreenRaw, dgr, uSmoothGreen * 1.05);
            }
        } else if (type > 1.5 && type < 2.5) {
            float dgr = length(pWarped - bPos) - rOuter;
            dGreenRaw = smin(dGreenRaw, dgr, uSmoothGreen * 1.05);
        }
    }
    return dGreenRaw;
}

// Fused Single-Loop Interior SDF (3x faster than calling mapGlassOnly + mapGreenOnly + mapChamberOnly separately!)
vec3 mapBlobsFull(vec3 p) {
    float dGlass = 1e5;
    float dGreenRaw = 1e5;
    float dChamber = 1e5;
    vec3 warp = computeSpatialWarp(p);

    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= uBlobCount) break;
        vec4 meta = uBlobMeta[i];
        float type = meta.x;
        vec4 anim = gAnimPosRad[i];
        vec3 bPos = anim.xyz;
        float rOuter = anim.w;
        vec3 pWarped = p + warp * clamp(meta.z, 0.0, 1.0);

        if (type > 2.5) {
            vec3 dVec = pWarped - bPos;
            dVec.z *= 0.10;
            dChamber = min(dChamber, length(dVec) - rOuter);
        } else if (type > 1.5) {
            dGreenRaw = smin(dGreenRaw, length(pWarped - bPos) - rOuter, uSmoothGreen * 1.05);
        } else if (type > 0.5) {
            float k = (rOuter < 0.11 || rOuter > 0.31) ? 0.006 : uSmoothGlass;
            dGlass = smin(dGlass, length(pWarped - bPos) - rOuter, k);
        } else {
            float greenRatio = meta.y;
            if (i == 1 && rOuter < 0.14 && uBlobCount > 2) {
                vec2 br = sdHyperbolicBridge(p + warp * 0.35, gAnimPosRad[0].xyz, bPos, gAnimPosRad[2].xyz, rOuter, greenRatio);
                dGlass = smin(dGlass, br.x, uSmoothGlass * 0.92);
                if (greenRatio > 0.60) {
                    dGreenRaw = smin(dGreenRaw, br.y, uSmoothGreen * 0.75);
                }
            } else {
                float k = (rOuter < 0.11 || rOuter > 0.31) ? 0.006 : uSmoothGlass;
                dGlass = smin(dGlass, length(pWarped - bPos) - rOuter, k);
                if (greenRatio > 0.01 && rOuter <= 0.31) {
                    vec4 grAnim = gGreenPosRad[i];
                    dGreenRaw = smin(dGreenRaw, length(pWarped - grAnim.xyz) - grAnim.w, uSmoothGreen * 1.05);
                }
            }
        }
    }

    float dGreenShell = smax(dGreenRaw, dGlass + 0.026, 0.018);
    return vec3(dGlass, dGreenShell, dChamber);
}

// Foreground Steep Chipped Volcanic Basalt Rock Boulder SDF
float getRockRidgeHeight(float x) {
    // Left low craggy plateau around y = -0.68 (when uRockHeight = -0.56)
    float leftPlateau = (uRockHeight - 0.125)
                      + 0.014 * sin(x * 7.5 + 0.8)
                      - 0.042 * smoothstep(-0.45, -0.02, x);

    // Right steep dark crag rising at x > 0.01 up to y = -0.51 at x = 0.14..0.28
    float rightRise = smoothstep(-0.02, 0.13, x) * (1.0 - 0.60 * smoothstep(0.28, 0.48, x));
    float rightPeak = (uRockHeight - 0.165) + 0.215 * rightRise;

    return max(leftPlateau, rightPeak);
}

float mapRock(vec3 p) {
    if (uRockEnabled < 0.5) return 1e5;

    // Fast height bounding plane: highest rock peak never exceeds uRockHeight + 0.08
    if (p.y > uRockHeight + 0.18) {
        return p.y - (uRockHeight + 0.10);
    }

    float ridgeH = getRockRidgeHeight(p.x);

    // Steep 3D boulder/cliff in Z:
    float zFrontDrop = 1.55 * max(p.z - 0.02, 0.0);
    float zBackDrop  = 0.90 * max(-0.02 - p.z, 0.0);
    float baseHeight = ridgeH - zFrontDrop - zBackDrop;

    float dApprox = p.y - baseHeight;
    if (dApprox > 0.22) return dApprox * 0.75;

    // Clean angular macro rock blocks (fine granular crags are added in shadeRock via 6-octave bump!)
    vec3 rp = p * 4.8 + vec3(1.4, 0.8, 2.3);
    float macroBlocks = fbmRidgedRock(rp);
    float midCrags    = fbmRidgedRock(p * 11.5 + vec3(3.1, 1.7, 0.9));

    float displacement = (macroBlocks * 0.062 + midCrags * 0.024) * uRockRoughness;

    return (p.y - (baseHeight + displacement)) * 0.55;
}

// Normals via Tetrahedron Differences
vec3 calcNormalGlass(vec3 p) {
    const float h = 0.0010;
    const vec2 k = vec2(1, -1);
    return normalize(
        k.xyy * mapGlassOnly(p + k.xyy * h) +
        k.yyx * mapGlassOnly(p + k.yyx * h) +
        k.yxy * mapGlassOnly(p + k.yxy * h) +
        k.xxx * mapGlassOnly(p + k.xxx * h)
    );
}

vec3 calcNormalGreen(vec3 p) {
    const float h = 0.0012;
    const vec2 k = vec2(1, -1);
    return normalize(
        k.xyy * mapGreenOnly(p + k.xyy * h) +
        k.yyx * mapGreenOnly(p + k.yyx * h) +
        k.yxy * mapGreenOnly(p + k.yxy * h) +
        k.xxx * mapGreenOnly(p + k.xxx * h)
    );
}

vec3 calcNormalChamber(vec3 p) {
    const float h = 0.0012;
    const vec2 k = vec2(1, -1);
    return normalize(
        k.xyy * mapChamberOnly(p + k.xyy * h) +
        k.yyx * mapChamberOnly(p + k.yyx * h) +
        k.yxy * mapChamberOnly(p + k.yxy * h) +
        k.xxx * mapChamberOnly(p + k.xxx * h)
    );
}

vec3 calcNormalRock(vec3 p) {
    const float h = 0.0012;
    const vec2 k = vec2(1, -1);
    return normalize(
        k.xyy * mapRock(p + k.xyy * h) +
        k.yyx * mapRock(p + k.yyx * h) +
        k.yxy * mapRock(p + k.yxy * h) +
        k.xxx * mapRock(p + k.xxx * h)
    );
}

// Out-of-Focus (Bokeh DOF) Background Rock Ridge + Bokeh Droplet + Studio Backdrop
vec3 sampleBackgroundWithDOF(vec2 uv, vec2 screenUv, bool includeBackText) {
    // 1. Pitch-black Octane studio backdrop
    float glow = exp(-length(screenUv - vec2(0.74, 0.38)) * 3.2);
    vec3 bg = mix(uBgTopColor, uBgGlowColor, clamp(glow * 0.40, 0.0, 1.0));

    // 2. Out-of-focus (DOF blurred) diagonal background rock ridge
    if (uRockEnabled > 0.5) {
        float dx = uv.x - 0.15;
        float bgRidgeProfile = (uRockHeight + 0.105)
                             + 0.35 * min(dx, 0.0)
                             - 1.90 * max(dx, 0.0) * max(dx, 0.0)
                             - 0.16 * dx * dx;

        float rNoise1 = fbmRidgedRock(vec3(uv.x * 7.0 + 3.1, uv.y * 7.0, 1.8));
        float rNoise2 = noise3D(vec3(uv.x * 15.0 + 1.2, uv.y * 15.0, 4.3));
        float ridgeY = bgRidgeProfile + (rNoise1 - 0.35) * 0.052 + (rNoise2 - 0.5) * 0.018;

        float ridgeMask = 1.0 - smoothstep(ridgeY - 0.020, ridgeY + 0.018, uv.y);
        if (ridgeMask > 0.001) {
            float depthFromCrest = max(ridgeY - uv.y, 0.0);
            float crestGlow = exp(-depthFromCrest * 20.0);
            float facetLight = smoothstep(0.24, 0.58, rNoise1) * exp(-depthFromCrest * 8.5);
            float valleyShadow = smoothstep(0.18, 0.52, rNoise2);

            vec3 darkStone = vec3(0.012, 0.014, 0.013);
            vec3 litSilver = vec3(0.50, 0.52, 0.51);
            float lightMix = clamp(crestGlow * (0.50 + 0.50 * rNoise1) + facetLight * 0.68 * valleyShadow, 0.0, 1.0);
            vec3 blurryRock = mix(darkStone, litSilver, lightMix);

            float mossSpot1 = exp(-length(uv - vec2(-0.18, -0.59)) * 45.0);
            float mossSpot2 = exp(-length(uv - vec2(0.07, -0.48)) * 50.0);
            float mossBokeh = clamp(mossSpot1 + mossSpot2, 0.0, 1.0);
            blurryRock = mix(blurryRock, uGreenColor * 0.72, mossBokeh * uMossIntensity * 0.55);

            bg = mix(bg, blurryRock, ridgeMask);
        }
    }

    // 3. Subtle out-of-focus background bokeh droplet under the bridge (at x = 0.04, y = -0.25 in ref_01.png)
    vec2 bokehPos = vec2(0.04, -0.25);
    float dBokeh = length(uv - bokehPos);
    float bokehCircle = (1.0 - smoothstep(0.010, 0.020, dBokeh)) * (0.55 + 0.45 * smoothstep(0.005, 0.016, dBokeh));
    bg += vec3(0.20, 0.23, 0.20) * bokehCircle;

    if (includeBackText) {
        vec2 texUv = vec2(screenUv.x, 1.0 - screenUv.y);
        vec4 backTxt = texture(uTextBackTex, clamp(texUv, 0.0, 1.0));
        bg = mix(bg, backTxt.rgb, backTxt.a);
    }
    return bg;
}

// Octane Rim-Hugging Studio Strip Softbox Reflections
vec3 sampleStudioReflections(vec3 reflDir, float ndv) {
    vec3 col = vec3(0.0);

    // Physical grazing mask: suppress front-center blob reflections so sphere centers stay deep Octane black!
    float grazingMask = 1.0 - smoothstep(0.18, 0.65, ndv);

    // 1. Main Overhead-Left Curved Studio Strip (sleek top-left white crescent on Left Sphere, Right Dome & Droplets)
    vec3 s1 = normalize(vec3(-0.55, 0.79, -0.26));
    float d1 = dot(reflDir, s1);
    float strip1 = smoothstep(0.84, 0.925, d1);
    float core1  = smoothstep(0.925, 0.980, d1);
    col += vec3(0.98, 1.0, 0.98) * (strip1 * 0.88 + core1 * 1.35) * grazingMask;

    // 2. Right-Side Inner-Curve Strip
    vec3 s2 = normalize(vec3(0.86, 0.10, -0.50));
    float d2 = dot(reflDir, s2);
    float strip2 = smoothstep(0.89, 0.955, d2);
    float core2  = smoothstep(0.955, 0.990, d2);
    col += vec3(0.97, 1.0, 0.96) * (strip2 * 0.70 + core2 * 1.15) * grazingMask;

    // 3. Lower Under-Rim Strip (crisp thin white bottom contour on Left Sphere & Bridge)
    vec3 s3 = normalize(vec3(-0.30, -0.91, -0.28));
    float d3 = dot(reflDir, s3);
    float strip3 = smoothstep(0.87, 0.940, d3);
    col += vec3(0.94, 0.99, 0.94) * strip3 * 0.85 * grazingMask;

    // 4. Lower-Right Accent Strip (small crisp reflection on droplets & lower right foot)
    vec3 s4 = normalize(vec3(0.58, -0.76, -0.28));
    float d4 = dot(reflDir, s4);
    float strip4 = smoothstep(0.90, 0.965, d4);
    col += vec3(0.95, 0.99, 0.93) * strip4 * 0.75 * grazingMask;

    return col;
}

// Shade Foreground Steep Chipped Volcanic Basalt Rock
vec3 shadeRock(vec3 p, vec3 rd, vec3 n) {
    // 6-octave sharp fractured basalt normal-map bump (gives true granular Octane stone texture!)
    vec3 pBump = p * vec3(24.0, 32.0, 24.0);
    float e = 0.0018;
    float b0 = fbmRockBump(pBump);
    vec3 bumpGrad = vec3(
        fbmRockBump(pBump + vec3(e, 0.0, 0.0)) - b0,
        fbmRockBump(pBump + vec3(0.0, e, 0.0)) - b0,
        fbmRockBump(pBump + vec3(0.0, 0.0, e)) - b0
    ) / e;
    n = normalize(n - bumpGrad * 0.038);

    // Ultra-fine mineral grain normal perturbation
    vec3 pGrain = p * 240.0;
    vec3 grainN = vec3(
        noise3D(pGrain + vec3(0.1, 0.0, 0.0)) - noise3D(pGrain - vec3(0.1, 0.0, 0.0)),
        noise3D(pGrain + vec3(0.0, 0.1, 0.0)) - noise3D(pGrain - vec3(0.0, 0.1, 0.0)),
        noise3D(pGrain + vec3(0.0, 0.0, 0.1)) - noise3D(pGrain - vec3(0.0, 0.0, 0.1))
    );
    n = normalize(n + grainN * 0.32);

    float ridgeH = getRockRidgeHeight(p.x);
    float distFromCrest = max((ridgeH + 0.048) - p.y, 0.0);
    float crestBand = exp(-distFromCrest * 38.0);
    float leftCrestBoost = 1.0 - smoothstep(-0.18, 0.05, p.x);

    vec3 lightCrest = normalize(vec3(-0.26, 0.82, -0.51));
    vec3 lightKey   = normalize(vec3(-0.42, 0.80, 0.42));

    float diffCrest = max(dot(n, lightCrest), 0.0);
    float diffKey   = max(dot(n, lightKey), 0.0);

    float ao = smoothstep(0.16, 0.62, b0);

    float grit = noise3D(p * 85.0) * 0.6 + noise3D(p * 195.0) * 0.4;
    vec3 rockAlbedo = mix(vec3(0.0005, 0.0007, 0.0006), vec3(0.006, 0.007, 0.007), grit);

    vec3 hCrest = normalize(lightCrest - rd);
    vec3 hKey   = normalize(lightKey - rd);

    float upwardMask = smoothstep(0.18, 0.72, n.y);
    float specCrest  = pow(max(dot(n, hCrest), 0.0), 10.0) * upwardMask;
    float specFracture = pow(max(dot(n, hKey), 0.0), 32.0) * smoothstep(0.32, 0.68, b0);

    vec3 col = rockAlbedo * (0.04 + 0.55 * diffKey + 0.35 * diffCrest) * (0.15 + 0.85 * ao);

    // 1. Blazing silver-white grazing rim along the top crest of the left plateau
    float topRimMask = crestBand * (0.18 + 1.65 * leftCrestBoost);
    col += vec3(0.94, 0.97, 0.96) * (specCrest * 1.45 + diffCrest * 0.65 * upwardMask) * topRimMask * ao;

    // 2. Crisp silver-grey glints on sharp fracture ridges along the left slope of the right crag & upper cliff
    float leftSlopeOfRightPeak = exp(-pow((p.x - 0.04) * 14.0, 2.0)) * smoothstep(-0.76, -0.54, p.y);
    float upperCliffMask = smoothstep(-0.92, -0.66, p.y);
    col += vec3(0.55, 0.58, 0.57) * specFracture * (0.12 * upperCliffMask + 0.55 * crestBand + 0.85 * leftSlopeOfRightPeak) * ao;

    // 3. Particulate Neon Yellow-Green Moss Spores & Droplets
    if (uMossIntensity > 0.01) {
        float regionX = smoothstep(-0.14, 0.02, p.x) * (1.0 - smoothstep(0.22, 0.38, p.x));
        float regionY = smoothstep(-0.88, -0.75, p.y) * (1.0 - smoothstep(-0.54, -0.49, p.y));
        float regionFocus = regionX * regionY;

        vec3 qDrop = p * 44.0 + vec3(2.1, 0.9, 1.7);
        vec3 iDrop = floor(qDrop);
        vec3 fDrop = fract(qDrop);
        vec3 rDrop = hash33(iDrop);
        float dropMask = 0.0;
        if (rDrop.z < 0.14) {
            float d = length(fDrop - (0.25 + 0.5 * rDrop));
            float sz = 0.065 + 0.085 * rDrop.x;
            dropMask = (1.0 - smoothstep(sz * 0.25, sz, d)) * (0.5 + 0.5 * rDrop.y);
        }

        float creviceBand = exp(-pow((p.y - (uRockHeight - 0.165)) * 24.0, 2.0));
        float fineSpecks = smoothstep(0.66, 0.84, noise3D(p * vec3(65.0, 120.0, 65.0)))
                         * smoothstep(0.45, 0.72, noise3D(p * 24.0 + 1.5));

        float mossTotal = (dropMask * 1.40 + fineSpecks * (0.35 + 1.25 * creviceBand)) * regionFocus;
        vec3 neonMoss = mix(uGreenColor, vec3(0.96, 1.0, 0.18), 0.45);
        col = mix(col, neonMoss * (0.60 + 0.65 * diffKey), clamp(mossTotal * uMossIntensity, 0.0, 1.0));
    }

    return col;
}

// Procedural 3x5 bitmap glyph renderer for tiny technical text markings on the core texture
float sampleTinyChar(int charId, vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    int cx = clamp(int(floor(uv.x * 3.0)), 0, 2);
    int cy = clamp(int(floor(uv.y * 5.0)), 0, 4);
    int bitIndex = cy * 3 + cx;

    // 15-bit masks for crisp 3x5 technical characters (row 0 = bottom, row 4 = top)
    int mask = 0;
    int c = charId % 16;
    if (c == 0) mask = 31599;      // '0'
    else if (c == 1) mask = 9362;  // '1'
    else if (c == 2) mask = 29671; // '2'
    else if (c == 3) mask = 29391; // '3'
    else if (c == 4) mask = 23497; // '4'
    else if (c == 5) mask = 31183; // 'C'
    else if (c == 6) mask = 31207; // '6'
    else if (c == 7) mask = 31727; // '8'
    else if (c == 8) mask = 11245; // 'A'
    else if (c == 9) mask = 31143; // 'E'
    else if (c == 10) mask = 29687;// 'S'
    else if (c == 11) mask = 29842;// 'T'
    else if (c == 12) mask = 27501;// 'N'
    else if (c == 13) mask = 23378;// 'Y'
    else if (c == 14) mask = 448;  // '-'
    else mask = 1040;              // ':'

    int bit = (mask >> bitIndex) & 1;
    if (bit == 0) return 0.0;

    vec2 cellSub = fract(uv * vec2(3.0, 5.0));
    vec2 fw = clamp(fwidth(uv * vec2(3.0, 5.0)), 0.06, 0.28);
    float edge = smoothstep(0.0, fw.x, cellSub.x) * smoothstep(1.0, 1.0 - fw.x, cellSub.x) *
                 smoothstep(0.0, fw.y, cellSub.y) * smoothstep(1.0, 1.0 - fw.y, cellSub.y);
    return edge;
}

// Renders a miniature technical icon + 6-character micro-text stamp at local 2D surface offset d
float evalCoreMicroStamp(vec2 d, int seed, int style) {
    // Bounding box early exit for speed
    if (abs(d.x) > 0.24 || abs(d.y) > 0.075) return 0.0;

    float m = 0.0;

    // 1. Miniature Technical Icon on the left (d.x around -0.15)
    vec2 ip = (d - vec2(-0.155, 0.004)) / 0.030;
    if (abs(ip.x) < 1.35 && abs(ip.y) < 1.35) {
        float aa = clamp(length(fwidth(ip)) * 0.85, 0.06, 0.22);
        if (style == 0) {
            // Target reticle (circle + cardinal ticks + center dot)
            float dRing = abs(length(ip) - 0.68) - 0.09;
            float dCross = min(
                max(abs(ip.x) - 1.05, abs(ip.y) - 0.09),
                max(abs(ip.y) - 1.05, abs(ip.x) - 0.09)
            );
            dCross = max(dCross, -(length(ip) - 0.42)); // hollow gap near center
            float dDot = length(ip) - 0.16;
            float dIcon = min(min(dRing, dCross), dDot);
            m = max(m, 1.0 - smoothstep(0.0, aa, dIcon));
        } else if (style == 1) {
            // Corner brackets [ + ]
            float dBox = abs(max(abs(ip.x) - 0.88, abs(ip.y) - 0.72)) - 0.10;
            dBox = max(dBox, -min(abs(ip.x) - 0.42, abs(ip.y) - 0.32));
            float dPlus = min(
                max(abs(ip.x) - 0.35, abs(ip.y) - 0.09),
                max(abs(ip.y) - 0.35, abs(ip.x) - 0.09)
            );
            m = max(m, 1.0 - smoothstep(0.0, aa, min(dBox, dPlus)));
        } else {
            // Micro-barcode + status square
            float barX = fract(ip.x * 2.2 + 0.5) - 0.5;
            float dBars = max(abs(barX) - 0.18, max(abs(ip.x) - 0.85, abs(ip.y) - 0.65));
            m = max(m, 1.0 - smoothstep(0.0, aa, dBars));
        }
    }

    // 2. 6-character Micro-Text Stamp to the right of the icon
    vec2 txtUv = (d - vec2(-0.095, -0.018)) / vec2(0.24, 0.044);
    if (txtUv.x >= 0.0 && txtUv.x <= 1.0 && txtUv.y >= 0.0 && txtUv.y <= 1.0) {
        float slotF = txtUv.x * 6.0;
        int slot = int(floor(slotF));
        vec2 chUv = vec2(fract(slotF) * 1.34 - 0.17, txtUv.y);

        int code = 0;
        if (slot == 0) code = 10 + (seed % 3);          // 'S', 'T', 'N'
        else if (slot == 1) code = 5 + ((seed * 3) % 5);// 'C', '6', '8', 'A', 'E'
        else if (slot == 2) code = 14;                  // '-'
        else if (slot == 3) code = 0;                   // '0'
        else if (slot == 4) code = 1 + (seed % 4);      // '1'..'4'
        else code = 8 + ((seed * 5) % 4);               // 'A', 'E', 'S', 'T'

        m = max(m, sampleTinyChar(code, chUv) * 0.96);
    }

    // 3. Thin technical underline & end tick under the label
    float dLine = max(abs(d.x - 0.015) - 0.135, abs(d.y + 0.034) - 0.0028);
    float dTick = max(abs(d.x - 0.150) - 0.003, abs(d.y + 0.026) - 0.010);
    float aaLine = clamp(length(fwidth(d)) * 0.9, 0.0018, 0.0055);
    m = max(m, (1.0 - smoothstep(0.0, aaLine, min(dLine, dTick))) * 0.72);

    return m;
}

// Sparse Technical Micro-Markings, Tiny Text Stamps & Icons on the 3D Core Texture
// Returns vec2(markingMask, darkContrastMask)
vec2 sampleCoreGreebles(vec3 p, vec3 nGreen, float dChamber) {
    // Fade markings smoothly near the circular black window rims so they stay inside smooth core zones
    float windowSafe = smoothstep(0.022, 0.052, dChamber);
    if (windowSafe <= 0.001 || nGreen.z < 0.12) return vec2(0.0);

    // Find the dominant/nearest green core blob using precomputed gAnimPosRad (zero trig calls!)
    int bestIdx = 0;
    float bestDist = 1e5;
    vec3 bestCenter = vec3(0.0);
    float bestRad = 0.22;

    for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= uBlobCount) break;
        vec4 m = uBlobMeta[i];
        if (m.x < 0.5 && m.y > 0.05) {
            vec4 bAnim = gAnimPosRad[i];
            float rCore = bAnim.w * m.y;
            float d = length(p - bAnim.xyz) - rCore;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
                bestCenter = bAnim.xyz;
                bestRad = max(rCore, 0.12);
            }
        }
    }

    // Normalized 3D coordinates locked to this moving core sphere ([-1, 1] on its surface)
    vec3 localP = (p - bestCenter) / bestRad;
    // Slight tangent projection so stamps wrap naturally around the 3D curvature
    vec2 uv = localP.xy + nGreen.xy * 0.08;

    float stampMask = 0.0;

    // Place 2 to 3 sparse, clean technical text + icon markings on the open smooth zones of each core sphere
    vec2 offsetA = (bestIdx == 0)
        ? vec2(-0.08, 0.56)
        : (bestIdx == 2)
            ? vec2(-0.46, 0.34)
            : vec2(-0.22 + 0.07 * float(bestIdx % 3), 0.38);

    vec2 offsetB = (bestIdx == 0)
        ? vec2(-0.02, -0.26)
        : (bestIdx == 2)
            ? vec2(0.06, -0.50)
            : vec2(0.18, -0.28);

    stampMask = max(stampMask, evalCoreMicroStamp((uv - offsetA) * 0.92, bestIdx * 7 + 1, bestIdx % 3));
    stampMask = max(stampMask, evalCoreMicroStamp((uv - offsetB) * 0.95, bestIdx * 11 + 3, (bestIdx + 1) % 3));

    if (uCoreDetail > 0.85) {
        vec2 offsetC = (bestIdx == 2) ? vec2(-0.52, -0.18) : vec2(-0.42, 0.34);
        stampMask = max(stampMask, evalCoreMicroStamp((uv - offsetC) * 1.05, bestIdx * 13 + 5, 2));
    }

    // Sparse standalone miniature registration "+" marks on the core surface
    vec2 reg1 = (uv - vec2(-0.36, 0.44)) / 0.020;
    float dReg1 = min(max(abs(reg1.x) - 0.9, abs(reg1.y) - 0.12), max(abs(reg1.y) - 0.9, abs(reg1.x) - 0.12));
    vec2 reg2 = (uv - vec2(0.24, 0.48)) / 0.020;
    float dReg2 = min(max(abs(reg2.x) - 0.9, abs(reg2.y) - 0.12), max(abs(reg2.y) - 0.9, abs(reg2.x) - 0.12));
    stampMask = max(stampMask, (1.0 - smoothstep(0.0, 0.15, min(dReg1, dReg2))) * 0.85);

    float visFade = smoothstep(0.12, 0.42, nGreen.z) * windowSafe;
    stampMask *= visFade;

    return vec2(clamp(stampMask, 0.0, 1.0), visFade);
}

// Shade Perforated Smooth Acid-Green Shell (Rich 3D Octane Subsurface Scattering + Core Surface Markings + Rounded Bevel Lip)
vec3 shadeGreenCore(vec3 p, vec3 rdIn, vec3 nGreen, float dChamber) {
    if (dChamber < uSmoothCavity) {
        vec3 nCh = calcNormalChamber(p);
        float bevelFactor = 1.0 - smoothstep(0.0, max(uSmoothCavity, 0.005), dChamber);
        nGreen = normalize(mix(nGreen, nCh, bevelFactor * 0.72));
    }

    vec3 lightTop    = normalize(vec3(-0.22, 0.92, 0.32));
    vec3 lightBottom = normalize(vec3(-0.15, -0.90, 0.40));

    float ndl = dot(nGreen, lightTop);
    float wrapDiff = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);

    float thicknessProbe = clamp(-mapGreenOnly(p - nGreen * 0.085) / 0.085, 0.0, 1.0);
    float sss = 1.0 - thicknessProbe * 0.75;

    vec3 topChartreuse = vec3(0.84, 1.0, 0.08);
    vec3 midLime       = uGreenColor * 0.76;
    vec3 deepOlive     = uGreenDeepColor * 0.20;

    vec3 col = mix(deepOlive, midLime, smoothstep(0.04, 0.60, wrapDiff));
    float topHighlight = pow(wrapDiff, 2.2) * smoothstep(-0.08, 0.52, nGreen.y);
    col = mix(col, topChartreuse, clamp(topHighlight * (0.78 + 0.32 * sss), 0.0, 1.0));

    // Apply sparse technical text markings & icons attached to the 3D core surface
    float detailStrength = clamp(uCoreDetail, 0.0, 2.0);
    if (detailStrength > 0.01) {
        vec2 markings = sampleCoreGreebles(p, nGreen, dChamber);
        float m = clamp(markings.x * min(detailStrength, 1.35), 0.0, 1.0);
        if (m > 0.001) {
            // Subtle dark-olive contrast backing + luminous pale-lime/white technical screenprint ink
            col *= (1.0 - m * 0.28);
            vec3 stampInk = vec3(0.97, 1.0, 0.80);
            col = mix(col, stampInk, m * 0.82);
        }
    }

    float bottomRim = pow(max(dot(nGreen, lightBottom), 0.0), 2.0) * (1.0 - max(dot(nGreen, -rdIn), 0.0));
    col += mix(uGreenColor, vec3(0.85, 0.95, 0.10), 0.4) * bottomRim * 0.34;

    // Subtle dark olive 3D bevel rim right around each circular window cut
    float cutShadow = smoothstep(0.0, 0.016, dChamber);
    float outerLip  = smoothstep(0.006, 0.018, dChamber) * (1.0 - smoothstep(0.018, 0.042, dChamber));
    col *= (0.06 + 0.94 * cutShadow);
    col += topChartreuse * outerLip * 0.16;

    return col;
}

void main() {
    // Initialize cached animated blob positions once per fragment
    initAnimatedBlobs();

    // Normalized coordinates centered at (0,0), Y in [-1, 1]
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / (0.5 * uResolution.y);
    uv = uv / max(uCamZoom, 0.2) - uCamPan;

    vec2 screenUv = gl_FragCoord.xy / uResolution.xy;

    // Camera setup: focal length = ro.z = 2.50 so z=0 plane maps 1:1 to uv coordinates
    vec3 ro = vec3(0.0, 0.0, 2.50);
    vec3 rd = normalize(vec3(uv, -2.50));

    // 1. Primary Raymarch: Outer Glass Shell vs. Foreground Chipped Volcanic Rock
    float t = 0.0;
    float tPrev = 0.0;
    float dPrev = 0.0;
    float tMax = 4.2;
    int hitType = 0; // 0 = Background, 1 = Glass Blob, 2 = Rock

    for (int i = 0; i < 96; i++) {
        vec3 p = ro + rd * t;
        float dG = mapGlassOnly(p);
        float dR = mapRock(p);
        float d = min(dG, dR);

        if (d < 0.0009) {
            // 1-step secant surface refinement for ultra-smooth silhouette & normal precision
            if (i > 0 && (dPrev - d) > 1e-5) {
                t = mix(tPrev, t, clamp(dPrev / (dPrev - d), 0.0, 1.0));
            }
            hitType = (dG <= dR) ? 1 : 2;
            break;
        }
        tPrev = t;
        dPrev = d;
        t += d * 0.78;
        if (t > tMax) break;
    }

    vec3 finalColor = sampleBackgroundWithDOF(uv, screenUv, true);

    if (hitType == 2) {
        vec3 pRock = ro + rd * t;
        vec3 nRock = calcNormalRock(pRock);
        finalColor = shadeRock(pRock, rd, nRock);
    } else if (hitType == 1) {
        vec3 pGlass = ro + rd * t;
        vec3 nGlass = calcNormalGlass(pGlass);

        float ndv = max(dot(nGlass, -rd), 0.0);
        // Tight physical Fresnel so outer white rim is razor-sharp (~3px) and sphere centers stay deep Octane black!
        float fresnel = pow(1.0 - ndv, 4.2) * uFresnelIntensity;

        // Refract ray into the glass interior
        float eta = 1.0 / max(uGlassIOR, 1.08);
        vec3 rdIn = refract(rd, nGlass, eta);
        if (length(rdIn) < 0.001) {
            rdIn = reflect(rd, nGlass);
        }

        // March inside the glass volume to test intersection with the Green Shell Envelope (dGreenShell):
        // IMPORTANT: When the ray enters a circular window aperture (dGr < 0.004 && dCh <= 0.0), it immediately
        // enters the hollow pitch-black interior (internalHit = 0) and uses the SAME unified dark-glass shader
        // as the bridge & upper dome — eliminating any phantom seam between windows and clear glass!
        float tIn = 0.006;
        int internalHit = 0; // 0 = Unified Pitch-Black Window / Clear Dark Glass, 1 = Acid-Green Core
        float tHitIn = 0.0;
        float dChAtHit = 1e5;
        float minGreenDist = 1e5;
        float minChamberDist = 1e5;
        float glassThickness = 0.0;

        vec3 pEnter = pGlass - nGlass * 0.0020;
        float tInPrev = tIn;
        float dGrPrev = 1e5;

        for (int j = 0; j < 64; j++) {
            vec3 pIn = pEnter + rdIn * tIn;
            vec3 dAll = mapBlobsFull(pIn);
            float dGOut = dAll.x;
            float dGr   = dAll.y;
            float dCh   = dAll.z;

            minChamberDist = min(minChamberDist, dCh);
            if (dCh > 0.0) {
                minGreenDist = min(minGreenDist, max(dGr, dCh));
            }

            if (dGr < 0.0012) {
                if (j > 0 && (dGrPrev - dGr) > 1e-5) {
                    tHitIn = mix(tInPrev, tIn, clamp(dGrPrev / (dGrPrev - dGr), 0.0, 1.0));
                } else {
                    tHitIn = tIn;
                }
                dChAtHit = mapChamberOnly(pEnter + rdIn * tHitIn);
                if (dChAtHit > 0.0) {
                    internalHit = 1;
                } else {
                    internalHit = 0;
                    glassThickness = tHitIn + 0.08;
                }
                break;
            }

            if (dGOut > 0.002 && tIn > 0.020) {
                glassThickness = tIn;
                break;
            }

            tInPrev = tIn;
            dGrPrev = dGr;
            float stepLen = max(min(max(-dGOut, 0.028), dGr) * 0.72, 0.005);
            tIn += stepLen;
            glassThickness = tIn;
            if (tIn > 1.6) break;
        }

        // Crisp 3D parallax micro-bubbles suspended inside the glass volume
        float glassBubbles = sparkleMicroBubbles(pGlass + rdIn * 0.05, uBubbleDensity)
                           + sparkleMicroBubbles(pGlass + rdIn * 0.13, uBubbleDensity * 0.95) * 0.85;

        vec3 interiorColor = vec3(0.0);

        if (internalHit == 1) {
            // 1. Hit the smooth Acid-Green Core outside the circular apertures!
            vec3 pGr = pEnter + rdIn * tHitIn;
            vec3 nGr = calcNormalGreen(pGr);
            vec3 coreCol = shadeGreenCore(pGr, rdIn, nGr, dChAtHit);
            // Smooth grazing silhouette anti-aliasing where the internal green core curves away into clear glass
            float coreGrazingAA = smoothstep(0.02, 0.22, max(dot(nGr, -rdIn), 0.0));
            vec3 edgeCaustic = mix(vec3(0.0004, 0.0006, 0.0004), mix(uGreenColor, vec3(0.98, 1.0, 0.28), 0.48) * 0.65, 0.75);
            interiorColor = mix(edgeCaustic, coreCol, coreGrazingAA);
            interiorColor += vec3(0.95, 1.0, 0.90) * glassBubbles * 0.40;
        } else {
            // 2. Unified Dark-Centered Octane Glass & Pitch-Black Circular Window Interior:
            //    Zero seam between Window 2 and the Bridge, or between Window 5 and the Upper Glass Dome!
            interiorColor = vec3(0.0004, 0.0006, 0.0004);

            // Physical RGB Chromatic Dispersion Refraction of Behind-Glass HUD & Typography through clear glass
            vec2 refrOffset = (rdIn.xy - rd.xy) * (0.16 + 0.22 * clamp(glassThickness, 0.0, 0.6));
            vec2 baseBackUv = vec2(screenUv.x, 1.0 - screenUv.y) + vec2(refrOffset.x, -refrOffset.y);
            vec2 dispShift = vec2(refrOffset.x, -refrOffset.y) * (0.18 * uGlassDispersion);
            float bR = texture(uTextBackTex, clamp(baseBackUv + dispShift, 0.0, 1.0)).r;
            vec4  bG = texture(uTextBackTex, clamp(baseBackUv, 0.0, 1.0));
            float bB = texture(uTextBackTex, clamp(baseBackUv - dispShift, 0.0, 1.0)).b;
            float transGlass = exp(-glassThickness * 1.40) * (1.0 - smoothstep(0.0, 0.02, -minChamberDist) * 0.65);
            interiorColor = mix(interiorColor, vec3(bR, bG.g, bB) * 0.78, bG.a * transGlass);

            float insideWindow = 1.0 - smoothstep(-0.015, 0.015, minChamberDist);

            // A. Smooth smoky-silver outer glass curvature near grazing angles (left rim of Window 1 & Upper Dome!)
            float grazingGlass = pow(clamp(1.0 - ndv, 0.0, 1.0), 2.8);
            interiorColor += vec3(0.26, 0.29, 0.27) * grazingGlass * 0.32 * insideWindow;

            // B. Signature White C-Shaped Meniscus Reflection on the right side of Window 2
            //    Anchored to Window 2 (blob 11) precomputed animated position so it stays locked during the 15s loop!
            vec3 w11Pos = (uBlobCount > 11)
                ? gAnimPosRad[11].xyz
                : vec3(-0.19, -0.19, 0.14);
            vec2 cCenter = w11Pos.xy + vec2(0.075, 0.005);
            float dRightCrescent = length((pGlass.xy - cCenter) / vec2(0.042, 0.068));
            float cArcRing = smoothstep(0.62, 0.88, dRightCrescent) * (1.0 - smoothstep(0.88, 1.08, dRightCrescent));
            float cArcMain = cArcRing * smoothstep(cCenter.x - 0.010, cCenter.x + 0.025, pGlass.x);

            float dLowerDash = length((pGlass.xy - (w11Pos.xy + vec2(0.052, -0.068))) / vec2(0.022, 0.009));
            float cArcLower = 1.0 - smoothstep(0.45, 1.0, dLowerDash);
            interiorColor += vec3(0.96, 1.0, 0.96) * (cArcMain * 1.30 + cArcLower * 0.88);

            // C. Tiny white micro-bubble ring 'o' inside the upper-left of Window 1 (in ref_01.png!)
            float dRingLeft = abs(length(pGlass.xy - vec2(-0.472, -0.122)) - 0.0065);
            interiorColor += vec3(0.82, 0.88, 0.82) * (1.0 - smoothstep(0.0005, 0.0022, dRingLeft));

            // D. Tight yellow-green internal caustic glow ONLY right along the true green boundary (outside windows!)
            float greenProximity = exp(-max(minGreenDist, 0.0) * 85.0);
            vec3 causticTint = mix(uGreenColor, vec3(0.98, 1.0, 0.28), 0.48);
            interiorColor += causticTint * greenProximity * 0.80 * (1.0 - insideWindow * 0.85);

            // E. Bridge Waist Upper & Lower Hyperbolic Edge Caustics + Inner White Meniscus Lines
            float isBridgeZone = smoothstep(-0.11, -0.04, pGlass.x) * (1.0 - smoothstep(0.14, 0.24, pGlass.x))
                               * (1.0 - smoothstep(0.08, 0.20, abs(pGlass.y + 0.17)));
            if (isBridgeZone > 0.01) {
                float neckEdgeWhite = 1.0 - smoothstep(0.20, 0.56, ndv);
                float neckEdgeLime  = (1.0 - smoothstep(0.30, 0.68, ndv)) * smoothstep(0.12, 0.28, ndv);
                interiorColor += vec3(0.95, 0.99, 0.95) * neckEdgeWhite * isBridgeZone * 0.72;
                interiorColor += causticTint * neckEdgeLime * isBridgeZone * 0.52;
            }

            // F. Warm olive-chartreuse inner glass wall rim on large corner spheres (Top-Right & Bottom-Right spheres!)
            float cornerWall = (1.0 - smoothstep(0.14, 0.34, ndv)) * smoothstep(0.05, 0.14, ndv);
            float isCornerSphere = smoothstep(0.40, 0.56, abs(pGlass.y));
            interiorColor += mix(uGreenDeepColor * 1.4, uGreenColor * 0.68, 0.48) * cornerWall * isCornerSphere * 0.75;

            // Soft diagonal studio reflection patch on Bottom-Right foreground sphere (at (0.245, -0.915) in ref_01.png!)
            if (pGlass.y < -0.52 && pGlass.x > 0.05) {
                vec2 fgUv = uv - vec2(0.245, -0.915);
                vec2 fgRot = vec2(fgUv.x * 0.82 + fgUv.y * 0.57, -fgUv.x * 0.57 + fgUv.y * 0.82);
                float dFgSpot = length(fgRot / vec2(0.036, 0.014));
                interiorColor += vec3(0.95, 0.99, 0.95) * (1.0 - smoothstep(0.35, 1.0, dFgSpot)) * 0.95;
            }

            // G. Small dark-olive 3D internal glass vacuole tucked inside the Top-Right sphere (at (0.465, 0.725) in ref_01.png!)
            if (pGlass.y > 0.50 && pGlass.x > 0.25) {
                vec2 subDropUv = uv - vec2(0.465, 0.725);
                vec2 rotUv = vec2(subDropUv.x * 0.86 + subDropUv.y * 0.50, -subDropUv.x * 0.50 + subDropUv.y * 0.86);
                float dSub = length(rotUv / vec2(0.055, 0.090));
                if (dSub < 1.0) {
                    float leftCrescent  = smoothstep(0.58, 0.92, dSub) * (1.0 - smoothstep(0.86, 1.0, dSub)) * (1.0 - smoothstep(-0.03, 0.02, rotUv.x));
                    float rightRim      = smoothstep(0.76, 0.94, dSub) * (1.0 - smoothstep(0.92, 1.0, dSub)) * smoothstep(-0.01, 0.04, rotUv.x);
                    vec3 subCol = mix(vec3(0.0005, 0.0008, 0.0005), uGreenColor * 0.20, leftCrescent);
                    subCol += vec3(0.22, 0.28, 0.16) * rightRim;
                    float dRing = abs(length(uv - vec2(0.436, 0.768)) - 0.0062);
                    subCol += vec3(0.85, 0.92, 0.82) * (1.0 - smoothstep(0.0006, 0.0024, dRing));
                    interiorColor = mix(interiorColor, subCol, 1.0 - smoothstep(0.85, 1.0, dSub));
                }
            }

            // H. Crisp Double-Wall Glass Meniscus Contour (the bright white/lime inner wall line on the Upper Right Glass Dome!)
            float meniscusBand = (1.0 - smoothstep(0.23, 0.35, ndv)) * smoothstep(0.14, 0.23, ndv);
            interiorColor += mix(vec3(0.92, 0.97, 0.92), causticTint, 0.25) * meniscusBand * (0.48 + 0.35 * uGlassDispersion) * (1.0 - isCornerSphere * 0.75) * (1.0 - insideWindow * 0.75);

            // I. Tiny yellow-green bottom caustic dot + bottom-right inner crescent inside small floating droplets!
            if (glassThickness < 0.14 && minChamberDist > 0.04) {
                float bottomDot = (1.0 - smoothstep(-0.88, -0.58, nGlass.y)) * smoothstep(0.15, 0.52, ndv);
                float innerArc  = smoothstep(0.28, 0.68, nGlass.x - nGlass.y) * (1.0 - smoothstep(0.22, 0.46, ndv)) * smoothstep(0.12, 0.22, ndv);
                interiorColor += causticTint * bottomDot * 0.65;
                interiorColor += vec3(0.95, 0.99, 0.95) * innerArc * 0.75;
            }

            // J. Suspended sparkling white star-dust micro-bubbles inside clear glass & pitch-black windows!
            interiorColor += vec3(0.95, 1.0, 0.94) * glassBubbles * 1.15;
        }

        // Outer Glass Surface Reflections: Rim-Hugging Curved Studio Softbox Crescents + Razor-Sharp Fresnel Rim
        vec3 refl = reflect(rd, nGlass);
        vec3 studioRefl = sampleStudioReflections(refl, ndv);

        // Razor-sharp white + subtle lime outer glass contour rim
        float outerRim = smoothstep(0.30, 0.95, fresnel);
        vec3 rimTint = mix(vec3(0.97, 1.0, 0.97), mix(vec3(1.0), uGreenColor, 0.35), 0.18);

        finalColor = interiorColor;
        finalColor = mix(finalColor, rimTint, clamp(outerRim * 0.86, 0.0, 0.94));
        finalColor += studioRefl;
    }

    // Front Typography / Post Overlay
    vec2 frontUv = vec2(screenUv.x, 1.0 - screenUv.y);
    vec4 frontTxt = texture(uTextFrontTex, clamp(frontUv, 0.0, 1.0));
    finalColor = mix(finalColor, frontTxt.rgb, frontTxt.a);

    // High-contrast Octane S-curve & ACES tone mapping
    finalColor = max(finalColor, 0.0);
    finalColor = (finalColor * (2.51 * finalColor + 0.03)) / (finalColor * (2.43 * finalColor + 0.59) + 0.14);

    // Subtle film dither
    float dither = (hash11( dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime ) - 0.5) / 255.0;
    finalColor += dither;

    fragColor = vec4( pow(clamp(finalColor, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0 );
}
`;
