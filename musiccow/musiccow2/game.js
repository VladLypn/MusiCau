/* game.js - Updated Game Logic */

const CONFIG = {
    roundDuration: 10000, // 10 seconds total per note
    tolerance: 45,        // +/- 45 cents (slightly looser for easier play)
    preciseTolerance: 10, // +/- 10 cents for bonus
    stabilityDuration: 50, // Reduced: Note must hold for only 100ms to count
    inputDelay: 500
};

class Game {
    constructor() {
        this.audio = new AudioEngine();
        this.fretboard = new FretboardMap();
        this.ui = new GameUI(this.fretboard);
        
        this.state = {
            score: 0,
            round: 0,
            targetNote: null,
            targetPositions: [],
            isPlaying: false,
            roundStartTime: 0,
            attempts: 0, // 0 = first try, 1 = second try
            failed: false, // Locks input during transitions
            transitioning: false // Prevents double-triggering next round
        };

        // Stability Buffer
        this.detectionBuffer = [];
        
        document.getElementById('start-btn').addEventListener('click', () => this.start());
    }

    async start() {
        await this.audio.init();
        document.getElementById('start-btn').style.display = 'none';
        this.state.isPlaying = true;
        this.nextRound();
        this.loop();
    }

    nextRound() {
        this.state.round++;
        this.state.targetNote = this.fretboard.getRandomNote();
        this.state.targetPositions = this.fretboard.getPositionsForNote(this.state.targetNote);
        this.state.roundStartTime = performance.now();
        this.state.attempts = 0;
        this.state.failed = false;
        this.state.transitioning = false;
        this.detectionBuffer = []; // Clear old audio data
        // --- NEW CODE STARTS HERE ---
        // 1. Lock input immediately
        this.state.inputLocked = true;

        // 2. Draw the fretboard
        this.ui.drawFretboard(this.state.targetPositions);
        
        // 3. Tell user to wait briefly (helps them realize they should mute strings)
        this.ui.setStatus("Get Ready...", "neutral");

        // 4. Unlock after the delay
        setTimeout(() => {
            // Only unlock if we haven't already failed/moved on (edge case safety)
            if (!this.state.transitioning) {
                this.state.inputLocked = false;
                this.ui.setStatus("Play!", "neutral"); // Update text to "Play!"
            }
        }, CONFIG.inputDelay);
        // --- NEW CODE ENDS HERE ---
        
        this.ui.drawFretboard(this.state.targetPositions);
        this.ui.setStatus("Play the note!", "neutral");
    }

    checkStability(detectedNote) {
        const now = performance.now();
        
        // Add current detection to buffer
        if (detectedNote.freq !== -1) {
            this.detectionBuffer.push({ note: detectedNote.fullName, cents: detectedNote.cents, time: now });
        }

        // Remove old detections (> 200ms ago) - Keep buffer short and fresh
        this.detectionBuffer = this.detectionBuffer.filter(d => now - d.time < 200);

        // Need very few samples for 100ms stability (approx 3-4 frames)
        if(this.detectionBuffer.length < 3) return null; 

        const recent = this.detectionBuffer[this.detectionBuffer.length-1];
        const oldest = this.detectionBuffer[0];
        
        // Check duration coverage
        if (recent.time - oldest.time < CONFIG.stabilityDuration) return null;

        // Check consistency: Are all notes in buffer the same name?
        const allSame = this.detectionBuffer.every(d => d.note === recent.note);
        
        if (allSame) {
            // Average the cents for smoother scoring
            const avgCents = this.detectionBuffer.reduce((sum, d) => sum + d.cents, 0) / this.detectionBuffer.length;
            return { note: recent.note, cents: avgCents };
        }
        
        return null;
    }

    processInput(detectedInfo) {
        // --- ADD THIS CHECK ---
        if(this.state.failed || this.state.transitioning || this.state.inputLocked) return;
        // ----------------------
        if(this.state.failed || this.state.transitioning) return;

        const stableInput = this.checkStability(detectedInfo);

        if (stableInput) {
            const isNoteMatch = stableInput.note === this.state.targetNote;
            
            if (isNoteMatch) {
                // Determine Success
                const centsDiff = Math.abs(stableInput.cents);
                
                if (centsDiff <= CONFIG.tolerance) {
                    this.handleSuccess(centsDiff);
                } else {
                    // Correct note name, but too sharp/flat
                    this.ui.setStatus(`Tune it! ${stableInput.cents > 0 ? 'Too Sharp' : 'Too Flat'}`, "error");
                }
            } else {
                // Wrong Note
                this.handleFailure(stableInput.note);
            }
        }
    }

    handleSuccess(centsDiff) {
        if(this.state.transitioning) return;
        this.state.transitioning = true;
        this.state.failed = true; // Stop processing new input

        let points = 10;
        let msg = "Good!";

        if (this.state.attempts === 1) {
            points = 5; // Reduced points for 2nd try
            msg = "Saved it!";
        } else if (centsDiff <= CONFIG.preciseTolerance) {
            points = 15; // Precision bonus
            msg = "Perfect!";
        }

        this.state.score += points;
        this.ui.setStatus(`${msg} +${points}`, "success");
        
        // Short delay (400ms) just to see the green success message, then NEXT
        setTimeout(() => this.nextRound(), 400);
    }

    handleFailure(playedNote) {
        if(this.state.transitioning) return;

        // Reset buffer to prevent single pluck triggering failure multiple times
        this.detectionBuffer = []; 

        if (this.state.attempts === 0) {
            // First fail: Warning only, let them try again immediately
            this.state.attempts = 1;
            this.ui.setStatus(`Wrong note (${playedNote}). Try again!`, "error");
        } else {
            // Second fail: Game Over for this round
            this.state.transitioning = true;
            this.state.failed = true;
            this.ui.setStatus(`Missed! It was ${this.state.targetNote}`, "error");
            
            // Short delay (800ms) to see the red failure message, then NEXT
            setTimeout(() => this.nextRound(), 800);
        }
    }

    loop() {
        if (!this.state.isPlaying) return;

        const now = performance.now();
        const timeElapsed = now - this.state.roundStartTime;
        const timeRemaining = Math.max(0, CONFIG.roundDuration - timeElapsed);

        // 1. Audio Processing
        const detectedInfo = this.audio.getPitch();

        // 2. Game Logic
        // If time runs out and we aren't already transitioning
        if (timeRemaining === 0 && !this.state.transitioning) {
            this.state.transitioning = true;
            this.state.failed = true;
            this.ui.setStatus("Time's Up!", "error");
            setTimeout(() => this.nextRound(), 800);
        } else {
            this.processInput(detectedInfo);
        }

        // 3. UI Updates
        this.ui.updateTuner(detectedInfo);
        this.ui.updateHUD(
            this.state.score, 
            this.state.round, 
            this.state.targetNote, 
            timeRemaining, 
            CONFIG.roundDuration
        );

        requestAnimationFrame(() => this.loop());
    }
}

// Initialize
const game = new Game();