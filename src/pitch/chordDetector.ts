import type { ChordDetection, RepresentativeNoteDetection } from "./types";
import {
  NOTE_NAMES,
  STANDARD_GUITAR_RANGE,
  frequencyToMidi,
  midiToFrequency,
} from "../utils/music";

interface ChordTemplate {
  quality: string;
  suffix: string;
  intervals: number[];
  weights: number[];
  optionalIntervals?: number[];
  voicings?: number[][];
}

interface ChordDetectorOptions {
  analysisWindowSeconds: number;
  analysisHopMs: number;
  maxFluctuationCents: number;
  maxHarmonics: number;
  maxChordNotes: number;
  minConfidence: number;
  minBestSecondMargin: number;
  stabilityFrames: number;
  noiseFloorMultiplier: number;
  transientHoldMs: number;
  transientRiseRatio: number;
}

const DEFAULT_OPTIONS: ChordDetectorOptions = {
  analysisWindowSeconds: 0.18,
  analysisHopMs: 70,
  maxFluctuationCents: 22,
  maxHarmonics: 7,
  maxChordNotes: 5,
  minConfidence: 0.58,
  minBestSecondMargin: 0.018,
  stabilityFrames: 2,
  noiseFloorMultiplier: 1.35,
  transientHoldMs: 80,
  transientRiseRatio: 2.35,
};

const CHORD_TEMPLATES: ChordTemplate[] = [
  {
    quality: "major",
    suffix: "",
    intervals: [0, 4, 7],
    weights: [1, 0.82, 0.9],
    voicings: [
      [0, 4, 7, 12, 16],
      [0, 7, 12, 16, 19],
    ],
  },
  {
    quality: "minor",
    suffix: "m",
    intervals: [0, 3, 7],
    weights: [1, 0.82, 0.9],
    voicings: [
      [0, 7, 12, 15, 19],
      [0, 7, 12, 19, 24],
    ],
  },
  { quality: "dominant seventh", suffix: "7", intervals: [0, 4, 7, 10], weights: [1, 0.8, 0.88, 0.66] },
  { quality: "major seventh", suffix: "maj7", intervals: [0, 4, 7, 11], weights: [1, 0.8, 0.88, 0.62] },
  { quality: "minor seventh", suffix: "m7", intervals: [0, 3, 7, 10], weights: [1, 0.8, 0.88, 0.66] },
  { quality: "minor major seventh", suffix: "mMaj7", intervals: [0, 3, 7, 11], weights: [1, 0.76, 0.86, 0.58] },
  { quality: "sixth", suffix: "6", intervals: [0, 4, 7, 9], weights: [1, 0.76, 0.86, 0.58] },
  { quality: "minor sixth", suffix: "m6", intervals: [0, 3, 7, 9], weights: [1, 0.76, 0.86, 0.58] },
  { quality: "suspended fourth", suffix: "sus4", intervals: [0, 5, 7], weights: [1, 0.82, 0.9] },
  { quality: "suspended second", suffix: "sus2", intervals: [0, 2, 7], weights: [1, 0.76, 0.9] },
  { quality: "seventh suspended fourth", suffix: "7sus4", intervals: [0, 5, 7, 10], weights: [1, 0.78, 0.86, 0.62] },
  { quality: "diminished", suffix: "dim", intervals: [0, 3, 6], weights: [1, 0.8, 0.82] },
  { quality: "diminished seventh", suffix: "dim7", intervals: [0, 3, 6, 9], weights: [1, 0.78, 0.82, 0.58] },
  { quality: "half-diminished seventh", suffix: "m7b5", intervals: [0, 3, 6, 10], weights: [1, 0.78, 0.82, 0.58] },
  { quality: "augmented", suffix: "aug", intervals: [0, 4, 8], weights: [1, 0.78, 0.78] },
  { quality: "add ninth", suffix: "add9", intervals: [0, 4, 7, 14], weights: [1, 0.76, 0.86, 0.46] },
  { quality: "minor add ninth", suffix: "madd9", intervals: [0, 3, 7, 14], weights: [1, 0.76, 0.86, 0.46] },
  { quality: "ninth", suffix: "9", intervals: [0, 4, 7, 10, 14], weights: [1, 0.74, 0.84, 0.58, 0.42] },
  { quality: "minor ninth", suffix: "m9", intervals: [0, 3, 7, 10, 14], weights: [1, 0.74, 0.84, 0.58, 0.42] },
  { quality: "major ninth", suffix: "maj9", intervals: [0, 4, 7, 11, 14], weights: [1, 0.74, 0.84, 0.54, 0.42] },
  { quality: "power chord", suffix: "5", intervals: [0, 7], weights: [1, 0.9] },
];

