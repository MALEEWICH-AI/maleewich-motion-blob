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
    float amp = 0.56;
    vec3 q = p;
    for (int i = 0; i < 3; i++) {
        float n = 1.0 - abs(noise3D(q) * 2.0 - 1.0);
        f += amp * (n * n);
        q = mRot * q * 2.08 + vec3(1.7, 3.2, 2.4);
        amp *= 0.46;
    }
    return f;
}

// 4-octave high-frequency granular rock bump height for razor-sharp fractured obsidian/basalt
float fbmRockBump(vec3 p) {
    float f = 0.0;
    float amp = 0.54;
    vec3 q = p;
    for (int i = 0; i < 4; i++) {
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
        float isSmallDroplet = (uBlobPosRad[idx].w < 0.095) ? 1.0 : 0.22;
        offset.x = sin(loopT + p * 1.2) * env * 0.042 * isSmallDroplet;
        offset.y = sin(loopT * 0.5) * sin(loopT * 0.5) * (0.14 * isSmallDroplet) + c1 * 0.018;
    }
    return basePos + offset * amp;
}

vec3 computeSpatialWarp(vec3 p) {
    float phase = (uLoopDuration > 0.1) ? (uTime / uLoopDuration) : (uTime * 0.15915494);
    vec3 a = vec3(p.y * 0.4138 + phase, p.x * 0.3820 - phase + 0.25, (p.x * 0.3501 + p.y * 0.3183) + phase);
    vec3 q = fract(a) * 2.0 - 1.0;
    vec3 w = (q - q * abs(q)) * 4.0;
    return w * vec3(0.0035, 0.0035, 0.0030);
}

// Dedicated Outer Glass SDF (100% static compile-time loop bound — unrolls into direct constant register reads!)
float mapGlassOnly(vec3 p) {
    // Tight 3D bounding box check: skips the 16-blob loop completely when ray is outside the blob cluster!
    vec3 boxD = abs(p) - vec3(0.66, 0.94, 0.40);
    float dBox = max(boxD.x, max(boxD.y, boxD.z));
    if (dBox > 0.04) {
        return dBox;
    }

    float dGlass = 1e5;
    vec3 warp = computeSpatialWarp(p);

    vec4 meta1 = uBlobMeta[1];
    vec4 anim1 = uBlobAnimPosRad[1];
    if (anim1.w > 0.001 && anim1.w < 0.135 && meta1.x < 0.5) {
        vec2 br = sdHyperbolicBridge(p + warp * 0.35, uBlobAnimPosRad[0].xyz, anim1.xyz, uBlobAnimPosRad[2].xyz, anim1.w, meta1.y);
        dGlass = br.x;
    }

    for (int i = 0; i < MAX_BLOBS; i++) {
        vec4 meta = uBlobMeta[i];
        float type = meta.x;
        vec4 anim = uBlobAnimPosRad[i];
        float rOuter = anim.w;
        if (rOuter > 0.001 && type < 1.5 && !(type < 0.5 && rOuter < 0.135)) {
            vec3 pWarped = p + warp * clamp(meta.z, 0.0, 1.0);
            bool isSeparateSphere = (type > 0.5 && (rOuter < 0.095 || rOuter > 0.31)) || (type < 0.5 && meta.y < 0.05);
            float k = isSeparateSphere ? 0.006 : uSmoothGlass;
            float dg = length(pWarped - anim.xyz) - rOuter;
            dGlass = smin(dGlass, dg, k);
        }
    }

    return dGlass;
}

// Dedicated Circular Window Aperture SDF (Static loop bound!)
float mapChamberOnly(vec3 p) {
    float dChamber = 1e5;
    vec3 warp = computeSpatialWarp(p);

    for (int i = 0; i < MAX_BLOBS; i++) {
        vec4 meta = uBlobMeta[i];
        vec4 anim = uBlobAnimPosRad[i];
        if (anim.w > 0.001 && meta.x > 2.5 && meta.x < 3.5) {
            vec3 dVec = (p + warp * clamp(meta.z, 0.0, 1.0)) - anim.xyz;
            dVec.z *= 0.10;
            float dc = length(dVec) - anim.w;
            dChamber = min(dChamber, dc);
        }
    }
    return dChamber;
}

