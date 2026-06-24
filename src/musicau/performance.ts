import { clamp01 } from "./dsp";
import { PITCH_CLASSES, closestStringForNote, parseNoteName } from "./notes";
import type {
  DetectedPerformance,
  ExpectedPerformance,
  LearningFeedback,
  MusicauChordDetection,
  MusicauNoteDetection,
  PerformanceEvaluation,
  PitchClass,
} from "./types";

export function evaluatePerformance(
  expected: ExpectedPerformance,
  detected: DetectedPerformance,
): PerformanceEvaluation {
  const timingAccuracy = scoreTiming(expected.timestamp, detected.timestamp);

  if (expected.note) {
    const noteResult = evaluateNote(expected.note, detected.note ?? null);
    return {
      correct: noteResult.correct && timingAccuracy >= 0.72,
      score: Math.round((noteResult.pitchScore * 0.78 + timingAccuracy * 0.22) * 100),
      timingAccuracy,
      centsOff: noteResult.centsOff,
    };
  }

  if (expected.chord) {
    const chordResult = evaluateChord(expected.chord, detected.chord ?? null);
    return {
      correct: chordResult.correct && timingAccuracy >= 0.72,
      score: Math.round((chordResult.chordScore * 0.76 + timingAccuracy * 0.24) * 100),
      timingAccuracy,
      missingNotes: chordResult.missingNotes,
      extraNotes: chordResult.extraNotes,
    };
  }

  return {
    correct: false,
    score: 0,
    timingAccuracy,
  };
}

export function buildLearningFeedback(
  expectedNotes: string[],
  detectedNotes: MusicauNoteDetection[],
  detectedChord: MusicauChordDetection | null,
): LearningFeedback {
  const stringFeedback = expectedNotes.map((expected) => {
    const expectedPitchClass = parseNoteName(expected)?.pitchClass;
    const detected = detectedNotes.find((candidate) => {
      return expectedPitchClass ? candidate.pitchClass === expectedPitchClass : candidate.note === expected;
    });

    return {
      string: closestStringForNote(expected) ?? 0,
      expected,
      detected: detected?.note ?? null,
      centsOff: detected?.centsOff ?? null,
      correct: Boolean(detected && Math.abs(detected.centsOff) <= 18),
    };
  });

  return {
    stringFeedback,
    incorrectChordNotes: detectedChord?.extraNotes ?? [],
    missedNotes: detectedChord?.missingNotes ?? [],
    strummingPattern: [],
  };
}

function evaluateNote(expectedNote: string, detected: MusicauNoteDetection | null) {
  if (!detected) {
    return { correct: false, pitchScore: 0, centsOff: undefined };
  }

  const expected = parseNoteName(expectedNote);
  const expectedPitch = expected?.pitchClass;
  const expectedOctave = expected?.octave;
  const samePitch =
    expectedPitch === detected.pitchClass &&
    (expectedOctave === undefined || expectedOctave === detected.octave);
  const centsPenalty = Math.min(1, Math.abs(detected.centsOff) / 50);
  const pitchScore = samePitch ? clamp01(1 - centsPenalty * 0.7) : 0;

  return {
    correct: samePitch && Math.abs(detected.centsOff) <= 25,
    pitchScore,
    centsOff: detected.centsOff,
  };
}

function evaluateChord(expectedChord: string, detected: MusicauChordDetection | null) {
  if (!detected) {
    return {
      correct: false,
      chordScore: 0,
      missingNotes: [] as PitchClass[],
      extraNotes: [] as PitchClass[],
    };
  }

  const expectedPitchClasses = pitchClassesInChordName(expectedChord);
  const detectedSet = new Set(detected.notes);
  const missingNotes = expectedPitchClasses.filter((pitchClass) => !detectedSet.has(pitchClass));
  const extraNotes = detected.notes.filter((pitchClass) => !expectedPitchClasses.includes(pitchClass));
  const exactName = normalizeChordName(expectedChord) === normalizeChordName(detected.chord);
  const overlap =
    expectedPitchClasses.filter((pitchClass) => detectedSet.has(pitchClass)).length /
    Math.max(1, expectedPitchClasses.length);
  const chordScore = exactName ? detected.confidence : overlap * detected.confidence * 0.88;

  return {
    correct: exactName || (missingNotes.length === 0 && extraNotes.length <= 1 && chordScore > 0.82),
    chordScore,
    missingNotes,
    extraNotes,
  };
}

function scoreTiming(expectedTimestamp?: number, detectedTimestamp?: number): number {
  if (expectedTimestamp === undefined || detectedTimestamp === undefined) {
    return 1;
  }

  const deltaMs = Math.abs(detectedTimestamp - expectedTimestamp);
  return clamp01(1 - deltaMs / 180);
}

function normalizeChordName(chord: string): string {
  return chord.toLowerCase().replace(/\s+/g, "").replace("major", "");
}

function pitchClassesInChordName(chord: string): PitchClass[] {
  const root = PITCH_CLASSES.find((pitchClass) => chord.startsWith(pitchClass));
  if (!root) {
    return [];
  }

  const rootIndex = PITCH_CLASSES.indexOf(root);
  const lower = chord.toLowerCase();
  const intervals = lower.includes("minor") || /\bm\b/.test(lower)
    ? [0, 3, 7]
    : lower.includes("sus2")
      ? [0, 2, 7]
      : lower.includes("sus4")
        ? [0, 5, 7]
        : lower.includes("5")
          ? [0, 7]
          : [0, 4, 7];

  return intervals.map((interval) => PITCH_CLASSES[(rootIndex + interval) % 12]);
}