const COMMON_OPEN_CHORD_ROLES: Record<
  string,
  Array<{ midis: number[]; weight: number }>
> = {
  G: [
    { midis: [43, 55, 67], weight: 0.38 },
    { midis: [47, 59], weight: 0.28 },
    { midis: [50, 62], weight: 0.34 },
  ],
  Em: [
    { midis: [40, 52, 64], weight: 0.4 },
    { midis: [47, 59], weight: 0.28 },
    { midis: [55], weight: 0.32 },
  ],
  D: [
    { midis: [50, 62], weight: 0.38 },
    { midis: [54, 66], weight: 0.28 },
    { midis: [45, 57, 69], weight: 0.34 },
  ],
  A: [
    { midis: [45, 57, 69], weight: 0.38 },
    { midis: [49, 61], weight: 0.28 },
    { midis: [40, 52, 64], weight: 0.34 },
  ],
  C: [
    { midis: [48, 60], weight: 0.38 },
    { midis: [40, 52, 64], weight: 0.28 },
    { midis: [43, 55, 67], weight: 0.34 },
  ],
  E: [
    { midis: [40, 52, 64], weight: 0.38 },
    { midis: [44, 56], weight: 0.28 },
    { midis: [47, 59], weight: 0.34 },
  ],
  Am: [
    { midis: [45, 57, 69], weight: 0.38 },
    { midis: [48, 60], weight: 0.28 },
    { midis: [40, 52, 64], weight: 0.34 },
  ],
  Dm: [
    { midis: [50, 62], weight: 0.38 },
    { midis: [53, 65], weight: 0.28 },
    { midis: [45, 57, 69], weight: 0.34 },
  ],
};

export class ChordDetector {
  private readonly timeBuffer: Float32Array<ArrayBuffer>;
  private readonly windowSize: number;
  private readonly options: ChordDetectorOptions;
  private noiseProfile: number[] | null = null;
  private lastAnalysisAt = 0;
  private lastDetection: ChordDetection | null = null;
  private lastCandidateDetection: ChordDetection | null = null;
  private lastRepresentativeNote: RepresentativeNoteDetection | null = null;
  private lastRms = 0;
  private lastTransientAt = -Infinity;
  private pendingChord: string | null = null;
  private pendingSince = 0;
  private pendingFrames = 0;

  constructor(
    private readonly analyser: AnalyserNode,
    private readonly sampleRate: number,
    options: Partial<ChordDetectorOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.timeBuffer = new Float32Array(
      new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
    );
    this.windowSize = Math.min(
      Math.round(sampleRate * this.options.analysisWindowSeconds),
      analyser.fftSize,
    );
  }

  observeNoise(timestamp = performance.now(), rms = 0): void {
    if (timestamp - this.lastAnalysisAt < this.options.analysisHopMs) {
      this.lastRms = rms;
      return;
    }

    this.lastAnalysisAt = timestamp;
    const slice = this.readAnalysisSlice();
    const noteEnergies = this.estimateNoteEnergies(slice);
    this.updateNoiseProfile(noteEnergies);
    this.lastDetection = null;
    this.lastCandidateDetection = null;
    this.lastRepresentativeNote = null;
    this.pendingChord = null;
    this.pendingSince = 0;
    this.pendingFrames = 0;
    this.lastRms = rms;
  }

  detect(timestamp = performance.now(), rms = 0): ChordDetection | null {
    if (timestamp - this.lastAnalysisAt < this.options.analysisHopMs) {
      return this.lastDetection;
    }

    this.lastAnalysisAt = timestamp;
    if (this.isLikelyAttackTransient(timestamp, rms)) {
      return this.lastDetection;
    }

    const analysis = this.analyzeCurrentSlice();
    this.lastCandidateDetection = analysis.candidate;
    this.lastRepresentativeNote = analysis.representativeNote;
    this.lastDetection = this.stabilizeDetection(analysis.accepted, timestamp);
    this.lastRms = rms;
    return this.lastDetection;
  }

