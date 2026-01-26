/* fretboard.js - Mapping Logic */

const TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

class FretboardMap {
    constructor() {
        this.stringCount = 6;
        this.fretCount = 15; // Limit visualization to 15 frets
    }

    // Helper to get semitone value of a note (e.g., E2 -> 40)
    getNoteValue(noteName) {
        // Simple parser: A2, C#3, etc.
        const regex = /([A-G][#b]?)([0-9])/;
        const match = noteName.match(regex);
        if(!match) return 0;
        
        let note = match[1];
        let octave = parseInt(match[2]);
        
        let index = NOTES_SHARP.indexOf(note);
        if(index === -1) index = NOTES_FLAT.indexOf(note);
        
        return index + (octave + 1) * 12;
    }

    // Returns array of objects { string: 1-6, fret: 0-15 }
    getPositionsForNote(targetNote) {
        const targetVal = this.getNoteValue(targetNote);
        const positions = [];

        TUNING.forEach((openStringNote, index) => {
            const openVal = this.getNoteValue(openStringNote);
            const diff = targetVal - openVal;

            if (diff >= 0 && diff <= this.fretCount) {
                // String index 0 is Low E (top visually usually, but technically string 6)
                // We'll return 0-indexed string from Low E
                positions.push({ string: index, fret: diff });
            }
        });
        return positions;
    }

    // Generate a random guitar-friendly note
    getRandomNote() {
        // Limit range to reasonable beginner notes (E3 to G4)
        // or full range E2 to E4. Let's do A2 to E4 for playability
        const notes = [
            "A2", "B2", "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4", "D4", "E4"
        ];
        return notes[Math.floor(Math.random() * notes.length)];
        // n++
        // return notes[n%12]
    }
}
// let n = 0