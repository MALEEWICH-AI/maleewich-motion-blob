// Procedural Ambient Drone & Organic Liquid Synthesizer (Web Audio API)
// Recreates the deep sub-bass resonant pulse & underwater texture from motionRef.mp4
window.BlobStudio = window.BlobStudio || {};

window.BlobStudio.AmbientSynth = class AmbientSynth {
    constructor() {
        this.ctx = null;
        this.isPlaying = false;
        this.masterGain = null;
        this.streamDest = null;

        this.params = {
            volume: 0.65,
            baseFreq: 55.0,     // A1 deep sub-bass drone
            pulseRate: 0.22,    // Slow organic breathing LFO (Hz)
            filterCutoff: 240,  // Low-pass warmth
            liquidResonance: 0.55
        };

        this.nodes = {};
    }

    init() {
        if (this.ctx) return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.0001;

        // Compressor to keep deep sub-bass warm and clip-free
        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.05;
        compressor.release.value = 0.25;

        // MediaStreamDestination for recording audio directly into exported video!
        this.streamDest = this.ctx.createMediaStreamDestination();

        // 1. Sub-bass fundamental & detuned fifth (Saw + Triangle + Sine sub)
        const oscSub = this.ctx.createOscillator();
        oscSub.type = 'sine';
        oscSub.frequency.value = this.params.baseFreq;

        const oscWarm1 = this.ctx.createOscillator();
        oscWarm1.type = 'sawtooth';
        oscWarm1.frequency.value = this.params.baseFreq * 1.004;

        const oscWarm2 = this.ctx.createOscillator();
        oscWarm2.type = 'triangle';
        oscWarm2.frequency.value = this.params.baseFreq * 1.498; // Fifth

        // 2. Resonant Lowpass Filter for the liquid underwater swell
        const mainFilter = this.ctx.createBiquadFilter();
        mainFilter.type = 'lowpass';
        mainFilter.frequency.value = this.params.filterCutoff;
        mainFilter.Q.value = 4.5 * this.params.liquidResonance + 1.0;

        // 3. Slow LFO modulating filter frequency and subtle pitch drift
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = this.params.pulseRate;

        const lfoFilterGain = this.ctx.createGain();
        lfoFilterGain.gain.value = 110 * this.params.liquidResonance;

        lfo.connect(lfoFilterGain);
        lfoFilterGain.connect(mainFilter.frequency);

        // 4. Secondary faster LFO for subtle liquid bubble modulation
        const lfoBubble = this.ctx.createOscillator();
        lfoBubble.type = 'sine';
        lfoBubble.frequency.value = 1.65;

        const bubbleFilter = this.ctx.createBiquadFilter();
        bubbleFilter.type = 'bandpass';
        bubbleFilter.frequency.value = 320;
        bubbleFilter.Q.value = 8.0;

        const bubbleLfoGain = this.ctx.createGain();
        bubbleLfoGain.gain.value = 140;
        lfoBubble.connect(bubbleLfoGain);
        bubbleLfoGain.connect(bubbleFilter.frequency);

        const bubbleMix = this.ctx.createGain();
        bubbleMix.gain.value = 0.18 * this.params.liquidResonance;

        // Mix oscillators
        const subGain = this.ctx.createGain();
        subGain.gain.value = 0.55;
        const warmGain = this.ctx.createGain();
        warmGain.gain.value = 0.22;

        oscSub.connect(subGain);
        oscWarm1.connect(warmGain);
        oscWarm2.connect(warmGain);

        subGain.connect(mainFilter);
        warmGain.connect(mainFilter);
        warmGain.connect(bubbleFilter);
        bubbleFilter.connect(bubbleMix);

        mainFilter.connect(compressor);
        bubbleMix.connect(compressor);
        compressor.connect(this.masterGain);

        this.masterGain.connect(this.ctx.destination);
        this.masterGain.connect(this.streamDest);

        oscSub.start();
        oscWarm1.start();
        oscWarm2.start();
        lfo.start();
        lfoBubble.start();

        this.nodes = {
            oscSub,
            oscWarm1,
            oscWarm2,
            mainFilter,
            lfo,
            lfoFilterGain,
            bubbleMix
        };
    }

    async toggle() {
        if (!this.ctx) this.init();
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        const now = this.ctx.currentTime;
        if (!this.isPlaying) {
            this.masterGain.gain.cancelScheduledValues(now);
            this.masterGain.gain.setValueAtTime(Math.max(this.masterGain.gain.value, 0.001), now);
            this.masterGain.gain.exponentialRampToValueAtTime(Math.max(this.params.volume, 0.01), now + 0.6);
            this.isPlaying = true;
        } else {
            this.masterGain.gain.cancelScheduledValues(now);
            this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
            this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
            this.isPlaying = false;
        }
        return this.isPlaying;
    }

    updateParams(newParams) {
        Object.assign(this.params, newParams);
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (this.isPlaying) {
            this.masterGain.gain.setTargetAtTime(Math.max(this.params.volume, 0.001), now, 0.08);
        }
        this.nodes.oscSub.frequency.setTargetAtTime(this.params.baseFreq, now, 0.1);
        this.nodes.oscWarm1.frequency.setTargetAtTime(this.params.baseFreq * 1.004, now, 0.1);
        this.nodes.oscWarm2.frequency.setTargetAtTime(this.params.baseFreq * 1.498, now, 0.1);
        this.nodes.mainFilter.frequency.setTargetAtTime(this.params.filterCutoff, now, 0.1);
        this.nodes.mainFilter.Q.setTargetAtTime(4.5 * this.params.liquidResonance + 1.0, now, 0.1);
        this.nodes.lfo.frequency.setTargetAtTime(this.params.pulseRate, now, 0.1);
        this.nodes.lfoFilterGain.gain.setTargetAtTime(110 * this.params.liquidResonance, now, 0.1);
        this.nodes.bubbleMix.gain.setTargetAtTime(0.18 * this.params.liquidResonance, now, 0.1);
    }

    getAudioTrack() {
        if (!this.ctx) this.init();
        const tracks = this.streamDest.stream.getAudioTracks();
        return tracks.length > 0 ? tracks[0] : null;
    }
}