  getCandidateDetection(): ChordDetection | null {
    return this.lastCandidateDetection;
  }

  getRepresentativeNoteDetection(): RepresentativeNoteDetection | null {
    return this.lastRepresentativeNote;
  }

  private analyzeCurrentSlice(): {
    candidate: ChordDetection | null;
    accepted: ChordDetection | null;
    representativeNote: RepresentativeNoteDetection | null;
  } {
    const slice = this.readAnalysisSlice();
    const noteEnergies = this.estimateNoteEnergies(slice);
    const profileDenoisedEnergies = subtractNoiseProfile(
      noteEnergies,
      this.noiseProfile,
      this.options.noiseFloorMultiplier,
    );
    const denoisedEnergies = suppressLikelyHarmonicAliases(
      subtractAverageFloor(profileDenoisedEnergies),
    );
    const representativeNote = selectRepresentativeMiddleNote(denoisedEnergies);
    const chroma = foldNoteEnergiesToChroma(denoisedEnergies);
    const maxEnergy = Math.max(...chroma);

    if (maxEnergy <= 0) {
      return { candidate: null, accepted: null, representativeNote };
    }

    const normalizedChroma = chroma.map((value) => value / maxEnergy);
    const activePitchClasses = normalizedChroma
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value >= 0.16)
      .sort((a, b) => b.value - a.value);

    if (activePitchClasses.length < 2) {
      return { candidate: null, accepted: null, representativeNote };
    }

    const bassNote = selectBassNote(denoisedEnergies);
    const match = this.findBestChord(normalizedChroma, denoisedEnergies);
    const candidate = match.best
      ? this.toChordDetection(match.best, normalizedChroma, bassNote, match.ranked)
      : null;
    const accepted = candidate && this.isAcceptedMatch(match) ? candidate : null;