// Dedicated Inner Green Core Envelope SDF (Static loop bound!)
float mapGreenOnly(vec3 p) {
    float dGreenRaw = 1e5;
    vec3 warp = computeSpatialWarp(p);

    vec4 meta1 = uBlobMeta[1];
    vec4 anim1 = uBlobAnimPosRad[1];
    if (anim1.w > 0.001 && anim1.w < 0.135 && meta1.x < 0.5 && meta1.y > 0.60) {
        vec2 br = sdHyperbolicBridge(p + warp * 0.35, uBlobAnimPosRad[0].xyz, anim1.xyz, uBlobAnimPosRad[2].xyz, anim1.w, meta1.y);
        dGreenRaw = br.y;
    }

    for (int i = 0; i < MAX_BLOBS; i++) {
        vec4 meta = uBlobMeta[i];
        float type = meta.x;
        vec4 anim = uBlobAnimPosRad[i];
        float rOuter = anim.w;
        if (rOuter > 0.001) {
            vec3 pWarped = p + warp * clamp(meta.z, 0.0, 1.0);
            if (type < 0.5 && rOuter >= 0.135 && meta.y > 0.04) {
                vec4 grAnim = uBlobGreenPosRad[i];
                float dgr = length(pWarped - grAnim.xyz) - grAnim.w;
                dGreenRaw = smin(dGreenRaw, dgr, uSmoothGreen * 1.05);
            } else if (type > 1.5 && type < 2.5) {
                float dgr = length(pWarped - anim.xyz) - rOuter;
                dGreenRaw = smin(dGreenRaw, dgr, uSmoothGreen * 1.05);
            }
        }
    }

    return dGreenRaw;
}

