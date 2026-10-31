const { VERTEX_SHADER, FRAGMENT_SHADER, PRESETS, BLOB_TYPES, generateRandomComposition, AmbientSynth } = window.BlobStudio;

class MotionBlobStudio {
    constructor() {
        this.glCanvas = document.getElementById('glCanvas');
        this.gizmoCanvas = document.getElementById('gizmoCanvas');
        this.gizmoCtx = this.gizmoCanvas.getContext('2d');

        this.gl = this.glCanvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        });

        if (!this.gl) {
            alert('WebGL2 не поддерживается в вашем браузере.');
            return;
        }

        // Offscreen canvases for typography layers (Back = refracted through glass, Front = crisp overlay)
        this.textBackCanvas = document.createElement('canvas');
        this.textBackCtx = this.textBackCanvas.getContext('2d');
        this.textFrontCanvas = document.createElement('canvas');
        this.textFrontCtx = this.textFrontCanvas.getContext('2d');

        // Studio State
        this.currentPresetId = 'reference';
        this.aspect = '9:16';
        this.renderScale = 1.0;
        this.blobFilter = 'all';
        this.params = {};
        this.blobs = [];
        this.selectedBlobIndex = 0;

        // Pre-allocated uniform typed arrays (zero per-frame GC allocations)
        this.posRadData = new Float32Array(16 * 4);
        this.metaData = new Float32Array(16 * 4);
        this.animPosRadData = new Float32Array(16 * 4);
        this.greenPosRadData = new Float32Array(16 * 4);
        this.typographyDirty = true;

        // Typography State
        this.textConfig = {
            visible: false,
            depth: 'front', // 'front' | 'behind'
            title: 'BIO—SYNTHESIS',
            subtext: 'ORGANICA // VOL. 04',
            fontFamily: 'Syne, sans-serif',
            fontSize: 64,
            subFontSize: 18,
            x: 0.08,
            y: 0.10,
            align: 'left',
            color: '#ffffff',
            opacity: 0.95
        };

        // Motion Tracking HUD Greebles State
        this.hudConfig = {
            enabled: true,
            style: 'bio_telemetry', // 'bio_telemetry' | 'td_tracker' | 'cyber_minimal'
            depth: 'mixed',         // 'mixed' | 'front' | 'behind'
            colorMode: 'mixed',     // 'mixed' | 'acid' | 'white'
            density: 1.0,
            lag: 0.35,
            opacity: 0.90
        };
        this.trackerNodes = [];

        // Playback & Interaction State
        this.isPlaying = true;
        this.currentTime = 0.0;
        this.lastFrameTime = performance.now();
        this.showGizmos = true;
        this.compareMode = false;
        this.hoveredBlobIndex = -1;
        this.draggingBlobIndex = -1;
        this.dragOffset = { x: 0, y: 0 };

        // FPS Counter
        this.frameCount = 0;
        this.fpsLastTime = performance.now();

        // Audio Synthesizer
        this.synth = new AmbientSynth();

        // Video Recording State
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.recordStartTime = 0;
        this.recordTargetDuration = 15;

        this.initWebGL();
        this.loadPreset('reference');
        this.loadStateFromUrlHash();
        this.bindUI();
        this.bindGizmoEvents();

        requestAnimationFrame((t) => this.animate(t));
    }

    loadStateFromUrlHash() {
        try {
            const hash = window.location.hash || '';
            if (hash.startsWith('#s=')) {
                const b64 = decodeURIComponent(hash.slice(3));
                const jsonStr = decodeURIComponent(escape(atob(b64)));
                const data = JSON.parse(jsonStr);
                if (data.params && data.blobs) {
                    this.params = { ...this.params, ...data.params };
                    this.blobs = data.blobs;
                    if (data.textConfig) this.textConfig = { ...this.textConfig, ...data.textConfig };
                    if (data.hudConfig) this.hudConfig = { ...this.hudConfig, ...data.hudConfig };
                    if (data.aspect) this.setAspectRatio(data.aspect);
                    this.selectedBlobIndex = 0;
                    this.trackerNodes = [];
                    this.syncUIFromState();
                    this.renderBlobList();
                    this.syncSelectedBlobUI();
                    this.updateTypographyTextures();
                }
            }
        } catch (err) {
            console.warn('Не удалось прочитать сцену из URL-хэша:', err);
        }
    }

    initWebGL() {
        const gl = this.gl;

        const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader program link error:', gl.getProgramInfoLog(this.program));
        }

        // Fullscreen Quad
        const quadVerts = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1
        ]);

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // Create Textures for Typography Back & Front
        this.texBack = this.createTexture();
        this.texFront = this.createTexture();

        // Cache Uniform Locations
        const uNames = [
            'uResolution', 'uTime', 'uLoopDuration',
            'uBlobCount', 'uBlobPosRad', 'uBlobMeta',
            'uPrecomputedAnim', 'uBlobAnimPosRad', 'uBlobGreenPosRad',
            'uSmoothGlass', 'uSmoothGreen', 'uSmoothCavity',
            'uGlassIOR', 'uGlassDispersion', 'uFresnelIntensity', 'uBubbleDensity', 'uCoreDetail',
            'uGreenColor', 'uGreenDeepColor', 'uBgTopColor', 'uBgGlowColor',
            'uRockEnabled', 'uRockHeight', 'uRockRoughness', 'uMossIntensity',
            'uCamZoom', 'uCamPan', 'uTextBackTex', 'uTextFrontTex'
        ];
        this.uniforms = {};
        uNames.forEach(name => {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        });
    }

    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    createTexture() {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    showToast(message) {
        const toast = document.getElementById('studioToast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('visible');
        }, 2200);
    }

    // Automatically computes a rich deep shadow color from any chosen core hex color
    computeDeepShade(hex) {
        const clean = (hex || '#9be600').replace('#', '');
        const num = parseInt(clean, 16) || 0x9be600;
        const r = Math.round(((num >> 16) & 255) * 0.18);
        const g = Math.round(((num >> 8) & 255) * 0.18);
        const b = Math.round((num & 255) * 0.18);
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    // Returns true when studio background is bright/light so HUD & UI adapt contrast
    isLightBackdrop() {
        const checkHex = (hex) => {
            const clean = (hex || '#020302').replace('#', '');
            const num = parseInt(clean, 16) || 0;
            const r = ((num >> 16) & 255) / 255;
            const g = ((num >> 8) & 255) / 255;
            const b = (num & 255) / 255;
            return (0.299 * r + 0.587 * g + 0.114 * b);
        };
        const lumTop = checkHex(this.params.bgTopColor);
        const lumGlow = checkHex(this.params.bgGlowColor);
        return (lumTop > 0.35 || lumGlow > 0.45);
    }

    syncThemeAccent(hex) {
        if (!hex) return;
        const clean = hex.replace('#', '');
        const num = parseInt(clean, 16) || 0x9be600;
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.15)`);
        document.documentElement.style.setProperty('--border-subtle', `rgba(${r}, ${g}, ${b}, 0.28)`);
        const hGreen = document.getElementById('hexGreenLabel');
        const hDeep = document.getElementById('hexDeepLabel');
        if (hGreen && this.params.greenColor) hGreen.textContent = this.params.greenColor.toUpperCase();
        if (hDeep && this.params.greenDeepColor) hDeep.textContent = this.params.greenDeepColor.toUpperCase();
        const hTop = document.getElementById('hexBgTopLabel');
        const hGlow = document.getElementById('hexBgGlowLabel');
        if (hTop && this.params.bgTopColor) hTop.textContent = this.params.bgTopColor.toUpperCase();
        if (hGlow && this.params.bgGlowColor) hGlow.textContent = this.params.bgGlowColor.toUpperCase();
    }

    setAspectRatio(aspect) {
        this.aspect = aspect;
        const card = document.getElementById('canvasCard');
        let w = 1080;
        let h = 1920;

        if (aspect === '9:16') {
            w = 1080; h = 1920;
            card.style.aspectRatio = '9 / 16';
        } else if (aspect === '4:5') {
            w = 1080; h = 1350;
            card.style.aspectRatio = '4 / 5';
        } else if (aspect === '1:1') {
            w = 1080; h = 1080;
            card.style.aspectRatio = '1 / 1';
        }

        const sel = document.getElementById('aspectSelect');
        if (sel) sel.value = aspect;
        document.querySelectorAll('#aspectBtnGroup .seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.aspect === aspect);
        });

        // Render at selected quality scale (1.0 Full HD 1080p by default, or 1.0 during recording)
        const scale = this.isRecording ? Math.max(this.renderScale, 1.0) : (this.renderScale || 1.0);
        this.glCanvas.width = Math.round(w * scale);
        this.glCanvas.height = Math.round(h * scale);
        this.gizmoCanvas.width = this.glCanvas.width;
        this.gizmoCanvas.height = this.glCanvas.height;

        this.textBackCanvas.width = this.glCanvas.width;
        this.textBackCanvas.height = this.glCanvas.height;
        this.textFrontCanvas.width = this.glCanvas.width;
        this.textFrontCanvas.height = this.glCanvas.height;

        this.typographyDirty = true;
        this.updateTypographyTextures();
    }

    loadPreset(presetId) {
        const preset = PRESETS[presetId] || PRESETS.reference;
        this.currentPresetId = presetId;
        this.params = JSON.parse(JSON.stringify(preset.params));
        this.blobs = JSON.parse(JSON.stringify(preset.blobs));
        this.selectedBlobIndex = 0;

        if (preset.textLayers && preset.textLayers[0]) {
            const t = preset.textLayers[0];
            this.textConfig.visible = t.opacity > 0.05;
            this.textConfig.depth = t.behindGlass ? 'behind' : 'front';
            this.textConfig.title = t.text;
            this.textConfig.subtext = t.subtext;
            this.textConfig.x = t.x;
            this.textConfig.y = t.y;
            this.textConfig.fontSize = t.fontSize;
            this.textConfig.subFontSize = t.subFontSize;
            this.textConfig.align = t.align || 'left';
            this.textConfig.color = t.color || '#ffffff';
            this.textConfig.opacity = t.opacity > 0.05 ? t.opacity : 0.95;
        }

        document.getElementById('aspectSelect').value = preset.aspect || '9:16';
        this.setAspectRatio(preset.aspect || '9:16');

        this.syncUIFromState();
        this.renderBlobList();
        this.syncSelectedBlobUI();
        this.updateTypographyTextures();
    }

    updateTrackerNodes(dt = 0.016) {
        const w = this.textFrontCanvas.width || 810;
        const h = this.textFrontCanvas.height || 1440;
        const lag = Math.min(Math.max(this.hudConfig.lag ?? 0.35, 0.0), 0.92);
        const lerpRate = 1.0 - Math.pow(lag, Math.max(dt * 60.0, 0.25));

        while (this.trackerNodes.length < this.blobs.length) {
            this.trackerNodes.push(null);
        }
        if (this.trackerNodes.length > this.blobs.length) {
            this.trackerNodes.length = this.blobs.length;
        }

        for (let i = 0; i < this.blobs.length; i++) {
            const b = this.blobs[i];
            const animPos = this.getAnimatedBlobPosJS(b, i);
            const pt = this.worldToScreen(animPos.x, animPos.y, animPos.z);
            const screenRad = b.radius * (0.5 * h) * pt.perspective * (this.params.camZoom || 1.0);

            let node = this.trackerNodes[i];
            if (!node) {
                node = {
                    idx: i,
                    tx: pt.x,
                    ty: pt.y,
                    tr: screenRad,
                    prevX: pt.x,
                    prevY: pt.y,
                    vx: 0,
                    vy: 0,
                    speed: 0,
                    wx: animPos.x,
                    wy: animPos.y,
                    wz: animPos.z
                };
                this.trackerNodes[i] = node;
            } else {
                const rawVx = (pt.x - node.prevX) / Math.max(dt, 0.004);
                const rawVy = (pt.y - node.prevY) / Math.max(dt, 0.004);
                node.vx = node.vx * 0.82 + rawVx * 0.18;
                node.vy = node.vy * 0.82 + rawVy * 0.18;
                node.speed = Math.hypot(node.vx, node.vy);

                node.tx += (pt.x - node.tx) * lerpRate;
                node.ty += (pt.y - node.ty) * lerpRate;
                node.tr += (screenRad - node.tr) * lerpRate;

                node.prevX = pt.x;
                node.prevY = pt.y;
                node.wx = animPos.x;
                node.wy = animPos.y;
                node.wz = animPos.z;
            }
        }
    }

    renderHudGreebles(ctx, w, h, layer) {
        if (!this.hudConfig.enabled) return;
        if (!this.trackerNodes || this.trackerNodes.length !== this.blobs.length) {
            this.updateTrackerNodes(0.016);
        }

        const scale = h / 1920;
        const density = this.hudConfig.density ?? 1.0;
        const baseAlpha = this.hudConfig.opacity ?? 0.90;
        const style = this.hudConfig.style || 'bio_telemetry';
        const colorMode = this.hudConfig.colorMode || 'mixed';

        const acidColor = this.params.greenColor || '#9be600';
        const whiteColor = this.isLightBackdrop() ? '#121814' : '#f4f7f4';
        const accentCol = (colorMode === 'white') ? whiteColor : acidColor;
        const lineCol = (colorMode === 'acid') ? acidColor : whiteColor;

        const isBackLayer = (layer === 'back');
        const isMixed = (this.hudConfig.depth === 'mixed');

        ctx.save();

        // Helper: draw tiny precision target reticle (circle + cardinal crosshair ticks) like in reference image
        const drawTargetReticle = (x, y, rad, col, alpha) => {
            ctx.save();
            ctx.strokeStyle = col;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = Math.max(0.9, 1.15 * scale);

            // Small inner ring
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.stroke();

            // Cardinal ticks extending slightly past the ring
            const ext = rad * 1.95;
            ctx.beginPath();
            ctx.moveTo(x - ext, y);
            ctx.lineTo(x + ext, y);
            ctx.moveTo(x, y - ext);
            ctx.lineTo(x, y + ext);
            ctx.stroke();
            ctx.restore();
        };

        // Helper: draw minimalist angled leader line + horizontal shelf + tracked monospaced label
        const drawMinimalLeader = (anchorX, anchorY, dx, dy, shelfLen, label, col, lineAlpha, textAlpha) => {
            const elbowX = anchorX + dx;
            const elbowY = anchorY + dy;
            const dir = dx >= 0 ? 1 : -1;
            const endX = elbowX + dir * shelfLen;

            ctx.save();
            ctx.strokeStyle = col;
            ctx.globalAlpha = lineAlpha;
            ctx.lineWidth = Math.max(0.85, 1.05 * scale);
            ctx.beginPath();
            ctx.moveTo(anchorX, anchorY);
            ctx.lineTo(elbowX, elbowY);
            ctx.lineTo(endX, elbowY);
            ctx.stroke();

            const fontPx = Math.max(9, Math.round(12.5 * scale));
            ctx.font = `500 ${fontPx}px "JetBrains Mono", monospace`;
            if ('letterSpacing' in ctx) {
                ctx.letterSpacing = '0.12em';
            }
            ctx.fillStyle = col;
            ctx.globalAlpha = textAlpha;
            ctx.textAlign = dir >= 0 ? 'left' : 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, elbowX + dir * (4 * scale), elbowY - 4.5 * scale);
            ctx.restore();
        };

        // 1. BEHIND-GLASS REFRACTIVE CONTOUR DECAL (minimalist curved bracket on the bridge/lobe that refracts through glass)
        if (isBackLayer) {
            const nBridge = this.trackerNodes[1] || this.trackerNodes[0];
            const nRight = this.trackerNodes[2] || this.trackerNodes[0];
            if (nBridge && nRight) {
                const cx = nBridge.tx * 0.45 + nRight.tx * 0.55;
                const cy = nBridge.ty * 0.65 + nRight.ty * 0.35;
                const rOuter = Math.max(nBridge.tr * 0.88, 64 * scale);

                ctx.save();
                ctx.translate(cx, cy);
                ctx.strokeStyle = accentCol;
                ctx.globalAlpha = baseAlpha * 0.65;
                ctx.lineWidth = Math.max(1.8, 3.0 * scale);

                // Sleek curved contour bracket on the right neck (refracted by the glass bridge)
                ctx.beginPath();
                ctx.arc(0, 0, rOuter, Math.PI * 0.68, Math.PI * 1.32);
                ctx.stroke();

                // Thin inner arc with 3 tiny radial ticks
                ctx.lineWidth = Math.max(0.9, 1.2 * scale);
                ctx.globalAlpha = baseAlpha * 0.42;
                ctx.beginPath();
                ctx.arc(0, 0, rOuter * 0.68, Math.PI * 0.72, Math.PI * 1.28);
                ctx.stroke();

                for (let k = -1; k <= 1; k++) {
                    const ang = Math.PI + k * 0.22;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(ang) * (rOuter * 0.62), Math.sin(ang) * (rOuter * 0.62));
                    ctx.lineTo(Math.cos(ang) * (rOuter * 0.72), Math.sin(ang) * (rOuter * 0.72));
                    ctx.stroke();
                }
                ctx.restore();
            }

            // If we are in 'mixed' mode, only the refractive contour lives on the back layer
            if (isMixed) {
                ctx.restore();
                return;
            }
        }

        // 2. FRONT MINIMALIST TRACKING CALLOUTS (matching reference screenshot: SURFACE / 01, TENSION / 02, SAT / 01..03)

        // A. Primary Left Sphere -> "SURFACE / 01"
        if (this.trackerNodes[0] && style !== 'cyber_minimal') {
            const n0 = this.trackerNodes[0];
            const surfX = n0.tx - n0.tr * 0.48;
            const surfY = n0.ty - n0.tr * 0.03;

            drawTargetReticle(surfX, surfY, 4.5 * scale, lineCol, baseAlpha * 0.72);
            drawMinimalLeader(
                surfX + 4 * scale,
                surfY - 4 * scale,
                34 * scale,
                -34 * scale,
                104 * scale,
                'SURFACE / 01',
                lineCol,
                baseAlpha * 0.34,
                baseAlpha * 0.75
            );
        }

        // B. Liquid Bridge Neck -> "TENSION / 02"
        if (this.trackerNodes.length > 2) {
            const n0 = this.trackerNodes[0];
            const n1 = this.trackerNodes[1] || n0;
            const n2 = this.trackerNodes[2];

            // Bridge neck coordinates tracking the live midpoint between left sphere and right cluster
            const neckX = n1.tx + n1.tr * 0.08;
            const neckY = n1.ty - n1.tr * 0.10;

            drawTargetReticle(neckX, neckY, 4.2 * scale, lineCol, baseAlpha * 0.68);

            // Delicate dashed tension caliper arc across the bridge waist
            ctx.save();
            ctx.strokeStyle = lineCol;
            ctx.globalAlpha = baseAlpha * 0.42;
            ctx.lineWidth = Math.max(0.85, 1.05 * scale);
            ctx.setLineDash([3.5 * scale, 3.5 * scale]);
            ctx.beginPath();
            ctx.arc(neckX - 14 * scale, neckY + 8 * scale, 34 * scale, Math.PI * 0.72, Math.PI * 1.28);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            if (style !== 'cyber_minimal') {
                drawMinimalLeader(
                    neckX - 4 * scale,
                    neckY + 4 * scale,
                    -28 * scale,
                    28 * scale,
                    98 * scale,
                    'TENSION / 02',
                    lineCol,
                    baseAlpha * 0.32,
                    baseAlpha * 0.68
                );
            }

            // Optional ultra-thin connection thread if style === 'td_tracker'
            if (style === 'td_tracker' && this.trackerNodes[7]) {
                const nSat = this.trackerNodes[7];
                ctx.save();
                ctx.strokeStyle = lineCol;
                ctx.globalAlpha = baseAlpha * 0.16;
                ctx.lineWidth = Math.max(0.8, 1.0 * scale);
                ctx.setLineDash([4 * scale, 6 * scale]);
                ctx.beginPath();
                ctx.moveTo(n0.tx - n0.tr * 0.48, n0.ty - n0.tr * 0.03);
                ctx.lineTo(neckX, neckY);
                ctx.lineTo(nSat.tx, nSat.ty);
                ctx.stroke();
                ctx.restore();
            }
        }

        // C. Floating Glass Satellite Droplets -> Orbital Arcs + "SAT / 01", "SAT / 02", "SAT / 03"
        const dropletIndices = [];
        for (let i = 0; i < this.blobs.length; i++) {
            if (this.blobs[i].type === 1 && (i >= 7 || this.blobs[i].radius < 0.09)) {
                dropletIndices.push(i);
            }
        }

        // Keep count minimal: 1 to 3 satellites depending on density slider
        const maxSats = Math.max(1, Math.min(dropletIndices.length, Math.round(density * 2.6)));
        for (let s = 0; s < maxSats; s++) {
            const idx = dropletIndices[s];
            const n = this.trackerNodes[idx];
            if (!n) continue;

            const orbR = Math.max(n.tr * 1.32, 18 * scale);
            // Subtle slow rotation tied to droplet movement
            const baseAng = -0.35 + s * 0.45 + Math.sin(this.currentTime * 0.4 + idx) * 0.15;

            ctx.save();
            ctx.strokeStyle = lineCol;

            // 1. Thin partial orbital arc (~200 deg) hugging the droplet
            ctx.globalAlpha = baseAlpha * 0.28;
            ctx.lineWidth = Math.max(0.85, 1.05 * scale);
            ctx.beginPath();
            ctx.arc(n.tx, n.ty, orbR, baseAng - Math.PI * 0.45, baseAng + Math.PI * 0.68);
            ctx.stroke();

            // 2. Slightly brighter short accent arc segment (~38 deg) along the rim
            ctx.globalAlpha = baseAlpha * 0.58;
            ctx.lineWidth = Math.max(1.3, 1.8 * scale);
            ctx.beginPath();
            ctx.arc(n.tx, n.ty, orbR - 1.5 * scale, baseAng + 0.18, baseAng + 0.85);
            ctx.stroke();

            // 3. Single fine radial tick pointing inward toward the droplet center
            const tickAng = baseAng - Math.PI * 0.38;
            ctx.globalAlpha = baseAlpha * 0.28;
            ctx.lineWidth = Math.max(0.8, 1.0 * scale);
            ctx.beginPath();
            ctx.moveTo(n.tx + Math.cos(tickAng) * (orbR * 0.35), n.ty + Math.sin(tickAng) * (orbR * 0.35));
            ctx.lineTo(n.tx + Math.cos(tickAng) * orbR, n.ty + Math.sin(tickAng) * orbR);
            ctx.stroke();
            ctx.restore();

            // 4. Minimalist angled leader callout "SAT / 01" from the right rim of the orbital arc
            const attachAng = 0.12;
            const ax = n.tx + Math.cos(attachAng) * orbR;
            const ay = n.ty + Math.sin(attachAng) * orbR;
            const satNum = String(s + 1).padStart(2, '0');

            drawMinimalLeader(
                ax,
                ay,
                20 * scale,
                -14 * scale,
                74 * scale,
                `SAT / ${satNum}`,
                lineCol,
                baseAlpha * 0.28,
                baseAlpha * 0.48
            );
        }

        // D. Optional extra surface node on right sphere only when density slider is pushed high (> 1.25)
        if (density > 1.25 && this.trackerNodes[2]) {
            const n2 = this.trackerNodes[2];
            const rx = n2.tx - n2.tr * 0.32;
            const ry = n2.ty - n2.tr * 0.36;
            drawTargetReticle(rx, ry, 4.2 * scale, lineCol, baseAlpha * 0.62);
            drawMinimalLeader(
                rx - 4 * scale,
                ry - 4 * scale,
                -26 * scale,
                -22 * scale,
                92 * scale,
                'SURFACE / 02',
                lineCol,
                baseAlpha * 0.28,
                baseAlpha * 0.58
            );
        }

        ctx.restore();
    }

    updateTypographyTextures() {
        const w = this.textBackCanvas.width;
        const h = this.textBackCanvas.height;
        if (!w || !h) return;

        const hudActive = !!(this.hudConfig && this.hudConfig.enabled);
        const textActive = !!this.textConfig.visible;

        const needBack = (hudActive && (this.hudConfig.depth === 'behind' || this.hudConfig.depth === 'mixed')) ||
                         (textActive && this.textConfig.depth === 'behind');
        const needFront = (hudActive && (this.hudConfig.depth === 'front' || this.hudConfig.depth === 'mixed')) ||
                          (textActive && this.textConfig.depth === 'front');

        if (needBack || this.typographyDirty) {
            this.textBackCtx.clearRect(0, 0, w, h);
        }
        if (needFront || this.typographyDirty) {
            this.textFrontCtx.clearRect(0, 0, w, h);
        }

        // 1. Render Motion-Tracking HUD Greebles onto Back and/or Front layers
        if (hudActive) {
            if (this.hudConfig.depth === 'behind') {
                this.renderHudGreebles(this.textBackCtx, w, h, 'back');
            } else if (this.hudConfig.depth === 'front') {
                this.renderHudGreebles(this.textFrontCtx, w, h, 'front');
            } else {
                // 'mixed': refractive contour behind glass + crisp tracking callouts on front
                this.renderHudGreebles(this.textBackCtx, w, h, 'back');
                this.renderHudGreebles(this.textFrontCtx, w, h, 'front');
            }
        }

        // 2. Render Post Typography Layer
        if (textActive) {
            const ctx = (this.textConfig.depth === 'behind') ? this.textBackCtx : this.textFrontCtx;
            const scaleFactor = h / 1920;

            ctx.save();
            ctx.globalAlpha = this.textConfig.opacity;
            ctx.fillStyle = this.textConfig.color;
            ctx.textAlign = this.textConfig.align;
            ctx.textBaseline = 'top';

            const tx = this.textConfig.x * w;
            let ty = this.textConfig.y * h;

            // Subtext / Tag above or below
            if (this.textConfig.subtext.trim()) {
                const subPx = Math.round(this.textConfig.subFontSize * scaleFactor * 1.3);
                ctx.font = `600 ${subPx}px "JetBrains Mono", monospace`;
                ctx.letterSpacing = '0.14em';
                ctx.fillStyle = this.params.greenColor;
                ctx.fillText(this.textConfig.subtext.toUpperCase(), tx, ty);
                ty += subPx * 1.85;
            }

            // Main Headline (supports multi-line)
            ctx.fillStyle = this.textConfig.color;
            const titlePx = Math.round(this.textConfig.fontSize * scaleFactor * 1.35);
            ctx.font = `800 ${titlePx}px ${this.textConfig.fontFamily}`;
            const lines = this.textConfig.title.split('\n');
            lines.forEach((line, idx) => {
                ctx.fillText(line, tx, ty + idx * (titlePx * 1.05));
            });

            ctx.restore();
        }

        const gl = this.gl;
        if (needBack || this.typographyDirty) {
            gl.bindTexture(gl.TEXTURE_2D, this.texBack);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textBackCanvas);
        }

        if (needFront || this.typographyDirty) {
            gl.bindTexture(gl.TEXTURE_2D, this.texFront);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textFrontCanvas);
        }

        this.typographyDirty = false;
    }

    hexToRgbNorm(hex) {
        const clean = hex.replace('#', '');
        const num = parseInt(clean, 16);
        const r = ((num >> 16) & 255) / 255;
        const g = ((num >> 8) & 255) / 255;
        const b = (num & 255) / 255;
        // Convert sRGB to linear for shader lighting accuracy
        return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
    }

    // Mirrors getAnimatedBlobPos + breathing radius + green core offset in shader.js 1:1
    getAnimatedBlobPosJS(blob, idx = 0) {
        const tau = Math.PI * 2.0;
        const loopDur = this.params.loopDuration || 15.0;
        const loopT = (loopDur > 0.1) ? (this.currentTime / loopDur) * tau : this.currentTime;
        const p = blob.animPhase * tau;

        const env = Math.sin(loopT * 0.5);
        const s1 = Math.sin(loopT + p) * env;
        const c1 = Math.cos(loopT + p * 0.85) * env;
        const s2 = Math.sin(loopT * 2.0 + p * 1.3) * env;
        const c2 = Math.cos(loopT * 2.0 + p * 1.1) * env;

        let ox = s1 * 0.016 + c2 * 0.006;
        let oy = c1 * 0.018 + s2 * 0.007;
        let oz = Math.sin(loopT + p * 1.7) * env * 0.008;

        if (blob.type === 3) {
            ox = s1 * 0.018 + c2 * 0.010;
            oy = c1 * 0.020 + s2 * 0.010;
            oz = 0.0;
        } else if (blob.type === 1) {
            const isSmallDroplet = (blob.radius < 0.095) ? 1.0 : 0.22;
            ox = Math.sin(loopT + p * 1.2) * env * 0.042 * isSmallDroplet;
            oy = Math.sin(loopT * 0.5) * Math.sin(loopT * 0.5) * (0.14 * isSmallDroplet) + c1 * 0.018;
        }

        const wx = blob.x + ox * blob.animAmp;
        const wy = blob.y + oy * blob.animAmp;
        const wz = blob.z + oz * blob.animAmp;

        const radMul = 1.0 + 0.012 * blob.animAmp * Math.sin(loopT + blob.animPhase * 6.28318) * env;
        const rGlass = blob.radius * radMul;

        const gx = wx + Math.cos(loopT + blob.animPhase * 6.28) * env * 0.010 * blob.animAmp;
        const gy = wy + Math.sin(loopT + blob.animPhase * 6.28) * env * 0.012 * blob.animAmp;
        const gz = wz;
        const rGreen = rGlass * blob.greenRatio;

        return {
            x: wx,
            y: wy,
            z: wz,
            rGlass,
            gx,
            gy,
            gz,
            rGreen
        };
    }

    // Convert 3D world position to 2D gizmo canvas pixel coordinates
    worldToScreen(wx, wy, wz) {
        const w = this.gizmoCanvas.width;
        const h = this.gizmoCanvas.height;
        const perspective = 2.50 / Math.max(2.50 - wz, 0.2);
        const uvX = (wx * perspective + (this.params.camPanX || 0)) * (this.params.camZoom || 1.0);
        const uvY = (wy * perspective + (this.params.camPanY || 0)) * (this.params.camZoom || 1.0);

        const sx = 0.5 * w + uvX * (0.5 * h);
        const sy = 0.5 * h - uvY * (0.5 * h);
        return { x: sx, y: sy, perspective };
    }

    // Convert 2D screen pixel delta to 3D world X/Y delta
    screenDeltaToWorld(dx, dy, wz) {
        const h = this.gizmoCanvas.height;
        const perspective = 2.50 / Math.max(2.50 - wz, 0.2);
        const zoom = this.params.camZoom || 1.0;
        const scale = (0.5 * h) * perspective * zoom;
        return {
            wx: dx / scale,
            wy: -dy / scale
        };
    }

    renderWebGL() {
        const gl = this.gl;
        const w = this.glCanvas.width;
        const h = this.glCanvas.height;

        gl.viewport(0, 0, w, h);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.uniform2f(this.uniforms.uResolution, w, h);
        gl.uniform1f(this.uniforms.uTime, this.currentTime);
        gl.uniform1f(this.uniforms.uLoopDuration, this.params.loopDuration || 15.0);

        // Pack Blobs & Precomputed Animated Positions into pre-allocated Float32Arrays
        const count = Math.min(this.blobs.length, 16);
        const posRadData = this.posRadData;
        const metaData = this.metaData;
        const animPosRadData = this.animPosRadData;
        const greenPosRadData = this.greenPosRadData;

        for (let i = 0; i < count; i++) {
            const b = this.blobs[i];
            const idx4 = i * 4;
            posRadData[idx4 + 0] = b.x;
            posRadData[idx4 + 1] = b.y;
            posRadData[idx4 + 2] = b.z;
            posRadData[idx4 + 3] = b.radius;

            metaData[idx4 + 0] = b.type;
            metaData[idx4 + 1] = b.greenRatio;
            metaData[idx4 + 2] = b.animAmp;
            metaData[idx4 + 3] = b.animPhase;

            const anim = this.getAnimatedBlobPosJS(b, i);
            animPosRadData[idx4 + 0] = anim.x;
            animPosRadData[idx4 + 1] = anim.y;
            animPosRadData[idx4 + 2] = anim.z;
            animPosRadData[idx4 + 3] = anim.rGlass;

            greenPosRadData[idx4 + 0] = anim.gx;
            greenPosRadData[idx4 + 1] = anim.gy;
            greenPosRadData[idx4 + 2] = anim.gz;
            greenPosRadData[idx4 + 3] = anim.rGreen;
        }

        gl.uniform1i(this.uniforms.uBlobCount, count);
        gl.uniform4fv(this.uniforms.uBlobPosRad, posRadData);
        gl.uniform4fv(this.uniforms.uBlobMeta, metaData);
        gl.uniform1i(this.uniforms.uPrecomputedAnim, 1);
        gl.uniform4fv(this.uniforms.uBlobAnimPosRad, animPosRadData);
        gl.uniform4fv(this.uniforms.uBlobGreenPosRad, greenPosRadData);

        gl.uniform1f(this.uniforms.uSmoothGlass, this.params.smoothGlass);
        gl.uniform1f(this.uniforms.uSmoothGreen, this.params.smoothGreen);
        gl.uniform1f(this.uniforms.uSmoothCavity, this.params.smoothCavity);
        gl.uniform1f(this.uniforms.uGlassIOR, this.params.glassIOR);
        gl.uniform1f(this.uniforms.uGlassDispersion, this.params.glassDispersion);
        gl.uniform1f(this.uniforms.uFresnelIntensity, this.params.fresnelIntensity);
        gl.uniform1f(this.uniforms.uBubbleDensity, this.params.bubbleDensity);
        gl.uniform1f(this.uniforms.uCoreDetail, this.params.coreDetail ?? 1.0);

        const greenRGB = this.hexToRgbNorm(this.params.greenColor);
        const deepRGB = this.hexToRgbNorm(this.params.greenDeepColor);
        const bgTopRGB = this.hexToRgbNorm(this.params.bgTopColor || '#020302');
        const bgGlowRGB = this.hexToRgbNorm(this.params.bgGlowColor || '#121812');

        gl.uniform3fv(this.uniforms.uGreenColor, greenRGB);
        gl.uniform3fv(this.uniforms.uGreenDeepColor, deepRGB);
        gl.uniform3fv(this.uniforms.uBgTopColor, bgTopRGB);
        gl.uniform3fv(this.uniforms.uBgGlowColor, bgGlowRGB);

        gl.uniform1f(this.uniforms.uRockEnabled, this.params.rockEnabled ? 1.0 : 0.0);
        gl.uniform1f(this.uniforms.uRockHeight, this.params.rockHeight);
        gl.uniform1f(this.uniforms.uRockRoughness, this.params.rockRoughness);
        gl.uniform1f(this.uniforms.uMossIntensity, this.params.mossIntensity);

        gl.uniform1f(this.uniforms.uCamZoom, this.params.camZoom || 1.0);
        gl.uniform2f(this.uniforms.uCamPan, this.params.camPanX || 0.0, this.params.camPanY || 0.0);

        // Bind Typography Textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texBack);
        gl.uniform1i(this.uniforms.uTextBackTex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texFront);
        gl.uniform1i(this.uniforms.uTextFrontTex, 1);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    renderGizmos() {
        const ctx = this.gizmoCtx;
        const w = this.gizmoCanvas.width;
        const h = this.gizmoCanvas.height;
        ctx.clearRect(0, 0, w, h);

        if (!this.showGizmos || this.isRecording) return;

        for (let i = 0; i < this.blobs.length; i++) {
            const b = this.blobs[i];
            const animPos = this.getAnimatedBlobPosJS(b, i);
            const pt = this.worldToScreen(animPos.x, animPos.y, animPos.z);
            const screenRad = b.radius * (0.5 * h) * pt.perspective * (this.params.camZoom || 1.0);

            const isSelected = (i === this.selectedBlobIndex);
            const isHovered = (i === this.hoveredBlobIndex);
            const typeMeta = BLOB_TYPES[b.type] || BLOB_TYPES[0];

            ctx.save();

            // Outer radius wireframe guide when selected or hovered
            if (isSelected || isHovered) {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, Math.max(screenRad, 10), 0, Math.PI * 2);
                ctx.strokeStyle = typeMeta.color;
                ctx.lineWidth = isSelected ? 2.0 : 1.2;
                ctx.setLineDash(b.type === 3 ? [5, 5] : [8, 4]);
                ctx.globalAlpha = isSelected ? 0.75 : 0.45;
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Center interactive handle
            ctx.globalAlpha = 0.92;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, isSelected ? 9 : 6.5, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? typeMeta.color : '#101510';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = typeMeta.color;
            ctx.stroke();

            // Label pill when hovered or selected
            if (isSelected || isHovered) {
                ctx.font = '600 12px Inter, sans-serif';
                const label = `${b.name}`;
                const tw = ctx.measureText(label).width;
                const px = pt.x - tw * 0.5 - 7;
                const py = pt.y - 28;

                ctx.fillStyle = 'rgba(8, 12, 8, 0.85)';
                ctx.beginPath();
                ctx.roundRect(px, py, tw + 14, 20, 4);
                ctx.fill();
                ctx.strokeStyle = typeMeta.color;
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.fillText(label, px + 7, py + 14);
            }

            ctx.restore();
        }
    }

    animate(now) {
        const dt = (now - this.lastFrameTime) * 0.001;
        this.lastFrameTime = now;

        const loopDur = this.params.loopDuration || 15.0;

        if (this.isPlaying) {
            this.currentTime = (this.currentTime + dt) % loopDur;
            document.getElementById('timelineScrubber').value = this.currentTime.toFixed(2);
            document.getElementById('timeDisplay').textContent =
                `${this.currentTime.toFixed(1).padStart(4, '0')}s / ${loopDur.toFixed(1)}s`;
        }

        // Handle auto-stop for timed video recording
        if (this.isRecording) {
            const elapsed = (now - this.recordStartTime) * 0.001;
            document.getElementById('recTimer').textContent = `${elapsed.toFixed(1)}s / ${this.recordTargetDuration}s`;
            if (elapsed >= this.recordTargetDuration) {
                this.stopVideoRecording();
            }
        }

        // Update real-time motion tracking nodes & HUD overlay textures only when moving or dirty
        if (this.isPlaying || this.draggingBlobIndex !== -1 || this.typographyDirty) {
            this.updateTrackerNodes(dt);
            if ((this.hudConfig && this.hudConfig.enabled) || this.typographyDirty) {
                this.updateTypographyTextures();
            }
        }

        this.renderWebGL();
        this.renderGizmos();

        // Update FPS badge
        this.frameCount++;
        if (now - this.fpsLastTime >= 500) {
            const fps = Math.round((this.frameCount * 1000) / (now - this.fpsLastTime));
            document.getElementById('fpsCounter').textContent = Math.min(fps, 60);
            this.frameCount = 0;
            this.fpsLastTime = now;
        }

        requestAnimationFrame((t) => this.animate(t));
    }

    bindGizmoEvents() {
        const canvas = this.gizmoCanvas;

        const getCanvasMouse = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

        const findHitBlob = (mx, my) => {
            // Check center handles first
            for (let i = this.blobs.length - 1; i >= 0; i--) {
                const animPos = this.getAnimatedBlobPosJS(this.blobs[i], i);
                const pt = this.worldToScreen(animPos.x, animPos.y, animPos.z);
                const dist = Math.hypot(mx - pt.x, my - pt.y);
                if (dist < 22) return i;
            }
            // Fallback: check within blob radius
            let closestIdx = -1;
            let closestDist = 1e9;
            const h = canvas.height;
            for (let i = this.blobs.length - 1; i >= 0; i--) {
                const b = this.blobs[i];
                const animPos = this.getAnimatedBlobPosJS(b, i);
                const pt = this.worldToScreen(animPos.x, animPos.y, animPos.z);
                const screenRad = b.radius * (0.5 * h) * pt.perspective * (this.params.camZoom || 1.0);
                const dist = Math.hypot(mx - pt.x, my - pt.y);
                if (dist < screenRad * 0.85 && dist < closestDist) {
                    closestDist = dist;
                    closestIdx = i;
                }
            }
            return closestIdx;
        };

        canvas.addEventListener('mousedown', (e) => {
            const m = getCanvasMouse(e);
            const hit = findHitBlob(m.x, m.y);
            if (hit !== -1) {
                this.selectedBlobIndex = hit;
                this.draggingBlobIndex = hit;
                this.lastMouse = m;
                this.renderBlobList();
                this.syncSelectedBlobUI();
            }
        });

        window.addEventListener('mousemove', (e) => {
            const m = getCanvasMouse(e);
            if (this.draggingBlobIndex !== -1) {
                const b = this.blobs[this.draggingBlobIndex];
                const dx = m.x - this.lastMouse.x;
                const dy = m.y - this.lastMouse.y;
                const delta = this.screenDeltaToWorld(dx, dy, b.z);
                b.x = Number((b.x + delta.wx).toFixed(3));
                b.y = Number((b.y + delta.wy).toFixed(3));
                this.lastMouse = m;
                this.syncSelectedBlobUI();
            } else {
                this.hoveredBlobIndex = findHitBlob(m.x, m.y);
                canvas.style.cursor = (this.hoveredBlobIndex !== -1) ? 'grab' : 'crosshair';
            }
        });

        window.addEventListener('mouseup', () => {
            this.draggingBlobIndex = -1;
        });

        // Mouse wheel over a blob scales its radius smoothly
        canvas.addEventListener('wheel', (e) => {
            const m = getCanvasMouse(e);
            const hit = findHitBlob(m.x, m.y);
            const targetIdx = (hit !== -1) ? hit : this.selectedBlobIndex;
            if (targetIdx >= 0 && targetIdx < this.blobs.length) {
                e.preventDefault();
                const b = this.blobs[targetIdx];
                const delta = -e.deltaY * 0.0003;
                b.radius = Number(Math.min(0.50, Math.max(0.02, b.radius + delta)).toFixed(3));
                if (targetIdx !== this.selectedBlobIndex) {
                    this.selectedBlobIndex = targetIdx;
                    this.renderBlobList();
                }
                this.syncSelectedBlobUI();
            }
        }, { passive: false });
    }

    renderBlobList() {
        const container = document.getElementById('blobList');
        document.getElementById('blobCountLabel').textContent = this.blobs.length;
        container.innerHTML = '';

        this.blobs.forEach((b, idx) => {
            if (this.blobFilter !== 'all' && String(b.type) !== String(this.blobFilter)) {
                return;
            }
            const typeMeta = BLOB_TYPES[b.type] || BLOB_TYPES[0];
            const item = document.createElement('div');
            item.className = `blob-item ${idx === this.selectedBlobIndex ? 'selected' : ''}`;
            item.innerHTML = `
                <div class="blob-item-left">
                    <span class="blob-type-dot" style="background:${typeMeta.color}; color:${typeMeta.color}"></span>
                    <span class="blob-item-name">${b.name}</span>
                </div>
                <div class="blob-item-right">
                    <span class="blob-item-badge">${typeMeta.short}</span>
                    <button type="button" class="blob-quick-del" title="Удалить узел">✕</button>
                </div>
            `;
            item.addEventListener('click', (e) => {
                if (e.target.closest('.blob-quick-del')) {
                    e.stopPropagation();
                    if (this.blobs.length <= 1) return;
                    this.blobs.splice(idx, 1);
                    this.selectedBlobIndex = Math.min(this.selectedBlobIndex, this.blobs.length - 1);
                    this.typographyDirty = true;
                    this.renderBlobList();
                    this.syncSelectedBlobUI();
                    return;
                }
                this.selectedBlobIndex = idx;
                this.renderBlobList();
                this.syncSelectedBlobUI();
            });
            container.appendChild(item);
        });
    }

    syncSelectedBlobUI() {
        const b = this.blobs[this.selectedBlobIndex];
        if (!b) return;

        const typeMeta = BLOB_TYPES[b.type] || BLOB_TYPES[0];
        const dotEl = document.getElementById('selectedNodeDot');
        if (dotEl) dotEl.style.background = typeMeta.color;

        document.getElementById('inpBlobName').value = b.name;
        document.getElementById('selBlobType').value = String(b.type);

        document.getElementById('rngBlobRadius').value = b.radius;
        document.getElementById('valBlobRadius').textContent = Number(b.radius).toFixed(3);

        document.getElementById('rngBlobGreen').value = b.greenRatio;
        document.getElementById('valBlobGreen').textContent = Number(b.greenRatio).toFixed(2);
        document.getElementById('grpGreenRatio').style.display = (b.type === 0) ? 'flex' : 'none';

        document.getElementById('rngBlobX').value = b.x;
        document.getElementById('valBlobX').textContent = Number(b.x).toFixed(2);

        document.getElementById('rngBlobY').value = b.y;
        document.getElementById('valBlobY').textContent = Number(b.y).toFixed(2);

        document.getElementById('rngBlobZ').value = b.z;
        document.getElementById('valBlobZ').textContent = Number(b.z).toFixed(2);

        document.getElementById('rngBlobAmp').value = b.animAmp;
        document.getElementById('valBlobAmp').textContent = Number(b.animAmp).toFixed(2);

        document.getElementById('rngBlobPhase').value = b.animPhase;
        document.getElementById('valBlobPhase').textContent = Number(b.animPhase).toFixed(2);
    }

    syncUIFromState() {
        const p = this.params;
        const bindSlider = (id, valId, val, decimals = 2) => {
            const el = document.getElementById(id);
            const vEl = document.getElementById(valId);
            if (el) el.value = val;
            if (vEl) vEl.textContent = Number(val).toFixed(decimals);
        };

        bindSlider('rngSmoothGlass', 'valSmoothGlass', p.smoothGlass);
        bindSlider('rngSmoothGreen', 'valSmoothGreen', p.smoothGreen);
        bindSlider('rngGlassIOR', 'valGlassIOR', p.glassIOR);
        bindSlider('rngGlassDispersion', 'valGlassDispersion', p.glassDispersion);
        bindSlider('rngFresnel', 'valFresnel', p.fresnelIntensity);
        bindSlider('rngBubbles', 'valBubbles', p.bubbleDensity);
        bindSlider('rngCoreDetail', 'valCoreDetail', p.coreDetail ?? 1.0);
        bindSlider('rngRockHeight', 'valRockHeight', p.rockHeight);
        bindSlider('rngRockRoughness', 'valRockRoughness', p.rockRoughness);
        bindSlider('rngMossIntensity', 'valMossIntensity', p.mossIntensity);
        bindSlider('rngCamZoom', 'valCamZoom', p.camZoom || 1.0);

        document.getElementById('chkRockEnabled').checked = !!p.rockEnabled;
        const rockWrap = document.getElementById('rockControlsWrap');
        if (rockWrap) rockWrap.classList.toggle('disabled', !p.rockEnabled);

        document.getElementById('colGreen').value = p.greenColor;
        document.getElementById('colGreenDeep').value = p.greenDeepColor;
        const colBgTop = document.getElementById('colBgTop');
        if (colBgTop) colBgTop.value = p.bgTopColor || '#020302';
        document.getElementById('colBgGlow').value = p.bgGlowColor || '#121812';
        this.syncThemeAccent(p.greenColor);

        // Motion Tracking HUD Greebles UI
        if (this.hudConfig) {
            const hc = this.hudConfig;
            const chkHud = document.getElementById('chkHudEnabled');
            const btnHud = document.getElementById('btnToggleHud');
            if (chkHud) chkHud.checked = !!hc.enabled;
            if (btnHud) btnHud.classList.toggle('active', !!hc.enabled);
            if (document.getElementById('selHudStyle')) document.getElementById('selHudStyle').value = hc.style;
            if (document.getElementById('selHudDepth')) document.getElementById('selHudDepth').value = hc.depth;
            if (document.getElementById('selHudColorMode')) document.getElementById('selHudColorMode').value = hc.colorMode;
            bindSlider('rngHudDensity', 'valHudDensity', hc.density);
            bindSlider('rngHudLag', 'valHudLag', hc.lag);
            bindSlider('rngHudOpacity', 'valHudOpacity', hc.opacity);
        }

        // Typography UI
        const tc = this.textConfig;
        document.getElementById('chkTextVisible').checked = tc.visible;
        document.getElementById('selTextDepth').value = tc.depth;
        document.getElementById('inpPostTitle').value = tc.title;
        document.getElementById('inpPostSub').value = tc.subtext;
        document.getElementById('rngFontSize').value = tc.fontSize;
        document.getElementById('valFontSize').textContent = `${tc.fontSize}px`;
        document.getElementById('rngSubFontSize').value = tc.subFontSize;
        document.getElementById('valSubFontSize').textContent = `${tc.subFontSize}px`;
        document.getElementById('rngTextX').value = tc.x;
        document.getElementById('valTextX').textContent = `${Math.round(tc.x * 100)}%`;
        document.getElementById('rngTextY').value = tc.y;
        document.getElementById('valTextY').textContent = `${Math.round(tc.y * 100)}%`;
        document.getElementById('selTextAlign').value = tc.align;
        document.getElementById('colText').value = tc.color;
        document.getElementById('rngTextOpacity').value = tc.opacity;
        document.getElementById('valTextOpacity').textContent = tc.opacity.toFixed(2);
    }

    bindUI() {
        // Preset & Aspect Controls
        document.getElementById('presetSelect').addEventListener('change', (e) => {
            this.loadPreset(e.target.value);
            this.showToast(`Сцена: ${e.target.options[e.target.selectedIndex].text}`);
        });

        document.getElementById('aspectSelect').addEventListener('change', (e) => {
            this.setAspectRatio(e.target.value);
        });

        document.querySelectorAll('#aspectBtnGroup .seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setAspectRatio(btn.dataset.aspect);
                this.showToast(`Формат холста: ${btn.dataset.aspect}`);
            });
        });

        // Node Filter Pills
        document.querySelectorAll('#blobFilterGroup .filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#blobFilterGroup .filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.blobFilter = pill.dataset.filter;
                this.renderBlobList();
            });
        });

        const selQuality = document.getElementById('selRenderQuality');
        if (selQuality) {
            selQuality.addEventListener('change', (e) => {
                this.renderScale = parseFloat(e.target.value) || 1.0;
                this.setAspectRatio(this.aspect);
                this.showToast(`Качество рендера: ${e.target.options[e.target.selectedIndex].text}`);
            });
        }

        const triggerRandomize = () => {
            this.blobs = generateRandomComposition();
            this.selectedBlobIndex = 0;
            this.trackerNodes = [];
            this.typographyDirty = true;
            this.renderBlobList();
            this.syncSelectedBlobUI();
            this.updateTypographyTextures();
            this.showToast('🎲 Сгенерирована новая композиция');
        };

        document.getElementById('btnRandomize').addEventListener('click', triggerRandomize);

        const syncHudToggleUI = (enabled) => {
            this.hudConfig.enabled = enabled;
            const chk = document.getElementById('chkHudEnabled');
            const btn = document.getElementById('btnToggleHud');
            if (chk) chk.checked = enabled;
            if (btn) btn.classList.toggle('active', enabled);
            this.typographyDirty = true;
            this.updateTypographyTextures();
        };

        const btnToggleHud = document.getElementById('btnToggleHud');
        if (btnToggleHud) {
            btnToggleHud.addEventListener('click', () => {
                syncHudToggleUI(!this.hudConfig.enabled);
            });
        }

        document.getElementById('btnToggleGizmos').addEventListener('click', (e) => {
            this.showGizmos = !this.showGizmos;
            e.currentTarget.classList.toggle('active', this.showGizmos);
        });

        // Side-by-side comparison with motionRef.mp4
        document.getElementById('btnCompareRef').addEventListener('click', (e) => {
            this.compareMode = !this.compareMode;
            e.currentTarget.classList.toggle('active', this.compareMode);
            const refCard = document.getElementById('refCard');
            const refVideo = document.getElementById('refVideo');
            if (this.compareMode) {
                refCard.classList.remove('hidden');
                refVideo.currentTime = this.currentTime % 15.0;
                if (this.isPlaying) refVideo.play();
            } else {
                refCard.classList.add('hidden');
                refVideo.pause();
            }
        });

        // Add / Duplicate / Delete Blobs
        const addBlob = (type, defaultRad, namePrefix) => {
            if (this.blobs.length >= 16) {
                alert('Достигнут максимум 16 узлов для сохранения 60 FPS.');
                return;
            }
            this.blobs.push({
                name: `${namePrefix} ${this.blobs.length + 1}`,
                x: Number(((Math.random() - 0.5) * 0.35).toFixed(2)),
                y: Number(((Math.random() - 0.5) * 0.35).toFixed(2)),
                z: type === 3 ? 0.12 : 0.0,
                radius: defaultRad,
                type,
                greenRatio: type === 0 ? 0.80 : 0.0,
                animAmp: 0.9,
                animPhase: Number(Math.random().toFixed(2))
            });
            this.selectedBlobIndex = this.blobs.length - 1;
            this.renderBlobList();
            this.syncSelectedBlobUI();
        };

        document.getElementById('btnAddDual').addEventListener('click', () => addBlob(0, 0.22, 'Блоб'));
        document.getElementById('btnAddDroplet').addEventListener('click', () => addBlob(1, 0.05, 'Капля'));
        document.getElementById('btnAddCavity').addEventListener('click', () => addBlob(3, 0.115, 'Черная сфера'));

        document.getElementById('btnDuplicateBlob').addEventListener('click', () => {
            if (this.blobs.length >= 16) return;
            const src = this.blobs[this.selectedBlobIndex];
            if (!src) return;
            const copy = JSON.parse(JSON.stringify(src));
            copy.name = `${src.name} (Копия)`;
            copy.x = Number((copy.x + 0.08).toFixed(2));
            copy.y = Number((copy.y + 0.08).toFixed(2));
            this.blobs.push(copy);
            this.selectedBlobIndex = this.blobs.length - 1;
            this.renderBlobList();
            this.syncSelectedBlobUI();
        });

        document.getElementById('btnDeleteBlob').addEventListener('click', () => {
            if (this.blobs.length <= 1) return;
            this.blobs.splice(this.selectedBlobIndex, 1);
            this.selectedBlobIndex = Math.max(0, this.selectedBlobIndex - 1);
            this.renderBlobList();
            this.syncSelectedBlobUI();
        });

        // Selected Blob Inspector Bindings
        document.getElementById('inpBlobName').addEventListener('input', (e) => {
            const b = this.blobs[this.selectedBlobIndex];
            if (b) {
                b.name = e.target.value;
                this.renderBlobList();
            }
        });

        document.getElementById('selBlobType').addEventListener('change', (e) => {
            const b = this.blobs[this.selectedBlobIndex];
            if (b) {
                b.type = parseInt(e.target.value, 10);
                if (b.type === 0 && b.greenRatio < 0.1) b.greenRatio = 0.80;
                this.renderBlobList();
                this.syncSelectedBlobUI();
            }
        });

        const bindBlobProp = (id, valId, prop, decimals = 2) => {
            document.getElementById(id).addEventListener('input', (e) => {
                const b = this.blobs[this.selectedBlobIndex];
                if (!b) return;
                b[prop] = parseFloat(e.target.value);
                document.getElementById(valId).textContent = b[prop].toFixed(decimals);
            });
        };

        bindBlobProp('rngBlobRadius', 'valBlobRadius', 'radius', 3);
        bindBlobProp('rngBlobGreen', 'valBlobGreen', 'greenRatio', 2);
        bindBlobProp('rngBlobX', 'valBlobX', 'x', 2);
        bindBlobProp('rngBlobY', 'valBlobY', 'y', 2);
        bindBlobProp('rngBlobZ', 'valBlobZ', 'z', 2);
        bindBlobProp('rngBlobAmp', 'valBlobAmp', 'animAmp', 2);
        bindBlobProp('rngBlobPhase', 'valBlobPhase', 'animPhase', 2);

        // Right Sidebar Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Material & Rock Sliders
        const bindParamSlider = (id, valId, key, decimals = 2) => {
            document.getElementById(id).addEventListener('input', (e) => {
                this.params[key] = parseFloat(e.target.value);
                document.getElementById(valId).textContent = this.params[key].toFixed(decimals);
            });
        };

        bindParamSlider('rngSmoothGlass', 'valSmoothGlass', 'smoothGlass');
        bindParamSlider('rngSmoothGreen', 'valSmoothGreen', 'smoothGreen');
        bindParamSlider('rngGlassIOR', 'valGlassIOR', 'glassIOR');
        bindParamSlider('rngGlassDispersion', 'valGlassDispersion', 'glassDispersion');
        bindParamSlider('rngFresnel', 'valFresnel', 'fresnelIntensity');
        bindParamSlider('rngBubbles', 'valBubbles', 'bubbleDensity');
        bindParamSlider('rngCoreDetail', 'valCoreDetail', 'coreDetail');
        bindParamSlider('rngRockHeight', 'valRockHeight', 'rockHeight');
        bindParamSlider('rngRockRoughness', 'valRockRoughness', 'rockRoughness');
        bindParamSlider('rngMossIntensity', 'valMossIntensity', 'mossIntensity');
        bindParamSlider('rngCamZoom', 'valCamZoom', 'camZoom');

        document.getElementById('chkRockEnabled').addEventListener('change', (e) => {
            this.params.rockEnabled = e.target.checked;
            const rockWrap = document.getElementById('rockControlsWrap');
            if (rockWrap) rockWrap.classList.toggle('disabled', !e.target.checked);
        });

        // Color Palette Swatches
        document.querySelectorAll('.swatch-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.params.greenColor = btn.dataset.green;
                this.params.greenDeepColor = btn.dataset.deep;
                document.getElementById('colGreen').value = this.params.greenColor;
                document.getElementById('colGreenDeep').value = this.params.greenDeepColor;
                this.syncThemeAccent(this.params.greenColor);
                this.typographyDirty = true;
                this.updateTypographyTextures();
            });
        });

        document.getElementById('colGreen').addEventListener('input', (e) => {
            this.params.greenColor = e.target.value;
            // Automatically compute harmonious deep shadow hue so hole rims & bevels always match!
            this.params.greenDeepColor = this.computeDeepShade(e.target.value);
            document.getElementById('colGreenDeep').value = this.params.greenDeepColor;
            document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
            this.syncThemeAccent(this.params.greenColor);
            this.typographyDirty = true;
            this.updateTypographyTextures();
        });
        document.getElementById('colGreenDeep').addEventListener('input', (e) => {
            this.params.greenDeepColor = e.target.value;
            this.syncThemeAccent(this.params.greenColor);
        });

        // Background Theme Presets (Dark & Light Studio Backdrops)
        document.querySelectorAll('#bgPresetGroup .bg-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#bgPresetGroup .bg-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.params.bgTopColor = pill.dataset.top;
                this.params.bgGlowColor = pill.dataset.glow;
                const colBgTop = document.getElementById('colBgTop');
                if (colBgTop) colBgTop.value = this.params.bgTopColor;
                document.getElementById('colBgGlow').value = this.params.bgGlowColor;
                this.syncThemeAccent(this.params.greenColor);
                this.typographyDirty = true;
                this.updateTypographyTextures();
            });
        });

        const colBgTopEl = document.getElementById('colBgTop');
        if (colBgTopEl) {
            colBgTopEl.addEventListener('input', (e) => {
                this.params.bgTopColor = e.target.value;
                document.querySelectorAll('#bgPresetGroup .bg-pill').forEach(p => p.classList.remove('active'));
                this.syncThemeAccent(this.params.greenColor);
                this.typographyDirty = true;
                this.updateTypographyTextures();
            });
        }

        document.getElementById('colBgGlow').addEventListener('input', (e) => {
            this.params.bgGlowColor = e.target.value;
            document.querySelectorAll('#bgPresetGroup .bg-pill').forEach(p => p.classList.remove('active'));
            this.syncThemeAccent(this.params.greenColor);
            this.typographyDirty = true;
            this.updateTypographyTextures();
        });

        // Double-click any range slider with data-default to reset to default value
        document.querySelectorAll('input[type="range"][data-default]').forEach(slider => {
            slider.addEventListener('dblclick', () => {
                slider.value = slider.dataset.default;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                this.showToast('Ползунок сброшен к стандарту');
            });
        });

        // Global Keyboard Shortcuts (Space = Play/Pause, R = Randomize)
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.code === 'Space') {
                e.preventDefault();
                document.getElementById('btnPlayPause').click();
            } else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                triggerRandomize();
            }
        });

        // Motion Tracking HUD Controls
        const updateText = () => {
            this.typographyDirty = true;
            this.updateTypographyTextures();
        };

        const chkHud = document.getElementById('chkHudEnabled');
        if (chkHud) {
            chkHud.addEventListener('change', (e) => {
                syncHudToggleUI(e.target.checked);
            });
        }
        const selHudStyle = document.getElementById('selHudStyle');
        if (selHudStyle) {
            selHudStyle.addEventListener('change', (e) => {
                this.hudConfig.style = e.target.value;
                updateText();
            });
        }
        const selHudDepth = document.getElementById('selHudDepth');
        if (selHudDepth) {
            selHudDepth.addEventListener('change', (e) => {
                this.hudConfig.depth = e.target.value;
                updateText();
            });
        }
        const selHudColorMode = document.getElementById('selHudColorMode');
        if (selHudColorMode) {
            selHudColorMode.addEventListener('change', (e) => {
                this.hudConfig.colorMode = e.target.value;
                updateText();
            });
        }
        const bindHudSlider = (id, valId, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', (e) => {
                this.hudConfig[key] = parseFloat(e.target.value);
                document.getElementById(valId).textContent = this.hudConfig[key].toFixed(2);
                updateText();
            });
        };
        bindHudSlider('rngHudDensity', 'valHudDensity', 'density');
        bindHudSlider('rngHudLag', 'valHudLag', 'lag');
        bindHudSlider('rngHudOpacity', 'valHudOpacity', 'opacity');

        // Typography Controls

        document.getElementById('chkTextVisible').addEventListener('change', (e) => {
            this.textConfig.visible = e.target.checked;
            updateText();
        });
        document.getElementById('selTextDepth').addEventListener('change', (e) => {
            this.textConfig.depth = e.target.value;
            updateText();
        });
        document.getElementById('inpPostTitle').addEventListener('input', (e) => {
            this.textConfig.title = e.target.value;
            this.textConfig.visible = true;
            document.getElementById('chkTextVisible').checked = true;
            updateText();
        });
        document.getElementById('inpPostSub').addEventListener('input', (e) => {
            this.textConfig.subtext = e.target.value;
            updateText();
        });
        document.getElementById('selFontFamily').addEventListener('change', (e) => {
            this.textConfig.fontFamily = e.target.value;
            updateText();
        });
        document.getElementById('rngFontSize').addEventListener('input', (e) => {
            this.textConfig.fontSize = parseInt(e.target.value, 10);
            document.getElementById('valFontSize').textContent = `${this.textConfig.fontSize}px`;
            updateText();
        });
        document.getElementById('rngSubFontSize').addEventListener('input', (e) => {
            this.textConfig.subFontSize = parseInt(e.target.value, 10);
            document.getElementById('valSubFontSize').textContent = `${this.textConfig.subFontSize}px`;
            updateText();
        });
        document.getElementById('rngTextX').addEventListener('input', (e) => {
            this.textConfig.x = parseFloat(e.target.value);
            document.getElementById('valTextX').textContent = `${Math.round(this.textConfig.x * 100)}%`;
            updateText();
        });
        document.getElementById('rngTextY').addEventListener('input', (e) => {
            this.textConfig.y = parseFloat(e.target.value);
            document.getElementById('valTextY').textContent = `${Math.round(this.textConfig.y * 100)}%`;
            updateText();
        });
        document.getElementById('selTextAlign').addEventListener('change', (e) => {
            this.textConfig.align = e.target.value;
            updateText();
        });
        document.getElementById('colText').addEventListener('input', (e) => {
            this.textConfig.color = e.target.value;
            updateText();
        });
        document.getElementById('rngTextOpacity').addEventListener('input', (e) => {
            this.textConfig.opacity = parseFloat(e.target.value);
            document.getElementById('valTextOpacity').textContent = this.textConfig.opacity.toFixed(2);
            updateText();
        });

        // Timeline & Transport
        const btnPlay = document.getElementById('btnPlayPause');
        btnPlay.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            btnPlay.textContent = this.isPlaying ? '⏸' : '▶';
            const refVideo = document.getElementById('refVideo');
            if (this.compareMode) {
                if (this.isPlaying) refVideo.play();
                else refVideo.pause();
            }
        });

        document.getElementById('timelineScrubber').addEventListener('input', (e) => {
            this.currentTime = parseFloat(e.target.value);
            const loopDur = this.params.loopDuration || 15.0;
            document.getElementById('timeDisplay').textContent =
                `${this.currentTime.toFixed(1).padStart(4, '0')}s / ${loopDur.toFixed(1)}s`;
            const refVideo = document.getElementById('refVideo');
            if (this.compareMode) {
                refVideo.currentTime = this.currentTime % 15.0;
            }
        });

        document.getElementById('loopDurationSelect').addEventListener('change', (e) => {
            this.params.loopDuration = parseFloat(e.target.value);
            document.getElementById('timelineScrubber').max = this.params.loopDuration;
        });

        // Audio Controls
        const btnAudio = document.getElementById('btnAudioToggle');
        btnAudio.addEventListener('click', async () => {
            const active = await this.synth.toggle();
            btnAudio.classList.toggle('active', active);
            btnAudio.textContent = active ? '🔊 Звук' : '🔇 Звук';
            this.showToast(active ? '🔊 Эмбиент-синтезатор включен' : '🔇 Звук выключен');
        });

        document.getElementById('rngAudioVol').addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('valAudioVol').textContent = v.toFixed(2);
            this.synth.updateParams({ volume: v });
        });
        document.getElementById('rngAudioFreq').addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('valAudioFreq').textContent = `${v} Hz`;
            this.synth.updateParams({ baseFreq: v });
        });
        document.getElementById('rngAudioPulse').addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('valAudioPulse').textContent = `${v.toFixed(2)} Hz`;
            this.synth.updateParams({ pulseRate: v });
        });
        document.getElementById('rngAudioRes').addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            document.getElementById('valAudioRes').textContent = v.toFixed(2);
            this.synth.updateParams({ liquidResonance: v });
        });

        // Export PNG Snapshot
        const downloadPng = () => {
            this.renderWebGL();
            const link = document.createElement('a');
            link.download = `maleewich_blob_${Date.now()}.png`;
            link.href = this.glCanvas.toDataURL('image/png');
            link.click();
            this.showToast('📸 PNG-постер сохранен');
        };
        document.getElementById('btnSnapshot').addEventListener('click', downloadPng);
        document.getElementById('btnExportPngMain').addEventListener('click', downloadPng);

        // Video Recording
        const triggerRecord = () => {
            if (this.isRecording) {
                this.stopVideoRecording();
            } else {
                this.startVideoRecording();
            }
        };
        document.getElementById('btnRecordVideo').addEventListener('click', triggerRecord);
        document.getElementById('btnExportVideoMain').addEventListener('click', triggerRecord);

        // Shareable Link with Scene State encoded in URL hash
        const btnShareLink = document.getElementById('btnShareLink');
        if (btnShareLink) {
            btnShareLink.addEventListener('click', async () => {
                try {
                    const payload = {
                        aspect: this.aspect,
                        params: this.params,
                        blobs: this.blobs,
                        textConfig: this.textConfig,
                        hudConfig: this.hudConfig
                    };
                    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
                    const url = `${window.location.origin}${window.location.pathname}#s=${encodeURIComponent(b64)}`;
                    window.history.replaceState(null, '', `#s=${encodeURIComponent(b64)}`);
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(url);
                    }
                    const origText = btnShareLink.innerHTML;
                    btnShareLink.innerHTML = '✅ Скопировано';
                    this.showToast('🔗 Ссылка на сцену скопирована в буфер обмена');
                    setTimeout(() => { btnShareLink.innerHTML = origText; }, 2000);
                } catch (err) {
                    console.error('Ошибка копирования ссылки:', err);
                }
            });
        }

        // Project JSON Save / Load
        document.getElementById('btnSaveJson').addEventListener('click', () => {
            const payload = {
                aspect: this.aspect,
                params: this.params,
                blobs: this.blobs,
                textConfig: this.textConfig,
                hudConfig: this.hudConfig
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `maleewich_post_${Date.now()}.json`;
            a.click();
        });

        document.getElementById('inpLoadJson').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (data.params && data.blobs) {
                        this.params = data.params;
                        this.blobs = data.blobs;
                        if (data.textConfig) this.textConfig = data.textConfig;
                        if (data.hudConfig) this.hudConfig = { ...this.hudConfig, ...data.hudConfig };
                        if (data.aspect) this.setAspectRatio(data.aspect);
                        this.selectedBlobIndex = 0;
                        this.trackerNodes = [];
                        this.syncUIFromState();
                        this.renderBlobList();
                        this.syncSelectedBlobUI();
                        this.updateTypographyTextures();
                    }
                } catch (err) {
                    alert('Ошибка чтения JSON файла проекта.');
                }
            };
            reader.readAsText(file);
        });
    }

    async startVideoRecording() {
        this.recordTargetDuration = parseFloat(document.getElementById('selRecordDuration').value) || 15;
        this.isRecording = true;
        this.currentTime = 0.0;
        this.isPlaying = true;
        this.setAspectRatio(this.aspect); // Switch to full 1080p resolution for recording

        // Ensure audio synth is initialized so audio stream can be included if enabled
        if (!this.synth.isPlaying) {
            await this.synth.toggle();
            const btnAudio = document.getElementById('btnAudioToggle');
            btnAudio.classList.add('active');
            btnAudio.textContent = '🔊 Звук: Вкл';
        }

        const canvasStream = this.glCanvas.captureStream(60);
        const audioTrack = this.synth.getAudioTrack();
        if (audioTrack) {
            canvasStream.addTrack(audioTrack);
        }

        const mimeTypes = [
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ];
        const selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

        this.recordedChunks = [];
        this.mediaRecorder = new MediaRecorder(canvasStream, {
            mimeType: selectedMime,
            videoBitsPerSecond: 18_000_000 // 18 Mbps crisp quality
        });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                this.recordedChunks.push(e.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            const ext = selectedMime.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(this.recordedChunks, { type: selectedMime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `maleewich_motion_${Date.now()}.${ext}`;
            a.click();
            this.isRecording = false;
            this.setAspectRatio(this.aspect); // Restore interactive preview resolution
        };

        this.recordStartTime = performance.now();
        this.mediaRecorder.start(100);

        document.getElementById('recBadge').classList.remove('hidden');
        document.getElementById('btnRecordVideo').classList.add('recording');
        document.getElementById('btnRecordVideo').innerHTML = '<span class="rec-dot"></span> Стоп запись';
    }

    stopVideoRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        document.getElementById('recBadge').classList.add('hidden');
        const btn = document.getElementById('btnRecordVideo');
        btn.classList.remove('recording');
        btn.innerHTML = '<span class="rec-dot"></span> Записать видео';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.studio = new MotionBlobStudio();
});