    return { candidate, accepted, representativeNote };
  }

  private toChordDetection(
    match: { root: number; template: ChordTemplate; confidence: number },
    chroma: number[],
    bassNote: string | null,
    ranked: Array<{ root: number; template: ChordTemplate; confidence: number }>,
  ): ChordDetection {
    const chordTones = new Set(
      match.template.intervals.map((interval) => (match.root + interval) % 12),
    );
    const activePitchClasses = chroma
      .map((energy, index) => ({
        note: NOTE_NAMES[index],
        energy: Math.max(0, Math.min(1, energy)),
        isChordTone: chordTones.has(index),
      }))
      .filter(({ energy }) => energy >= 0.12)
      .sort((a, b) => b.energy - a.energy);
    const chord = `${NOTE_NAMES[match.root]}${match.template.suffix}`;

    return {
      chord,
      root: NOTE_NAMES[match.root],
      quality: match.template.quality,
      confidence: Math.max(0, Math.min(1, match.confidence)),
      pitchClasses: match.template.intervals
        .slice(0, this.options.maxChordNotes)
        .map((interval) => NOTE_NAMES[(match.root + interval) % 12]),
      activePitchClasses,
      bassNote: bassNote && bassNote !== NOTE_NAMES[match.root] ? bassNote : undefined,
      alternatives: ranked
        .filter((candidate) => {
          const candidateName = `${NOTE_NAMES[candidate.root]}${candidate.template.suffix}`;
          return candidateName !== chord;
        })
        .slice(0, 3)
        .map((candidate) => ({
          chord: `${NOTE_NAMES[candidate.root]}${candidate.template.suffix}`,
          confidence: Math.max(0, Math.min(1, candidate.confidence)),
        })),
    };
  }

  private isAcceptedMatch(
    match: {
      best: { root: number; template: ChordTemplate; confidence: number } | null;
      second: { root: number; template: ChordTemplate; confidence: number } | null;
    },
  ): boolean {
    if (!match.best) {
      return false;
    }

    return (
      match.best.confidence >= this.options.minConfidence &&
      match.best.confidence - (match.second?.confidence ?? 0) >=
        this.options.minBestSecondMargin
    );
  }

  private readAnalysisSlice(): Float32Array {
    this.analyser.getFloatTimeDomainData(this.timeBuffer);

    const start = this.timeBuffer.length - this.windowSize;
    const slice = this.timeBuffer.slice(start);
    const mean = slice.reduce((sum, sample) => sum + sample, 0) / slice.length;

    for (let index = 0; index < slice.length; index += 1) {
      // Remove the average waveform offset, then use a Hann window so the
      // 100 ms slice has fewer artificial edge-frequency spikes.
      const hann =
        0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (slice.length - 1));
      slice[index] = (slice[index] - mean) * hann;
    }

    return slice;
  }

  private estimateNoteEnergies(slice: Float32Array): number[] {
    const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));
    const maxMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.maxFrequency));
    const energies: number[] = [];

    for (let midi = minMidi; midi <= maxMidi; midi += 1) {
      const frequency = midiToFrequency(midi);
      const energy = this.harmonicEnergy(slice, frequency);
      energies.push(energy / Math.sqrt(frequency));
    }

    return energies;
  }

  private harmonicEnergy(slice: Float32Array, fundamentalFrequency: number): number {
    let energy = 0;

    for (let harmonic = 1; harmonic <= this.options.maxHarmonics; harmonic += 1) {
      const harmonicFrequency = fundamentalFrequency * harmonic;
      if (harmonicFrequency > STANDARD_GUITAR_RANGE.maxFrequency * 2.5) {
        break;
      }

      const weight = 1 / harmonic;
      energy += weight * this.bestFluctuationEnergy(slice, harmonicFrequency);
    }

    return energy;
  }

  private bestFluctuationEnergy(slice: Float32Array, frequency: number): number {
    const fluctuationRatio = 2 ** (this.options.maxFluctuationCents / 1200);
    const candidates = [frequency / fluctuationRatio, frequency, frequency * fluctuationRatio];

    return Math.max(
      ...candidates.map((candidate) =>
        goertzelPower(slice, this.sampleRate, candidate),
      ),
    );
  }

  private findBestChord(chroma: number[], noteEnergies: number[]) {
    const ranked: Array<{
      root: number;
      template: ChordTemplate;
      confidence: number;
    }> = [];

    for (let root = 0; root < NOTE_NAMES.length; root += 1) {
      for (const template of CHORD_TEMPLATES) {
        if (template.intervals.length > this.options.maxChordNotes) {
          continue;
        }

        const vector = templateVector(root, template);
        const similarity = cosineSimilarity(chroma, vector);
        const chordPitchClasses = new Set(
          template.intervals.map((interval) => (root + interval) % 12),
        );
        const chordEnergy = [...chordPitchClasses].reduce((sum, pitchClass) => {
          return sum + chroma[pitchClass];
        }, 0);
        const totalEnergy = chroma.reduce((sum, value) => sum + value, 0);
        const coverage = totalEnergy > 0 ? chordEnergy / totalEnergy : 0;
        const missingTonePenalty = scoreMissingTonePenalty(
          root,
          template,
          chroma,
        );
        const extraTonePenalty = scoreExtraTonePenalty(root, template, chroma);
        const voicingScore = scoreGuitarVoicing(root, template, noteEnergies);
        const namedOpenChordScore = scoreNamedOpenChordSupport(
          root,
          template,
          noteEnergies,
        );
        const chordName = `${NOTE_NAMES[root]}${template.suffix}`;
        const rootSupport = scoreLowRootSupport(root, noteEnergies);
        const ambiguityPenalty = scoreAmbiguityPenalty(root, template, chroma);
        const openChordBonus = scoreOpenChordBonus(
          chordName,
          chroma,
          namedOpenChordScore,
        );
        const confidence =
          similarity * 0.46 +
          coverage * 0.2 +
          voicingScore * 0.08 +
          namedOpenChordScore * 0.16 +
          rootSupport * 0.07 -
          missingTonePenalty -
          extraTonePenalty -
          ambiguityPenalty +
          openChordBonus;

        ranked.push({ root, template, confidence });
      }
    }

    ranked.sort((a, b) => b.confidence - a.confidence);
    const best = ranked[0] ?? null;
    const second = ranked.find((candidate) => {
      if (!best) {
        return true;
      }

      return (
        candidate.root !== best.root ||
        candidate.template.suffix !== best.template.suffix
      );
    }) ?? null;

    return { best, second, ranked };
  }

  private updateNoiseProfile(noteEnergies: number[]): void {
    if (!this.noiseProfile) {
      this.noiseProfile = [...noteEnergies];
      return;
    }

    this.noiseProfile = this.noiseProfile.map((current, index) => {
      const next = noteEnergies[index] ?? 0;
      return current * 0.92 + next * 0.08;
    });
  }

  private isLikelyAttackTransient(timestamp: number, rms: number): boolean {
    if (this.lastRms > 0 && rms > this.lastRms * this.options.transientRiseRatio) {
      this.lastTransientAt = timestamp;
      this.lastRms = rms;
      return true;
    }

    const isInsideTransientHold =
      timestamp - this.lastTransientAt < this.options.transientHoldMs;
    this.lastRms = rms;
    return isInsideTransientHold;
  }

  private stabilizeDetection(
    detection: ChordDetection | null,
    timestamp: number,
  ): ChordDetection | null {
    if (!detection) {
      this.pendingChord = null;
      this.pendingSince = 0;
      this.pendingFrames = 0;
      return this.lastDetection;
    }

    if (this.lastDetection?.chord === detection.chord) {
      return {
        ...detection,
        stableSince: this.lastDetection.stableSince ?? timestamp,
      };
    }

    if (this.pendingChord === detection.chord) {
      this.pendingFrames += 1;
    } else {
      this.pendingChord = detection.chord;
      this.pendingSince = timestamp;
      this.pendingFrames = 1;
    }

    if (this.pendingFrames < this.options.stabilityFrames) {
      return this.lastDetection;
    }

    return {
      ...detection,
      stableSince: this.pendingSince,
    };
  }
}

