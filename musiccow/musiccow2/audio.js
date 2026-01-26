/* audio.js - Pitch Detection Logic */

class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.mediaStreamSource = null;
        this.buflen = 2048;
        this.buf = new Float32Array(this.buflen);
        this.isPlaying = false;
    }

    async init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false 
                } 
            });
            
            this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.mediaStreamSource.connect(this.analyser);
            this.isPlaying = true;
            
        } catch (err) {
            console.error("Microphone access denied", err);
            alert("Microphone access is required to play.");
        }
    }

    getPitch() {
        if (!this.isPlaying) return { freq: -1, note: null, cents: 0 };

        this.analyser.getFloatTimeDomainData(this.buf);
        const ac = this.autoCorrelate(this.buf, this.audioContext.sampleRate);

        if (ac === -1) {
            return { freq: -1, note: null, cents: 0 }; // Too quiet or undefined
        }

        const note = this.noteFromPitch(ac);
        const cents = this.centsOffFromPitch(ac, note);
        const noteName = this.noteStrings[note % 12];
        const octave = Math.floor(note / 12) - 1;

        return {
            freq: ac,
            midi: note,
            name: noteName,
            octave: octave,
            fullName: noteName + octave,
            cents: cents
        };
    }

    // Standard Autocorrelation Algorithm
    autoCorrelate(buf, sampleRate) {
        let SIZE = buf.length;
        let rms = 0;

        for (let i = 0; i < SIZE; i++) {
            const val = buf[i];
            rms += val * val;
        }
        rms = Math.sqrt(rms / SIZE);

        // Noise Gate
        if (rms < 0.01) return -1;

        let r1 = 0, r2 = SIZE - 1, thres = 0.2;
        for (let i = 0; i < SIZE / 2; i++) {
            if (Math.abs(buf[i]) < thres) { r1 = i; break; }
        }
        for (let i = 1; i < SIZE / 2; i++) {
            if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
        }

        buf = buf.slice(r1, r2);
        SIZE = buf.length;

        const c = new Array(SIZE).fill(0);
        for (let i = 0; i < SIZE; i++) {
            for (let j = 0; j < SIZE - i; j++) {
                c[i] = c[i] + buf[j] * buf[j + i];
            }
        }

        let d = 0; while (c[d] > c[d + 1]) d++;
        let maxval = -1, maxpos = -1;
        for (let i = d; i < SIZE; i++) {
            if (c[i] > maxval) {
                maxval = c[i];
                maxpos = i;
            }
        }
        let T0 = maxpos;

        // Parabolic interpolation for higher precision
        let x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
        let a = (x1 + x3 - 2 * x2) / 2;
        let b = (x3 - x1) / 2;
        if (a) T0 = T0 - b / (2 * a);

        return sampleRate / T0;
    }

    noteFromPitch(frequency) {
        const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
        return Math.round(noteNum) + 69;
    }

    centsOffFromPitch(frequency, note) {
        return Math.floor(1200 * Math.log(frequency / this.frequencyFromNoteNumber(note)) / Math.log(2));
    }

    frequencyFromNoteNumber(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
}