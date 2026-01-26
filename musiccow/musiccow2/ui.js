/* ui.js - Visualization */

class GameUI {
    constructor(fretboardMap) {
        this.canvas = document.getElementById('fretboard-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.fretboardMap = fretboardMap;
        
        // DOM Elements
        this.els = {
            score: document.getElementById('score-display'),
            target: document.getElementById('target-note'),
            timerBar: document.getElementById('timer-bar'),
            timerText: document.getElementById('timer-text'),
            round: document.getElementById('round-display'),
            detected: document.getElementById('detected-note'),
            cents: document.getElementById('cents-deviation'),
            msg: document.getElementById('status-message')
        };

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.drawFretboard([]);
    }

    updateHUD(score, round, targetNote, timeRem, maxTime) {
        this.els.score.textContent = score;
        this.els.round.textContent = round;
        this.els.target.textContent = targetNote;
        
        const pct = (timeRem / maxTime) * 100;
        this.els.timerBar.style.width = `${pct}%`;
        this.els.timerText.textContent = (timeRem / 1000).toFixed(1) + "s";

        // Color shift timer based on urgency
        if(pct < 30) this.els.timerBar.style.background = "#ff4444";
        else this.els.timerBar.style.background = "#00d4ff";
    }

    updateTuner(noteInfo) {
        if(!noteInfo || noteInfo.freq === -1) {
            this.els.detected.textContent = "--";
            this.els.cents.textContent = "";
            return;
        }

        this.els.detected.textContent = noteInfo.fullName;
        this.els.cents.textContent = (noteInfo.cents > 0 ? "+" : "") + noteInfo.cents + " cents";
        
        // Style cents
        this.els.cents.className = 'cents ' + 
            (Math.abs(noteInfo.cents) < 10 ? 'in-tune' : 
            (noteInfo.cents < 0 ? 'flat' : 'sharp'));
    }

    setStatus(msg, type='neutral') {
        this.els.msg.textContent = msg;
        this.els.msg.style.color = type === 'success' ? '#00ff88' : (type === 'error' ? '#ff4444' : '#aaa');
    }

    drawFretboard(activePositions) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const strings = 6;
        const frets = 15;
        
        const fretW = w / frets;
        const stringH = h / (strings + 1);

        // Clear
        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, w, h);

        // Draw Frets (Vertical)
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 2;
        for(let i=1; i<=frets; i++) {
            ctx.beginPath();
            ctx.moveTo(i * fretW, stringH);
            ctx.lineTo(i * fretW, stringH * strings);
            ctx.stroke();
            
            // Fret numbers
            if([3, 5, 7, 9, 12].includes(i)) {
                ctx.fillStyle = "#444";
                ctx.font = "12px Arial";
                ctx.fillText(i, i * fretW - (fretW/2) - 4, h - 5);
            }
        }

        // Draw Strings (Horizontal)
        for(let i=0; i<strings; i++) {
            const y = stringH * (i + 1); // 0 is low E, draw at top? 
            // Usually Low E is bottom on tab, top physically. Let's draw Low E at bottom (index 5 visually)
            // or Low E at top (index 0). Standard diagram logic: Low E is Bottom of diagram (thickest).
            // Let's draw Low E (string index 0 in our array) at the BOTTOM (y pos large).
            
            const visualIndex = (strings - 1) - i; 
            const yPos = stringH * (visualIndex + 1);

            ctx.beginPath();
            ctx.strokeStyle = "#888"; // string color
            ctx.lineWidth = 1 + (i * 0.5); // Thicker for lower strings
            ctx.moveTo(0, yPos);
            ctx.lineTo(w, yPos);
            ctx.stroke();
        }

        // Draw Active Notes
        if(activePositions) {
            activePositions.forEach(pos => {
                // pos.string is 0 (Low E) to 5 (High E)
                // visualY needs Low E at bottom
                const visualIndex = (strings - 1) - pos.string;
                const yPos = stringH * (visualIndex + 1);
                
                // X pos: Center of fret. Fret 0 is open string (draw at left edge)
                let xPos;
                if(pos.fret === 0) xPos = 15;
                else xPos = (pos.fret * fretW) - (fretW / 2);

                // Draw Circle
                ctx.beginPath();
                ctx.arc(xPos, yPos, stringH * 0.35, 0, Math.PI * 2);
                ctx.fillStyle = "#00d4ff";
                ctx.fill();
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.stroke();

                // Text
                ctx.fillStyle = "#000";
                ctx.font = "bold 12px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(pos.fret, xPos, yPos);
            });
        }
    }
}