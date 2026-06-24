export type PitchClass =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";

export type ChordQuality =
  | "Major"
  | "Minor"
  | "Dominant 7th"
  | "Major 7th"
  | "Minor 7th"
  | "Suspended 2nd"
  | "Suspended 4th"
  | "Power";

export type ChordRecognitionState =
  | "UNKNOWN"
  | "CANDIDATE"
  | "CONFIRMED"
  | "LOCKED";

export interface MusicauNoteDetection {
  note: string;
  pitchClass: PitchClass;
  octave: number;
  frequency: number;
  centsOff: number;
  confidence: number;
  yinConfidence: number;
  autocorrelationConfidence: number;
  harmonicConfidence: number;
  gateOpen: boolean;
  noiseFloorDb: number;
}

export interface MusicauChordDetection {
  chord: string;
  root: PitchClass;
  quality: ChordQuality;
  notes: PitchClass[];
  confidence: number;
  missingNotes: PitchClass[];
  extraNotes: PitchClass[];
  chroma: number[];
  alternatives: Array<{
    chord: string;
    confidence: number;
  }>;
}

export interface HarmonicFeature {
  harmonic: number;
  frequency: number;
  magnitude: number;
}

export interface MusicauAnalysisFrame {
  note: MusicauNoteDetection | null;
  chord: MusicauChordDetection | null;
  chordCandidate: MusicauChordDetection | null;
  chroma: number[];
  harmonicFeatures: HarmonicFeature[];
  debugMetrics: NoiseDebugMetrics;
  chordStability: ChordStabilityMetrics;
  rms: number;
  gateOpen: boolean;
  transient: boolean;
  timestamp: number;
}

export interface ExpectedPerformance {
  note?: string;
  chord?: string;
  timestamp?: number;
  durationMs?: number;
}

export interface DetectedPerformance {
  note?: MusicauNoteDetection | null;
  chord?: MusicauChordDetection | null;
  timestamp?: number;
}

export interface PerformanceEvaluation {
  correct: boolean;
  score: number;
  timingAccuracy: number;
  centsOff?: number;
  missingNotes?: PitchClass[];
  extraNotes?: PitchClass[];
}

export interface StringFeedback {
  string: number;
  expected: string;
  detected: string | null;
  centsOff: number | null;
  correct: boolean;
}

export interface LearningFeedback {
  stringFeedback: StringFeedback[];
  incorrectChordNotes: PitchClass[];
  missedNotes: PitchClass[];
  strummingPattern: Array<{
    timestamp: number;
    intensity: number;
  }>;
}

export interface MusicauEngineConfig {
  minFrequency: number;
  maxFrequency: number;
  yinThreshold: number;
  minConfidence: number;
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  calibrationMs: number;
  rmsNoiseFloorAlpha: number;
  thresholdMultiplier: number;
  minimumThreshold: number;
  spectralNoiseAlpha: number;
  spectralSubtractionStrength: number;
  harmonicToleranceCents: number;
  chordConfirmationFrames: number;
  chordSwitchMargin: number;
  chordSmoothingWindow: number;
  chordMinHoldMs: number;
}

export interface SpectralFrame {
  magnitudes: Float32Array;
  frequencies: Float32Array;
  noiseReducedMagnitudes: Float32Array;
}

export interface NoiseDebugMetrics {
  rms: number;
  noiseFloor: number;
  threshold: number;
  signalToNoiseRatio: number;
  harmonicConfidence: number;
  pitchConfidence: number;
  currentChord: string | null;
  candidateChord: string | null;
  currentConfidence: number;
  candidateConfidence: number;
  confirmationProgress: number;
  holdTimeRemaining: number;
  smoothedProbabilities: Record<string, number>;
  calibrating: boolean;
  calibrationProgress: number;
}

export interface ChordStabilityMetrics {
  state: ChordRecognitionState;
  currentChord: string | null;
  candidateChord: string | null;
  currentConfidence: number;
  candidateConfidence: number;
  confirmationProgress: number;
  holdTimeRemaining: number;
  smoothedProbabilities: Record<string, number>;
}
