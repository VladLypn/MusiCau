import { activePitchClasses } from "./chroma";
import { clamp01 } from "./dsp";
import { PITCH_CLASSES, midiToFrequency, parseNoteName } from "./notes";
import type { ChordQuality, MusicauChordDetection, PitchClass } from "./types";

interface ChordTemplate {
  quality: ChordQuality;
  suffix: string;
  intervals: number[];
  weights: number[];
}

interface SupportedChordProfile {
  root: PitchClass;
  template: ChordTemplate;
  openVoicing: readonly string[];
  toleranceCents: number;
}

const MAJOR_TEMPLATE: ChordTemplate = {
  quality: "Major",
  suffix: " Major",
  intervals: [0, 4, 7],
  weights: [1, 0.78, 0.88],
};

const MINOR_TEMPLATE: ChordTemplate = {
  quality: "Minor",
  suffix: " Minor",
  intervals: [0, 3, 7],
  weights: [1, 0.78, 0.88],
};

const SUPPORTED_CHORD_PROFILES: readonly SupportedChordProfile[] = [
  {
    root: "E",
    template: MINOR_TEMPLATE,
    openVoicing: ["E2", "B2", "E3", "G3", "B3", "E4"],
    toleranceCents: 70,
  },
  {
    root: "A",
    template: MINOR_TEMPLATE,
    openVoicing: ["A2", "E3", "A3", "C4", "E4"],
    toleranceCents: 70,
  },
  {
    root: "D",
    template: MAJOR_TEMPLATE,
    openVoicing: ["D3", "A3", "D4", "F#4"],
    toleranceCents: 70,
  },
  {
    root: "G",
    template: MAJOR_TEMPLATE,
    openVoicing: ["G2", "B2", "D3", "G3", "B3", "G4"],
    toleranceCents: 70,
  },
  {
    root: "C",
    template: MAJOR_TEMPLATE,
    openVoicing: ["C3", "E3", "G3", "C4", "E4"],
    toleranceCents: 70,
  },
];

export const SUPPORTED_CHORD_NAMES = SUPPORTED_CHORD_PROFILES.map((profile) =>
  chordName(profile),
);

export function detectChordFromChroma(chroma: readonly number[]): MusicauChordDetection | null {
  return detectChordCandidatesFromChroma(chroma)[0] ?? null;
}

export function detectChordCandidatesFromChroma(
  chroma: readonly number[],
): MusicauChordDetection[] {
  const totalEnergy = chroma.reduce((sum, value) => sum + value, 0);
  if (totalEnergy <= 0.24) {
    return [];
  }

  const ranked = rankChordCandidates(chroma);
  return ranked
    .filter((candidate, index) => {
      const second = ranked[1];
      return (
        candidate.confidence >= 0.32 &&
        (index > 0 ||
          candidate.confidence >= 0.5 ||
          candidate.confidence - (second?.confidence ?? 0) >= 0.004)
      );
    })
    .slice(0, SUPPORTED_CHORD_PROFILES.length)
    .map((candidate, index, candidates) =>
      toChordDetection(candidate, candidates, chroma),
    );
}

export function chordProbabilityDistribution(
  candidates: readonly MusicauChordDetection[],
): Record<string, number> {
  return Object.fromEntries(
    candidates.map((candidate) => [candidate.chord, candidate.confidence]),
  );
}

function toChordDetection(
  candidate: RankedChordCandidate,
  ranked: readonly RankedChordCandidate[],
  chroma: readonly number[],
): MusicauChordDetection {
  const root = candidate.profile.root;
  const notes = candidate.template.intervals.map(
    (interval) => PITCH_CLASSES[(candidate.rootIndex + interval) % 12],
  );
  const chordToneSet = new Set(notes);
  const active = activePitchClasses(chroma, 0.18);
  const missingNotes = notes.filter((note) => chroma[PITCH_CLASSES.indexOf(note)] < 0.12);
  const extraNotes = active
    .map(({ pitchClass }) => pitchClass)
    .filter((pitchClass) => !chordToneSet.has(pitchClass));
  const chord = chordName(candidate.profile);

  return {
    chord,
    root,
    quality: candidate.template.quality,
    notes,
    confidence: clamp01(candidate.confidence),
    missingNotes,
    extraNotes,
    chroma: [...chroma],
    alternatives: ranked
      .filter((alternative) => {
        return chordName(alternative.profile) !== chord;
      })
      .slice(0, 3)
      .map((alternative) => ({
        chord: chordName(alternative.profile),
        confidence: clamp01(alternative.confidence),
      })),
  };
}

interface RankedChordCandidate {
  rootIndex: number;
  profile: SupportedChordProfile;
  template: ChordTemplate;
  confidence: number;
}

