/**
 * audio.js
 * Contains the Core Audio Logic, Pitch Detection, and Chord Recognition.
 */

 const AudioProcessor = {
    audioContext: null,
    analyser: null,
    microphoneStream: null,
    waveformBuffer: null,
    freqBuffer: null,
    
    // Constants
    NOTE_STRINGS: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
    A4_FREQ: 440,
    CHORD_THRESHOLD: 0.3,
    
    // Chord Dictionary
    CHORDS: {
        'Major': [0, 4, 7],
        'Minor': [0, 3, 7],
        'Dim': [0, 3, 6],
        'Aug': [0, 4, 8],
        'Sus2': [0, 2, 7],
        'Sus4': [0, 5, 7],
        '7th': [0, 4, 7, 10],
        'Maj7': [0, 4, 7, 11],
        'Min7': [0, 3, 7, 10]
    },

    /**
     * Initializes the Audio Context and Microphone Stream
     */
    async init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        this.microphoneStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                latency: 0
            } 
        });

        const source = this.audioContext.createMediaStreamSource(this.microphoneStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 4096;
        
        source.connect(this.analyser);

        this.waveformBuffer = new Float32Array(this.analyser.fftSize);
        this.freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
    },

    /**
     * Stops the audio context and stream
     */
    stop() {
        if (this.audioContext) this.audioContext.close();
        if (this.microphoneStream) this.microphoneStream.getTracks().forEach(track => track.stop());
    },

    /**
     * Fills the buffers with current audio data
     */
    updateBuffers() {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(this.waveformBuffer);
        this.analyser.getByteFrequencyData(this.freqBuffer);
    },

    /**
     * Algorithm: Autocorrelation for Pitch Detection
     */
    getPitch() {
        const buffer = this.waveformBuffer;
        const sampleRate = this.audioContext.sampleRate;

        // RMSE Check
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        let rms = Math.sqrt(sum / buffer.length);
        if (rms < 0.01) return -1; // Too quiet

        // Autocorrelation
        let r1 = 0, r2 = buffer.length / 2;
        let thres = 0.2;
        
        for (let i = 0; i < buffer.length / 2; i++) {
            if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
        }
        for (let i = 1; i < buffer.length / 2; i++) {
            if (Math.abs(buffer[buffer.length - i]) < thres) { r2 = buffer.length - i; break; }
        }

        const slicedBuffer = buffer.slice(r1, r2);
        let c = new Array(slicedBuffer.length).fill(0);
        
        for (let i = 0; i < slicedBuffer.length; i++) {
            for (let j = 0; j < slicedBuffer.length - i; j++) {
                c[i] = c[i] + slicedBuffer[j] * slicedBuffer[j + i];
            }
        }

        let d = 0; 
        while (c[d] > c[d + 1]) d++;
        let maxval = -1, maxpos = -1;
        
        for (let i = d; i < slicedBuffer.length; i++) {
            if (c[i] > maxval) {
                maxval = c[i];
                maxpos = i;
            }
        }
        
        let T0 = maxpos;

        // Parabolic Interpolation
        let x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
        let a = (x1 + x3 - 2 * x2) / 2;
        let b = (x3 - x1) / 2;
        if (a) T0 = T0 - b / (2 * a);

        return sampleRate / T0;
    },

    /**
     * Converts Frequency to Note Name and Cents
     */
    getNoteDetails(frequency) {
        const noteNum = 12 * (Math.log(frequency / this.A4_FREQ) / Math.log(2));
        const midiNum = Math.round(noteNum) + 69;
        const noteName = this.NOTE_STRINGS[midiNum % 12];
        const cents = Math.floor((noteNum - Math.round(noteNum)) * 100);
        return { noteName, cents, frequency };
    },

    /**
     * Algorithm: Chroma Feature Extraction for Chord Detection
     */
    getChord() {
        const freqData = this.freqBuffer;
        const sampleRate = this.audioContext.sampleRate;
        const binSize = sampleRate / this.analyser.fftSize;

        let chroma = new Array(12).fill(0);

        for (let i = 0; i < freqData.length; i++) {
            const freq = i * binSize;
            if (freq < 60 || freq > 2000) continue; 
            if (freqData[i] < 100) continue; 

            const noteNum = 12 * (Math.log(freq / this.A4_FREQ) / Math.log(2)) + 69;
            const noteIndex = Math.round(noteNum) % 12;
            
            if (noteIndex >= 0 && noteIndex < 12) {
                chroma[noteIndex] += freqData[i];
            }
        }

        const maxVal = Math.max(...chroma);
        if (maxVal === 0) return null;
        chroma = chroma.map(val => val / maxVal);

        const activeNotes = chroma.map((val, idx) => val > this.CHORD_THRESHOLD ? idx : -1).filter(idx => idx !== -1);

        if (activeNotes.length < 3) return null;

        for (let root = 0; root < 12; root++) {
            for (const [chordName, intervals] of Object.entries(this.CHORDS)) {
                const expectedNotes = intervals.map(interval => (root + interval) % 12);
                const matches = expectedNotes.filter(n => activeNotes.includes(n)).length;
                if (matches === expectedNotes.length) {
                    return `${this.NOTE_STRINGS[root]} ${chordName}`;
                }
            }
        }
        return null;
    }
};