// Fused Single-Loop Interior SDF (100% static compile-time loop bound!)
vec3 mapBlobsFull(vec3 p) {
    float dGlass = 1e5;
    float dGreenRaw = 1e5;
    float dChamber = 1e5;
    vec3 warp = computeSpatialWarp(p);

    vec4 meta1 = uBlobMeta[1];
    vec4 anim1 = uBlobAnimPosRad[1];
    if (anim1.w > 0.001 && anim1.w < 0.135 && meta1.x < 0.5) {
        vec2 br = sdHyperbolicBridge(p + warp * 0.35, uBlobAnimPosRad[0].xyz, anim1.xyz, uBlobAnimPosRad[2].xyz, anim1.w, meta1.y);
        dGlass = br.x;
        if (meta1.y > 0.60) {
            dGreenRaw = br.y;
        }
    }

    for (int i = 0; i < MAX_BLOBS; i++) {
        vec4 meta = uBlobMeta[i];
        float type = meta.x;
        vec4 anim = uBlobAnimPosRad[i];
        float rOuter = anim.w;
        if (rOuter > 0.001 && type < 3.5) {
            vec3 pWarped = p + warp * clamp(meta.z, 0.0, 1.0);
            if (type > 2.5) {
                vec3 dVec = pWarped - anim.xyz;
                dVec.z *= 0.10;
                dChamber = min(dChamber, length(dVec) - rOuter);
            } else if (type > 1.5) {
                dGreenRaw = smin(dGreenRaw, length(pWarped - anim.xyz) - rOuter, uSmoothGreen * 1.05);
            } else if (type > 0.5) {
                float k = (rOuter < 0.095 || rOuter > 0.31) ? 0.006 : uSmoothGlass;
                dGlass = smin(dGlass, length(pWarped - anim.xyz) - rOuter, k);
            } else if (rOuter >= 0.135) {
                float greenRatio = meta.y;
                float k = (greenRatio < 0.05) ? 0.006 : uSmoothGlass;
                dGlass = smin(dGlass, length(pWarped - anim.xyz) - rOuter, k);
                if (greenRatio > 0.04) {
                    vec4 grAnim = uBlobGreenPosRad[i];
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

    // Fast height & Z-slab bounding checks: skip 3D noise completely outside the rock volume!
    if (p.y > uRockHeight + 0.18) {
        return p.y - (uRockHeight + 0.10);
    }
    if (p.z > 0.24) {
        return max(p.z - 0.20, (p.y - (uRockHeight + 0.10)) * 0.75);
    }

    float ridgeH = getRockRidgeHeight(p.x);

    // Steep 3D boulder/cliff in Z:
    float zFrontDrop = 1.55 * max(p.z - 0.02, 0.0);
    float zBackDrop  = 0.90 * max(-0.02 - p.z, 0.0);
    float baseHeight = ridgeH - zFrontDrop - zBackDrop;

    float dApprox = p.y - baseHeight;
    if (dApprox > 0.18) return dApprox * 0.75;

    // Clean angular macro rock blocks (fine granular crags are added in shadeRock via 4-octave bump!)
    vec3 rp = p * 4.8 + vec3(1.4, 0.8, 2.3);
    float macroBlocks = fbmRidgedRock(rp);
    float midCrags    = 1.0 - abs(noise3D(p * 11.5 + vec3(3.1, 1.7, 0.9)) * 2.0 - 1.0);

    float displacement = (macroBlocks * 0.064 + midCrags * midCrags * 0.022) * uRockRoughness;

    return (p.y - (baseHeight + displacement)) * 0.58;
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
    // 1. Studio backdrop (supports both deep Octane black and bright editorial light backdrops)
    float glow = exp(-length(screenUv - vec2(0.62, 0.42)) * 1.85);
    float glowLum = dot(uBgGlowColor, vec3(0.299, 0.587, 0.114));
    float topLum  = dot(uBgTopColor, vec3(0.299, 0.587, 0.114));
    // If user brightened uBgGlowColor while uBgTopColor remained near-black, smoothly lift base backdrop too
    vec3 effectiveTop = (glowLum > 0.12 && topLum < 0.02)
        ? mix(uBgTopColor, uBgGlowColor * 0.72, smoothstep(0.12, 0.55, glowLum))
        : uBgTopColor;
    float glowStrength = mix(0.45, 0.82, smoothstep(0.05, 0.40, glowLum));
    vec3 bg = mix(effectiveTop, uBgGlowColor, clamp(glow * glowStrength, 0.0, 1.0));

    // 2. Out-of-focus (DOF blurred) diagonal background rock ridge (bounded to rock Y-band for speed)
    if (uRockEnabled > 0.5 && uv.y < uRockHeight + 0.22) {
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

    // Ultra-fine mineral grain normal perturbation (forward differences)
    vec3 pGrain = p * 240.0;
    float g0 = noise3D(pGrain);
    vec3 grainN = vec3(
        noise3D(pGrain + vec3(0.15, 0.0, 0.0)) - g0,
        noise3D(pGrain + vec3(0.0, 0.15, 0.0)) - g0,
        noise3D(pGrain + vec3(0.0, 0.0, 0.15)) - g0
    );
    n = normalize(n + grainN * 0.45);

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
        vec3 neonMoss = clamp(mix(uGreenColor * 1.32, vec3(1.0), 0.18), 0.0, 1.0);
        col = mix(col, neonMoss * (0.60 + 0.65 * diffKey), clamp(mossTotal * uMossIntensity, 0.0, 1.0));
    }

    return col;
}

// Pure-float technical micro-stamp (zero integer bitshifts, zero loops — preserves full GPU occupancy!)
float evalCoreMicroStamp(vec2 d, float style) {
    if (abs(d.x) > 0.24 || abs(d.y) > 0.075) return 0.0;

    float m = 0.0;

    // 1. Miniature Technical Icon on the left (d.x around -0.155)
    vec2 ip = (d - vec2(-0.155, 0.004)) / 0.030;
    if (abs(ip.x) < 1.35 && abs(ip.y) < 1.35) {
        const float aa = 0.11;
        float dRing = abs(length(ip) - 0.68) - 0.09;
        float dCross = min(
            max(abs(ip.x) - 1.05, abs(ip.y) - 0.09),
            max(abs(ip.y) - 1.05, abs(ip.x) - 0.09)
        );
        dCross = max(dCross, -(length(ip) - 0.42));
        float dDot = length(ip) - 0.16;
        float dIcon0 = min(min(dRing, dCross), dDot);

        float dBox = abs(max(abs(ip.x) - 0.88, abs(ip.y) - 0.72)) - 0.10;
        dBox = max(dBox, -min(abs(ip.x) - 0.42, abs(ip.y) - 0.32));
        float dPlus = min(
            max(abs(ip.x) - 0.35, abs(ip.y) - 0.09),
            max(abs(ip.y) - 0.35, abs(ip.x) - 0.09)
        );
        float dIcon1 = min(dBox, dPlus);

        float dIcon = (style < 0.5) ? dIcon0 : dIcon1;
        m = max(m, 1.0 - smoothstep(0.0, aa, dIcon));
    }

    // 2. Crisp segmented technical code blocks & micro-barcode to the right of the icon
    vec2 txtUv = (d - vec2(-0.095, -0.018)) / vec2(0.24, 0.044);
    if (txtUv.x >= 0.0 && txtUv.x <= 1.0 && txtUv.y >= 0.0 && txtUv.y <= 1.0) {
        vec2 grid = txtUv * vec2(18.0, 3.0);
        vec2 id = floor(grid);
        vec2 sub = fract(grid) - 0.5;
        float h = fract(sin(dot(id + style * 7.0, vec2(12.9898, 78.233))) * 43758.5453);
        float cellOn = step(0.32, h) * step(0.15, abs(txtUv.x - 0.44) + 0.12);
        float box = 1.0 - smoothstep(0.28, 0.42, max(abs(sub.x), abs(sub.y)));
        m = max(m, cellOn * box * 0.92);
    }

    // 3. Thin technical underline & end tick under the label
    float dLine = max(abs(d.x - 0.015) - 0.135, abs(d.y + 0.034) - 0.0028);
    float dTick = max(abs(d.x - 0.150) - 0.003, abs(d.y + 0.026) - 0.010);
    m = max(m, (1.0 - smoothstep(0.0, 0.0030, min(dLine, dTick))) * 0.72);

    return m;
}

// Sparse Technical Micro-Markings & Icons on the 3D Core Texture (Zero loops, zero ints!)
vec2 sampleCoreGreebles(vec3 p, vec3 nGreen, float dChamber) {
    float windowSafe = smoothstep(0.022, 0.052, dChamber);
    if (windowSafe <= 0.001 || nGreen.z < 0.12) return vec2(0.0);

    // Direct 2-sphere check (Left Core Sphere 0 vs Right Core Sphere 2 — zero loops!)
    vec4 b0 = uBlobAnimPosRad[0];
    vec4 b2 = uBlobAnimPosRad[2];
    float r0 = max(b0.w * uBlobMeta[0].y, 0.12);
    float r2 = max(b2.w * uBlobMeta[2].y, 0.12);
    float d0 = length(p - b0.xyz) - r0;
    float d2 = length(p - b2.xyz) - r2;

    bool isRight = (d2 < d0);
    vec3 bestCenter = isRight ? b2.xyz : b0.xyz;
    float bestRad   = isRight ? r2 : r0;
    float style     = isRight ? 1.0 : 0.0;

    vec3 localP = (p - bestCenter) / bestRad;
    vec2 uv = localP.xy + nGreen.xy * 0.08;

    vec2 offsetA = isRight ? vec2(-0.46, 0.34) : vec2(-0.08, 0.56);
    vec2 offsetB = isRight ? vec2(0.06, -0.50)  : vec2(-0.02, -0.26);

    float stampMask = max(
        evalCoreMicroStamp((uv - offsetA) * 0.92, style),
        evalCoreMicroStamp((uv - offsetB) * 0.95, 1.0 - style)
    );

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

// Shade Perforated Smooth Bio-Core Shell (Rich 3D Octane Subsurface Scattering + Core Surface Markings + Hue-Adaptive Bevel Lip)
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

    // Analytical subsurface scattering term (avoids redundant 16-blob mapGreenOnly probe!)
    float sss = 0.25 + 0.55 * (1.0 - smoothstep(0.0, 0.08, dChamber));

    // Derive highlight, midtone, and deep shadow 100% from uGreenColor & uGreenDeepColor (no hardcoded yellow-green!)
    float maxCh = max(max(uGreenColor.r, uGreenColor.g), max(uGreenColor.b, 0.001));
    vec3 normHue = uGreenColor / maxCh;
    vec3 topHighlightCol = clamp(uGreenColor * 1.42 + normHue * 0.14 + vec3(0.08), 0.0, 1.0);
    vec3 midToneCol      = uGreenColor * 0.82;
    // Blend uGreenDeepColor with uGreenColor so hole rims & shadows ALWAYS visibly shift hue with uGreenColor!
    vec3 deepShadowCol   = mix(uGreenDeepColor * 0.35, uGreenColor * 0.24, 0.72);

    vec3 col = mix(deepShadowCol, midToneCol, smoothstep(0.02, 0.58, wrapDiff));
    float topHighlight = pow(wrapDiff, 2.2) * smoothstep(-0.08, 0.52, nGreen.y);
    col = mix(col, topHighlightCol, clamp(topHighlight * (0.78 + 0.32 * sss), 0.0, 1.0));

    // Apply sparse technical text markings & icons attached to the 3D core surface
    float detailStrength = clamp(uCoreDetail, 0.0, 2.0);
    if (detailStrength > 0.01) {
        vec2 markings = sampleCoreGreebles(p, nGreen, dChamber);
        float m = clamp(markings.x * min(detailStrength, 1.35), 0.0, 1.0);
        if (m > 0.001) {
            col *= (1.0 - m * 0.28);
            vec3 stampInk = mix(vec3(0.96, 0.98, 0.96), topHighlightCol, 0.28);
            col = mix(col, stampInk, m * 0.82);
        }
    }

    float bottomRim = pow(max(dot(nGreen, lightBottom), 0.0), 2.0) * (1.0 - max(dot(nGreen, -rdIn), 0.0));
    col += topHighlightCol * bottomRim * 0.34;

    // Hue-adaptive 3D bevel rim right around each circular window cut (rich subsurface glow in uGreenColor!)
    float bevelBand = 1.0 - smoothstep(0.0, max(uSmoothCavity * 1.15, 0.028), dChamber);
    vec3 holeRimHue = mix(uGreenColor * 0.68, topHighlightCol, 0.38);
    col = mix(col, holeRimHue, bevelBand * 0.52);

    float cutShadow = smoothstep(0.0, 0.014, dChamber);
    float outerLip  = smoothstep(0.004, 0.018, dChamber) * (1.0 - smoothstep(0.018, 0.045, dChamber));
    vec3 innerLipCol = mix(uGreenDeepColor * 0.45, uGreenColor * 0.28, 0.75);
    col = mix(innerLipCol, col, 0.22 + 0.78 * cutShadow);
    col += topHighlightCol * outerLip * 0.26;

    return col;
}

void main() {
    // Normalized coordinates centered at (0,0), Y in [-1, 1]
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / (0.5 * uResolution.y);
    uv = uv / max(uCamZoom, 0.2) - uCamPan;

    vec2 screenUv = gl_FragCoord.xy / uResolution.xy;

    // Camera setup: focal length = ro.z = 2.50 so z=0 plane maps 1:1 to uv coordinates
    vec3 ro = vec3(0.0, 0.0, 2.50);
    vec3 rd = normalize(vec3(uv, -2.50));

    // 1. Primary Raymarch: Start directly at front of scene Z-slab (z = 0.40) and end at back (z = -0.42)
    float invRdZ = 1.0 / max(-rd.z, 0.2);
    float t = max(0.0, (2.50 - 0.40) * invRdZ);
    float tPrev = t;
    float dPrev = 0.0;
    float tMax = (2.50 + 0.42) * invRdZ;
    int hitType = 0; // 0 = Background, 1 = Glass Blob, 2 = Rock

    for (int i = 0; i < 38; i++) {
        vec3 p = ro + rd * t;
        float dG = mapGlassOnly(p);
        float dR = mapRock(p);
        float d = min(dG, dR);

        if (d < 0.0010) {
            // 1-step secant surface refinement for ultra-smooth silhouette & normal precision
            if (i > 0 && (dPrev - d) > 1e-5) {
                t = mix(tPrev, t, clamp(dPrev / (dPrev - d), 0.0, 1.0));
            }
            hitType = (dG <= dR) ? 1 : 2;
            break;
        }
        tPrev = t;
        dPrev = d;
        t += d * 0.90;
        if (t > tMax) break;
    }

    vec3 finalColor = vec3(0.0);

    if (hitType == 0) {
        finalColor = sampleBackgroundWithDOF(uv, screenUv, true);
    } else if (hitType == 2) {
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

        // March inside the glass volume using fast mapInternalCoreAndChamber (skips all outer glass smin calls!)
        float tIn = 0.006;
        int internalHit = 0; // 0 = Unified Pitch-Black Window / Clear Dark Glass, 1 = Acid-Green Core
        float tHitIn = 0.0;
        float dChAtHit = 1e5;
        float minGreenDist = 1e5;
        float minChamberDist = 1e5;
        float glassThickness = 0.16;

        vec3 pEnter = pGlass - nGlass * 0.0020;
        float tInPrev = tIn;
        float dGrPrev = 1e5;

        for (int j = 0; j < 28; j++) {
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
            float stepLen = max(min(max(-dGOut, 0.030), dGr) * 0.80, 0.0055);
            tIn += stepLen;
            glassThickness = tIn;
            if (tIn > 0.85) break;
        }

        // Crisp 3D parallax micro-bubbles suspended inside the glass volume
        float glassBubbles = (uBubbleDensity > 0.01)
            ? (sparkleMicroBubbles(pGlass + rdIn * 0.05, uBubbleDensity)
             + sparkleMicroBubbles(pGlass + rdIn * 0.13, uBubbleDensity * 0.95) * 0.85)
            : 0.0;

        // Hue-adaptive caustic tint derived 100% from uGreenColor
        float maxCh = max(max(uGreenColor.r, uGreenColor.g), max(uGreenColor.b, 0.001));
        vec3 causticTint = clamp(uGreenColor * 1.38 + (uGreenColor / maxCh) * 0.12 + vec3(0.08), 0.0, 1.0);

        // Refracted studio backdrop along rdIn (enables crystal-clear transparent glass on light & colored backgrounds!)
        vec2 refrOffset = (rdIn.xy - rd.xy) * (0.18 + 0.24 * clamp(glassThickness, 0.0, 0.6));
        vec2 refrScreenUv = clamp(screenUv + refrOffset, 0.0, 1.0);
        float glowRefr = exp(-length(refrScreenUv - vec2(0.62, 0.42)) * 1.85);
        float glowLum  = dot(uBgGlowColor, vec3(0.299, 0.587, 0.114));
        float topLum   = dot(uBgTopColor, vec3(0.299, 0.587, 0.114));
        vec3 effTop    = (glowLum > 0.12 && topLum < 0.02)
            ? mix(uBgTopColor, uBgGlowColor * 0.72, smoothstep(0.12, 0.55, glowLum))
            : uBgTopColor;
        float glowStr  = mix(0.45, 0.82, smoothstep(0.05, 0.40, glowLum));
        vec3 cleanBackdrop = mix(effTop, uBgGlowColor, clamp(glowRefr * glowStr, 0.0, 1.0));
        float bgLum = dot(cleanBackdrop, vec3(0.299, 0.587, 0.114));
        float isLightBg = smoothstep(0.02, 0.30, bgLum);

        vec3 interiorColor = vec3(0.0);

        if (internalHit == 1) {
            // 1. Hit the smooth Bio-Core outside the circular apertures!
            vec3 pGr = pEnter + rdIn * tHitIn;
            vec3 nGr = calcNormalGreen(pGr);
            vec3 coreCol = shadeGreenCore(pGr, rdIn, nGr, dChAtHit);
            // Smooth grazing silhouette anti-aliasing where the internal core curves away into clear glass
            float coreGrazingAA = smoothstep(0.02, 0.22, max(dot(nGr, -rdIn), 0.0));
            vec3 edgeCaustic = mix(cleanBackdrop * 0.85 + vec3(0.0004, 0.0006, 0.0004), causticTint * 0.75, 0.72);
            interiorColor = mix(edgeCaustic, coreCol, coreGrazingAA);
            interiorColor += vec3(0.95, 1.0, 0.94) * glassBubbles * 0.40;
        } else {
            vec3 refrBg = cleanBackdrop * mix(0.08, 1.0, isLightBg);
            // 2. Unified Refractive Glass & Circular Window Interior:
            //    On dark backgrounds (refrBg ~ 0), stays deep Octane black;
            //    On light/colored backgrounds, transmits bright, crystal-clear refracted studio backdrop!
            float insideWindow = 1.0 - smoothstep(-0.015, 0.015, minChamberDist);

            // Luminous crystal-clear glass lens transmittance on light backgrounds (never dark or smoky!)
            float lensEdge = smoothstep(0.02, 0.24, ndv);
            float clearGlassTrans = mix(0.92, 1.04, lensEdge);
            float windowTrans = mix(0.18, 0.92, isLightBg);
            vec3 glassTint = mix(vec3(1.0), clamp(uGreenColor * 0.55 + vec3(0.65), 0.0, 1.0), 0.18 * (1.0 - lensEdge));
            vec3 transmittedBg = refrBg * glassTint * clearGlassTrans * mix(1.0, windowTrans, insideWindow);

            interiorColor = max(transmittedBg, vec3(0.0004, 0.0006, 0.0004));

            // Physical RGB Chromatic Dispersion Refraction of Behind-Glass HUD & Typography through clear glass
            vec2 baseBackUv = vec2(screenUv.x, 1.0 - screenUv.y) + vec2(refrOffset.x, -refrOffset.y);
            vec2 dispShift = vec2(refrOffset.x, -refrOffset.y) * (0.18 * uGlassDispersion);
            float bR = texture(uTextBackTex, clamp(baseBackUv + dispShift, 0.0, 1.0)).r;
            vec4  bG = texture(uTextBackTex, clamp(baseBackUv, 0.0, 1.0));
            float bB = texture(uTextBackTex, clamp(baseBackUv - dispShift, 0.0, 1.0)).b;
            float transGlass = exp(-glassThickness * 1.40) * (1.0 - smoothstep(0.0, 0.02, -minChamberDist) * 0.65);
            interiorColor = mix(interiorColor, vec3(bR, bG.g, bB) * 0.78, bG.a * transGlass);

            // A. Smooth smoky-silver outer glass curvature near grazing angles (left rim of Window 1 & Upper Dome!)
            float grazingGlass = pow(clamp(1.0 - ndv, 0.0, 1.0), 2.8);
            interiorColor += vec3(0.26, 0.29, 0.27) * grazingGlass * 0.32 * insideWindow;

            // B. Signature White C-Shaped Meniscus Reflection on the right side of Window 2
            //    Only rendered when blob 11 is an active window cavity (type > 2.5)
            if (uBlobCount > 11 && uBlobMeta[11].x > 2.5) {
                vec3 w11Pos = uBlobAnimPosRad[11].xyz;
                vec2 cCenter = w11Pos.xy + vec2(0.075, 0.005);
                float dRightCrescent = length((pGlass.xy - cCenter) / vec2(0.042, 0.068));
                float cArcRing = smoothstep(0.62, 0.88, dRightCrescent) * (1.0 - smoothstep(0.88, 1.08, dRightCrescent));
                float cArcMain = cArcRing * smoothstep(cCenter.x - 0.010, cCenter.x + 0.025, pGlass.x);

                float dLowerDash = length((pGlass.xy - (w11Pos.xy + vec2(0.052, -0.068))) / vec2(0.022, 0.009));
                float cArcLower = 1.0 - smoothstep(0.45, 1.0, dLowerDash);
                interiorColor += vec3(0.96, 1.0, 0.96) * (cArcMain * 1.30 + cArcLower * 0.88);
            }

            // C. Tiny white micro-bubble ring 'o' anchored to Window 1 (blob 10) when active
            if (uBlobCount > 10 && uBlobMeta[10].x > 2.5) {
                vec2 ringCenter = uBlobAnimPosRad[10].xy + vec2(-0.012, 0.078);
                float dRingLeft = abs(length(pGlass.xy - ringCenter) - 0.0065);
                interiorColor += vec3(0.82, 0.88, 0.82) * (1.0 - smoothstep(0.0005, 0.0022, dRingLeft));
            }

            // D. Tight hue-adaptive internal caustic glow right along the core boundary (outside windows!)
            float greenProximity = exp(-max(minGreenDist, 0.0) * 85.0);
            interiorColor += causticTint * greenProximity * 0.80 * (1.0 - insideWindow * 0.85);

            // E. Bridge Waist Upper & Lower Hyperbolic Edge Caustics + Inner White Meniscus Lines
            vec2 bridgeCenter = (uBlobCount > 1) ? uBlobAnimPosRad[1].xy : vec2(0.0, -0.17);
            float isBridgeZone = (1.0 - smoothstep(0.08, 0.22, abs(pGlass.x - bridgeCenter.x)))
                               * (1.0 - smoothstep(0.08, 0.20, abs(pGlass.y - bridgeCenter.y)));
            if (isBridgeZone > 0.01) {
                float neckEdgeWhite = 1.0 - smoothstep(0.20, 0.56, ndv);
                float neckEdgeLime  = (1.0 - smoothstep(0.30, 0.68, ndv)) * smoothstep(0.12, 0.28, ndv);
                interiorColor += vec3(0.95, 0.99, 0.95) * neckEdgeWhite * isBridgeZone * 0.72;
                interiorColor += causticTint * neckEdgeLime * isBridgeZone * 0.52;
            }

            // F. Hue-adaptive inner glass wall rim on large corner spheres
            float cornerWall = (1.0 - smoothstep(0.14, 0.34, ndv)) * smoothstep(0.05, 0.14, ndv);
            float isCornerSphere = smoothstep(0.40, 0.56, abs(pGlass.y));
            vec3 deepCornerHue = mix(uGreenDeepColor, uGreenColor * 0.18, 0.55);
            interiorColor += mix(deepCornerHue * 1.4, uGreenColor * 0.68, 0.48) * cornerWall * isCornerSphere * 0.75;

            // Soft diagonal studio reflection patch anchored to lower corner glass sphere (blob 6)
            if (uBlobCount > 6 && uBlobMeta[6].y < 0.05) {
                vec2 b6Pos = uBlobAnimPosRad[6].xy;
                if (length(pGlass.xy - b6Pos) < uBlobAnimPosRad[6].w * 1.05) {
                    vec2 fgUv = pGlass.xy - (b6Pos + vec2(-0.145, 0.025));
                    vec2 fgRot = vec2(fgUv.x * 0.82 + fgUv.y * 0.57, -fgUv.x * 0.57 + fgUv.y * 0.82);
                    float dFgSpot = length(fgRot / vec2(0.036, 0.014));
                    interiorColor += vec3(0.95, 0.99, 0.95) * (1.0 - smoothstep(0.35, 1.0, dFgSpot)) * 0.95;
                }
            }

            // G. Small 3D internal glass vacuole anchored inside upper corner glass sphere (blob 5)
            if (uBlobCount > 5 && uBlobMeta[5].y < 0.05) {
                vec2 b5Pos = uBlobAnimPosRad[5].xy;
                if (length(pGlass.xy - b5Pos) < uBlobAnimPosRad[5].w * 1.05) {
                    vec2 vacCenter = b5Pos + vec2(0.045, -0.125);
                    vec2 subDropUv = pGlass.xy - vacCenter;
                    vec2 rotUv = vec2(subDropUv.x * 0.86 + subDropUv.y * 0.50, -subDropUv.x * 0.50 + subDropUv.y * 0.86);
                    float dSub = length(rotUv / vec2(0.055, 0.090));
                    if (dSub < 1.0) {
                        float leftCrescent  = smoothstep(0.58, 0.92, dSub) * (1.0 - smoothstep(0.86, 1.0, dSub)) * (1.0 - smoothstep(-0.03, 0.02, rotUv.x));
                        float rightRim      = smoothstep(0.76, 0.94, dSub) * (1.0 - smoothstep(0.92, 1.0, dSub)) * smoothstep(-0.01, 0.04, rotUv.x);
                        vec3 subBase = mix(vec3(0.0005, 0.0008, 0.0005), refrBg * 0.88, isLightBg);
                        vec3 subCol = mix(subBase, uGreenColor * 0.25, leftCrescent);
                        subCol += mix(uGreenColor * 0.32, vec3(0.26), 0.45) * rightRim;
                        float dRing = abs(length(pGlass.xy - (vacCenter + vec2(-0.029, 0.043))) - 0.0062);
                        subCol += vec3(0.88, 0.92, 0.88) * (1.0 - smoothstep(0.0006, 0.0024, dRing));
                        interiorColor = mix(interiorColor, subCol, 1.0 - smoothstep(0.85, 1.0, dSub));
                    }
                }
            }

            // H. Crisp Double-Wall Glass Meniscus Contour
            float meniscusBand = (1.0 - smoothstep(0.23, 0.35, ndv)) * smoothstep(0.14, 0.23, ndv);
            interiorColor += mix(vec3(0.92, 0.97, 0.92), causticTint, 0.28) * meniscusBand * (0.48 + 0.35 * uGlassDispersion) * (1.0 - isCornerSphere * 0.75) * (1.0 - insideWindow * 0.75);

            // I. Bottom caustic dot + bottom-right inner crescent inside small floating droplets!
            if (glassThickness < 0.14 && minChamberDist > 0.04) {
                float bottomDot = (1.0 - smoothstep(-0.88, -0.58, nGlass.y)) * smoothstep(0.15, 0.52, ndv);
                float innerArc  = smoothstep(0.28, 0.68, nGlass.x - nGlass.y) * (1.0 - smoothstep(0.22, 0.46, ndv)) * smoothstep(0.12, 0.22, ndv);
                interiorColor += causticTint * bottomDot * 0.65;
                interiorColor += vec3(0.95, 0.99, 0.95) * innerArc * 0.75;
            }

            // J. Suspended sparkling white star-dust micro-bubbles inside clear glass & windows!
            interiorColor += vec3(0.95, 1.0, 0.95) * glassBubbles * 1.15;
        }

        // Outer Glass Surface Reflections: Rim-Hugging Curved Studio Softbox Crescents + Razor-Sharp Fresnel Rim
        vec3 refl = reflect(rd, nGlass);
        vec3 studioRefl = sampleStudioReflections(refl, ndv);

        // Razor-sharp white + subtle hue-tinted outer glass contour rim
        // On bright backgrounds (bgLum > 0.35), add a delicate optical inner edge right inside the Fresnel rim so bubbles stand out!
        float outerRim = smoothstep(0.30, 0.95, fresnel);
        float darkOpticalEdge = smoothstep(0.12, 0.32, fresnel) * (1.0 - smoothstep(0.32, 0.58, fresnel)) * smoothstep(0.15, 0.65, bgLum);
        vec3 rimTint = mix(vec3(0.97, 1.0, 0.97), mix(vec3(1.0), uGreenColor, 0.35), 0.18);

        finalColor = interiorColor * (1.0 - darkOpticalEdge * 0.26);
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