function subtractNoiseProfile(
  values: number[],
  noiseProfile: number[] | null,
  multiplier: number,
): number[] {
  if (!noiseProfile) {
    return values;
  }

  return values.map((value, index) =>
    Math.max(0, value - (noiseProfile[index] ?? 0) * multiplier),
  );
}

function subtractAverageFloor(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const floor = Math.max(median, average * 0.28);

  return values.map((value) => Math.max(0, value - floor));
}

function suppressLikelyHarmonicAliases(values: number[]): number[] {
  const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));
  const suppressed = [...values];

  for (let highIndex = 0; highIndex < values.length; highIndex += 1) {
    const highMidi = minMidi + highIndex;
    const highFrequency = midiToFrequency(highMidi);
    let strongestExplainer = 0;

    for (let lowIndex = 0; lowIndex < highIndex; lowIndex += 1) {
      const lowMidi = minMidi + lowIndex;
      const lowFrequency = midiToFrequency(lowMidi);
      const harmonicNumber = Math.round(highFrequency / lowFrequency);

      if (harmonicNumber < 2 || harmonicNumber > 8) {
        continue;
      }

      const harmonicFrequency = lowFrequency * harmonicNumber;
      const centsAway = Math.abs(
        1200 * Math.log2(highFrequency / harmonicFrequency),
      );

      if (centsAway <= 24) {
        strongestExplainer = Math.max(
          strongestExplainer,
          values[lowIndex] / harmonicNumber,
        );
      }
    }

    if (strongestExplainer > 0) {
      suppressed[highIndex] = Math.max(
        0,
        values[highIndex] - strongestExplainer * 0.72,
      );
    }
  }

  return suppressed;
}

function foldNoteEnergiesToChroma(noteEnergies: number[]): number[] {
  const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));
  const chroma = Array.from({ length: 12 }, () => 0);

  noteEnergies.forEach((energy, index) => {
    const midi = minMidi + index;
    const pitchClass = ((midi % 12) + 12) % 12;
    chroma[pitchClass] += energy;
  });

  return chroma;
}