function rankChordCandidates(chroma: readonly number[]): RankedChordCandidate[] {
  const ranked: RankedChordCandidate[] = [];

  for (const profile of SUPPORTED_CHORD_PROFILES) {
    const rootIndex = PITCH_CLASSES.indexOf(profile.root);
    const template = profile.template;
    const vector = templateVector(rootIndex, template);
    const similarity = cosineSimilarity(chroma, vector);
    const chordTones = new Set(
      template.intervals.map((interval) => (rootIndex + interval) % 12),
    );
    const chordEnergy = [...chordTones].reduce(
      (sum, pitchClass) => sum + chroma[pitchClass],
      0,
    );
    const totalEnergy = chroma.reduce((sum, value) => sum + value, 0);
    const coverage = totalEnergy > 0 ? chordEnergy / totalEnergy : 0;
    const missingPenalty = template.intervals.reduce((penalty, interval) => {
      const energy = chroma[(rootIndex + interval) % 12];
      return penalty + (energy < 0.1 ? 0.05 : 0);
    }, 0);
    const extraPenalty = chroma.reduce((penalty, energy, pitchClass) => {
      return chordTones.has(pitchClass)
        ? penalty
        : penalty + Math.max(0, energy - 0.38) * 0.025;
    }, 0);
    const rootSupport = chroma[rootIndex] * 0.12;

    const baseConfidence =
      similarity * 0.5 + coverage * 0.42 + rootSupport - missingPenalty - extraPenalty;

    ranked.push({
      rootIndex,
      profile,
      template,
      confidence: baseConfidence + profileAdjustment(profile, chroma),
    });
  }

  return ranked.sort((a, b) => b.confidence - a.confidence);
}

function profileAdjustment(
  profile: SupportedChordProfile,
  chroma: readonly number[],
): number {
  const energy = (pitchClass: PitchClass) => chroma[PITCH_CLASSES.indexOf(pitchClass)] ?? 0;

  if (profile.root === "G") {
    const rootAndThirdSupport = Math.min(energy("G"), energy("B"));
    const fifthSupport = energy("D");
    const hasGShape = rootAndThirdSupport > 0.18 && fifthSupport > 0.12;

    return (hasGShape ? 0.1 : 0) + Math.min(0.06, fifthSupport * 0.07);
  }

  if (profile.root === "E" && profile.template.quality === "Minor") {
    const dEnergy = energy("D");
    const eEnergy = energy("E");
    const gEnergy = energy("G");
    const gAndBSupport = Math.min(energy("G"), energy("B"));
    const looksLikeGWithExtraE =
      dEnergy > 0.16 &&
      gAndBSupport > 0.18 &&
      gEnergy > eEnergy * 0.9 &&
      dEnergy > eEnergy * 0.28;

    return looksLikeGWithExtraE ? -Math.min(0.14, 0.06 + dEnergy * 0.09) : eEnergy * 0.02;
  }

  return 0;
}

function templateVector(root: number, template: ChordTemplate): number[] {
  const vector = Array.from({ length: 12 }, () => 0);
  template.intervals.forEach((interval, index) => {
    vector[(root + interval) % 12] = template.weights[index] ?? 1;
  });
  return vector;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function chordNotes(root: PitchClass, quality: ChordQuality): PitchClass[] {
  const template =
    quality === "Minor"
      ? MINOR_TEMPLATE
      : quality === "Major"
        ? MAJOR_TEMPLATE
        : null;
  if (!template) {
    return [root];
  }

  const rootIndex = PITCH_CLASSES.indexOf(root);
  return template.intervals.map((interval) => PITCH_CLASSES[(rootIndex + interval) % 12]);
}

export function supportedChordFrequencyBoundaries(): Record<
  string,
  Array<{
    note: string;
    frequency: number;
    minFrequency: number;
    maxFrequency: number;
  }>
> {
  return Object.fromEntries(
    SUPPORTED_CHORD_PROFILES.map((profile) => [
      chordName(profile),
      profile.openVoicing.map((note) => {
        const parsed = parseNoteName(note);
        const frequency = parsed ? midiToFrequency(parsed.midi) : 0;
        const ratio = 2 ** (profile.toleranceCents / 1200);

        return {
          note,
          frequency: roundFrequency(frequency),
          minFrequency: roundFrequency(frequency / ratio),
          maxFrequency: roundFrequency(frequency * ratio),
        };
      }),
    ]),
  );
}

function chordName(profile: SupportedChordProfile): string {
  return `${profile.root}${profile.template.suffix}`;
}

function roundFrequency(frequency: number): number {
  return Math.round(frequency * 100) / 100;
}
