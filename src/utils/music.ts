import type { MusicalNote, TuningStatus } from "../pitch/types";

export const NOTE_NAMES = [
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

export const STANDARD_GUITAR_RANGE = {
  minFrequency: 80,
  maxFrequency: 1400,
} as const;

const A4_FREQUENCY = 440;
const A4_MIDI = 69;

export function frequencyToMidi(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new RangeError("Frequency must be a positive finite number.");
  }

  return 12 * Math.log2(frequency / A4_FREQUENCY) + A4_MIDI;
}

export function midiToFrequency(midiNote: number): number {
  return A4_FREQUENCY * 2 ** ((midiNote - A4_MIDI) / 12);
}

export function frequencyToNote(frequency: number): MusicalNote {
  const midi = frequencyToMidi(frequency);
  const nearestMidi = Math.round(midi);
  const noteIndex = ((nearestMidi % 12) + 12) % 12;
  const octave = Math.floor(nearestMidi / 12) - 1;
  const centsOff = Math.round((midi - nearestMidi) * 100);

  return {
    note: NOTE_NAMES[noteIndex],
    octave,
    centsOff,
  };
}

export function noteToMidi(noteWithOctave: string): number | null {
  const match = /^([A-G]#?)(-?\d+)$/.exec(noteWithOctave.trim());
  if (!match) {
    return null;
  }

  const [, note, octaveText] = match;
  const noteIndex = NOTE_NAMES.indexOf(note as (typeof NOTE_NAMES)[number]);
  if (noteIndex === -1) {
    return null;
  }

  return (Number(octaveText) + 1) * 12 + noteIndex;
}

export function formatNote(note: Pick<MusicalNote, "note" | "octave">): string {
  return `${note.note}${note.octave}`;
}

export function getTuningStatus(
  centsOff: number,
  inTuneCents = 5,
): TuningStatus {
  if (Math.abs(centsOff) <= inTuneCents) {
    return "in-tune";
  }

  return centsOff < 0 ? "slightly-flat" : "slightly-sharp";
}

export function tuningStatusLabel(status: TuningStatus): string {
  switch (status) {
    case "in-tune":
      return "In tune";
    case "slightly-flat":
      return "Slightly Flat";
    case "slightly-sharp":
      return "Slightly Sharp";
  }
}

export function isNoteWithinTolerance(
  detected: MusicalNote,
  targetNote: string,
  toleranceCents = 50,
): boolean {
  const targetMidi = noteToMidi(targetNote);
  if (targetMidi === null) {
    return false;
  }

  const detectedMidi = noteToMidi(formatNote(detected));
  if (detectedMidi === null || detectedMidi !== targetMidi) {
    return false;
  }

  return Math.abs(detected.centsOff) <= toleranceCents;
}
