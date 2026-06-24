import type { PitchClass } from "./types";

export const PITCH_CLASSES: readonly PitchClass[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const REFERENCE_NOTES = {
  E2: 82.41,
  F2: 87.31,
  "F#2": 92.5,
  G2: 98,
  "G#2": 103.83,
  A2: 110,
  "A#2": 116.54,
  B2: 123.47,
  C3: 130.81,
  "C#3": 138.59,
  D3: 146.83,
  "D#3": 155.56,
  E3: 164.81,
} as const;

export const STANDARD_TUNING = [
  { string: 6, note: "E2", midi: 40 },
  { string: 5, note: "A2", midi: 45 },
  { string: 4, note: "D3", midi: 50 },
  { string: 3, note: "G3", midi: 55 },
  { string: 2, note: "B3", midi: 59 },
  { string: 1, note: "E4", midi: 64 },
] as const;

const A4_FREQUENCY = 440;
const A4_MIDI = 69;

export function frequencyToMidi(frequency: number): number {
  return 12 * Math.log2(frequency / A4_FREQUENCY) + A4_MIDI;
}

export function midiToFrequency(midi: number): number {
  return A4_FREQUENCY * 2 ** ((midi - A4_MIDI) / 12);
}

export function midiToNote(midi: number): {
  note: string;
  pitchClass: PitchClass;
  octave: number;
} {
  const rounded = Math.round(midi);
  const pitchClass = PITCH_CLASSES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;

  return {
    note: `${pitchClass}${octave}`,
    pitchClass,
    octave,
  };
}

export function frequencyToNote(frequency: number): {
  note: string;
  pitchClass: PitchClass;
  octave: number;
  centsOff: number;
  targetFrequency: number;
} {
  const midi = frequencyToMidi(frequency);
  const roundedMidi = Math.round(midi);
  const note = midiToNote(roundedMidi);

  return {
    ...note,
    centsOff: Math.round((midi - roundedMidi) * 100),
    targetFrequency: midiToFrequency(roundedMidi),
  };
}

export function parseNoteName(note: string): {
  pitchClass: PitchClass;
  octave: number;
  midi: number;
} | null {
  const match = /^([A-G]#?)(-?\d+)$/.exec(note.trim());
  if (!match) {
    return null;
  }

  const pitchClass = match[1] as PitchClass;
  const pitchIndex = PITCH_CLASSES.indexOf(pitchClass);
  if (pitchIndex === -1) {
    return null;
  }

  const octave = Number(match[2]);
  return {
    pitchClass,
    octave,
    midi: (octave + 1) * 12 + pitchIndex,
  };
}

export function centsBetween(frequency: number, targetFrequency: number): number {
  return 1200 * Math.log2(frequency / targetFrequency);
}

export function buildGuitarFretboard(maxFret = 24): Array<{
  string: number;
  fret: number;
  note: string;
  pitchClass: PitchClass;
  frequency: number;
}> {
  return STANDARD_TUNING.flatMap((openString) =>
    Array.from({ length: maxFret + 1 }, (_, fret) => {
      const midi = openString.midi + fret;
      const note = midiToNote(midi);

      return {
        string: openString.string,
        fret,
        note: note.note,
        pitchClass: note.pitchClass,
        frequency: midiToFrequency(midi),
      };
    }),
  );
}

export function closestStringForNote(noteName: string): number | null {
  const parsed = parseNoteName(noteName);
  if (!parsed) {
    return null;
  }

  const playable = STANDARD_TUNING.filter((openString) => {
    const fret = parsed.midi - openString.midi;
    return fret >= 0 && fret <= 24;
  }).sort((a, b) => {
    const aFret = parsed.midi - a.midi;
    const bFret = parsed.midi - b.midi;
    return aFret - bFret;
  });

  return playable[0]?.string ?? null;
}