function scoreGuitarVoicing(
  root: number,
  template: ChordTemplate,
  noteEnergies: number[],
): number {
  if (!template.voicings?.length) {
    return 0;
  }

  const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));
  const maxEnergy = Math.max(...noteEnergies);
  if (maxEnergy <= 0) {
    return 0;
  }

  let bestScore = 0;
  for (const voicing of template.voicings) {
    let score = 0;
    let count = 0;

    for (let rootMidi = minMidi; rootMidi < minMidi + 24; rootMidi += 1) {
      if (((rootMidi % 12) + 12) % 12 !== root) {
        continue;
      }

      const voicingScore = voicing.reduce((sum, interval) => {
        const index = rootMidi + interval - minMidi;
        if (index < 0 || index >= noteEnergies.length) {
          return sum;
        }

        return sum + noteEnergies[index] / maxEnergy;
      }, 0);

      score = Math.max(score, voicingScore / voicing.length);
      count += 1;
    }

    if (count > 0) {
      bestScore = Math.max(bestScore, score);
    }
  }

  return Math.max(0, Math.min(1, bestScore));
}

function scoreNamedOpenChordSupport(
  root: number,
  template: ChordTemplate,
  noteEnergies: number[],
): number {
  const chordName = `${NOTE_NAMES[root]}${template.suffix}`;
  const maxEnergy = Math.max(...noteEnergies);
  if (maxEnergy <= 0) {
    return 0;
  }

  const roles = COMMON_OPEN_CHORD_ROLES[chordName];
  if (!roles) {
    return 0;
  }

  return weightedRoleSupport(noteEnergies, roles, maxEnergy);
}

function weightedRoleSupport(
  noteEnergies: number[],
  roles: Array<{ midis: number[]; weight: number }>,
  maxEnergy: number,
): number {
  const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));

  const score = roles.reduce((sum, role) => {
    const roleEnergy = role.midis.reduce((best, midi) => {
      const index = midi - minMidi;
      if (index < 0 || index >= noteEnergies.length) {
        return best;
      }

      return Math.max(best, noteEnergies[index] / maxEnergy);
    }, 0);

    return sum + Math.min(1, roleEnergy) * role.weight;
  }, 0);

  return Math.max(0, Math.min(1, score));
}

function scoreLowRootSupport(root: number, noteEnergies: number[]): number {
  const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));
  const maxEnergy = Math.max(...noteEnergies);
  if (maxEnergy <= 0) {
    return 0;
  }

  let bestRootEnergy = 0;
  for (let index = 0; index < Math.min(noteEnergies.length, 24); index += 1) {
    const midi = minMidi + index;
    if (((midi % 12) + 12) % 12 === root) {
      bestRootEnergy = Math.max(bestRootEnergy, noteEnergies[index] / maxEnergy);
    }
  }

  return Math.max(0, Math.min(1, bestRootEnergy));
}

function scoreAmbiguityPenalty(
  root: number,
  template: ChordTemplate,
  chroma: number[],
): number {
  const chordName = `${NOTE_NAMES[root]}${template.suffix}`;
  const e = chroma[NOTE_NAMES.indexOf("E")];
  const d = chroma[NOTE_NAMES.indexOf("D")];
  const g = chroma[NOTE_NAMES.indexOf("G")];
  const b = chroma[NOTE_NAMES.indexOf("B")];

  // G and Em share G/B. Push the score toward the chord whose distinguishing
  // pitch is stronger: D for G, E for Em.
  if (chordName === "G" && e > d * 1.35 && g > 0.25 && b > 0.25) {
    return 0.045;
  }

  if (chordName === "Em" && d > e * 1.35 && g > 0.25 && b > 0.25) {
    return 0.045;
  }

  if (chordName === "G5" && b > 0.22) {
    return 0.06;
  }

  return 0;
}

function scoreMissingTonePenalty(
  root: number,
  template: ChordTemplate,
  chroma: number[],
): number {
  const requiredIntervals =
    template.optionalIntervals?.length
      ? template.intervals.filter(
          (interval) => !template.optionalIntervals?.includes(interval),
        )
      : template.intervals;
  const requiredPitchClasses = [
    ...new Set(requiredIntervals.map((interval) => (root + interval) % 12)),
  ];
  const maxTone = Math.max(
    ...requiredPitchClasses.map((pitchClass) => chroma[pitchClass]),
  );

  if (maxTone <= 0) {
    return 0.22;
  }

  const missingCount = requiredPitchClasses.filter(
    (pitchClass) => chroma[pitchClass] < maxTone * 0.18,
  ).length;

  return Math.min(0.22, missingCount * 0.055);
}

