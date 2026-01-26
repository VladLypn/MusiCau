/**
 * app.js
 * Handles UI interactions, DOM updates, and the main animation loop.
 */

// DOM Elements
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const noteDisplay = document.getElementById('note-display');
const freqDisplay = document.getElementById('freq-display');
const centsDisplay = document.getElementById('cents-display');
const needle = document.getElementById('tuner-needle');
const chordDisplay = document.getElementById('chord-display');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let isRunning = false;
let animationFrameId = null;

// Initialize Canvas dimensions
function resizeCanvas() {
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = 150;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Toggle Audio
startBtn.addEventListener('click', async () => {
    if (!isRunning) {
        try {
            await AudioProcessor.init();
            isRunning = true;
            startBtn.textContent = "Stop Microphone";
            startBtn.classList.add('running');
            statusText.textContent = "Listening...";
            loop();
        } catch (err) {
            console.error(err);
            alert("Error accessing microphone: " + err.message);
        }
    } else {
        AudioProcessor.stop();
        cancelAnimationFrame(animationFrameId);
        isRunning = false;
        startBtn.textContent = "Start Microphone";
        startBtn.classList.remove('running');
        statusText.textContent = "Stopped";
        resetUI();
    }
});

function resetUI() {
    noteDisplay.textContent = "--";
    freqDisplay.textContent = "0 Hz";
    centsDisplay.textContent = "0 cents";
    chordDisplay.textContent = "--";
    chordDisplay.style.color = "var(--secondary-color)";
    needle.style.left = "50%";
    
    // Clear Canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Main Animation Loop
 */
function loop() {
    if (!isRunning) return;

    // 1. Update Audio Data
    AudioProcessor.updateBuffers();

    // 2. Visualizer
    drawWaveform(AudioProcessor.waveformBuffer);

    // 3. Pitch Detection
    const pitch = AudioProcessor.getPitch();
    
    if (pitch !== -1 && pitch > 60 && pitch < 4000) {
        const noteData = AudioProcessor.getNoteDetails(pitch);
        
        noteDisplay.textContent = noteData.noteName;
        freqDisplay.textContent = noteData.frequency.toFixed(1) + " Hz";
        centsDisplay.textContent = (noteData.cents > 0 ? "+" : "") + noteData.cents + " cents";
        
        // Needle Logic
        let needlePos = 50 + (noteData.cents / 50) * 50;
        needlePos = Math.max(0, Math.min(100, needlePos));
        needle.style.left = `${needlePos}%`;
        
        if (Math.abs(noteData.cents) < 5) {
            needle.style.backgroundColor = "#00ff00";
            needle.style.boxShadow = "0 0 10px #00ff00";
        } else {
            needle.style.backgroundColor = "var(--primary-color)";
            needle.style.boxShadow = "0 0 10px var(--primary-color)";
        }
    }

    // 4. Chord Detection
    const chordName = AudioProcessor.getChord();
    if (chordName) {
        chordDisplay.textContent = chordName;
        chordDisplay.style.color = "var(--primary-color)";
    } else {
        chordDisplay.style.color = "var(--secondary-color)";
    }

    animationFrameId = requestAnimationFrame(loop);
}

function drawWaveform(buffer) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#03dac6';
    ctx.beginPath();

    const sliceWidth = canvas.width / buffer.length;
    let x = 0;

    for(let i = 0; i < buffer.length; i++) {
        const v = buffer[i] * 5 + 0.5;
        const y = v * canvas.height;

        if(i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
}