function scoreExtraTonePenalty(
  root: number,
  template: ChordTemplate,
  chroma: number[],
): number {
  const chordPitchClasses = new Set(
    template.intervals.map((interval) => (root + interval) % 12),
  );
  const totalEnergy = chroma.reduce((sum, value) => sum + value, 0);
  if (totalEnergy <= 0) {
    return 0;
  }

  const extraEnergy = chroma.reduce((sum, value, pitchClass) => {
    return chordPitchClasses.has(pitchClass) ? sum : sum + value;
  }, 0);

  return Math.min(0.16, (extraEnergy / totalEnergy) * 0.18);
}

function scoreOpenChordBonus(
  chordName: string,
  chroma: number[],
  namedOpenChordScore: number,
): number {
  const g = chroma[NOTE_NAMES.indexOf("G")];
  const b = chroma[NOTE_NAMES.indexOf("B")];
  const d = chroma[NOTE_NAMES.indexOf("D")];
  const e = chroma[NOTE_NAMES.indexOf("E")];

  if (
    chordName === "G" &&
    namedOpenChordScore >= 0.28 &&
    g >= 0.2 &&
    b >= 0.16 &&
    d >= 0.16
  ) {
    return 0.14;
  }

  if (
    chordName === "Em" &&
    namedOpenChordScore >= 0.28 &&
    e >= 0.2 &&
    g >= 0.16 &&
    b >= 0.16
  ) {
    return 0.08;
  }

  return 0;
}

function selectBassNote(noteEnergies: number[]): string | null {
  const maxEnergy = Math.max(...noteEnergies);
  if (maxEnergy <= 0) {
    return null;
  }

  const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));
  const bassCandidate = noteEnergies.findIndex(
    (energy, index) => index < 28 && energy / maxEnergy >= 0.22,
  );

  if (bassCandidate === -1) {
    return null;
  }

  const midi = minMidi + bassCandidate;
  const noteIndex = ((midi % 12) + 12) % 12;
  return NOTE_NAMES[noteIndex];
}

function selectRepresentativeMiddleNote(
  noteEnergies: number[],
): RepresentativeNoteDetection | null {
  const maxEnergy = Math.max(...noteEnergies);
  if (maxEnergy <= 0) {
    return null;
  }

  const minMidi = Math.round(frequencyToMidi(STANDARD_GUITAR_RANGE.minFrequency));
  const closeCandidates = noteEnergies
    .map((energy, index) => ({
      energy,
      midi: minMidi + index,
      confidence: energy / maxEnergy,
    }))
    .filter(({ confidence }) => confidence >= 0.82)
    .sort((a, b) => a.midi - b.midi);

  const candidates =
    closeCandidates.length > 0
      ? closeCandidates
      : noteEnergies
          .map((energy, index) => ({
            energy,
            midi: minMidi + index,
            confidence: energy / maxEnergy,
          }))
          .sort((a, b) => b.energy - a.energy)
          .slice(0, 1);

  const middleCandidate = candidates[Math.floor((candidates.length - 1) / 2)];
  if (!middleCandidate) {
    return null;
  }

  const frequency = midiToFrequency(middleCandidate.midi);
  const noteIndex = ((middleCandidate.midi % 12) + 12) % 12;
  const octave = Math.floor(middleCandidate.midi / 12) - 1;

  return {
    note: NOTE_NAMES[noteIndex],
    octave,
    frequency,
    confidence: Math.max(0, Math.min(1, middleCandidate.confidence)),
    alternatives: candidates.map(({ midi }) => midiToNoteLabel(midi)),
  };
}

function midiToNoteLabel(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function templateVector(root: number, template: ChordTemplate): number[] {
  const vector = Array.from({ length: 12 }, () => 0);
  template.intervals.forEach((interval, index) => {
    vector[(root + interval) % 12] = template.weights[index];
  });
  return vector;
}

function goertzelPower(
  samples: Float32Array,
  sampleRate: number,
  targetFrequency: number,
): number {
  const omega = (2 * Math.PI * targetFrequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previous2 = 0;

  for (const sample of samples) {
    const current = sample + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }

  return previous2 ** 2 + previous ** 2 - coefficient * previous * previous2;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    magnitudeA += a[index] ** 2;
    magnitudeB += b[index] ** 2;
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}
