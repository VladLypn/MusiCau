import type {
  ChordDetection,
  NoteDetection,
  RepresentativeNoteDetection,
} from "../pitch/types";
import type { ChordStabilityMetrics } from "../musicau/types";

export type MicrophoneStatus =
  | "idle"
  | "requesting"
  | "connected"
  | "denied"
  | "error";

export interface AdaptiveNoiseConfig {
  calibrationMs: number;
  noiseFloorAlpha: number;
  thresholdMultiplier: number;
  minimumThreshold: number;
}

export interface PitchDetectionConfig {
  minFrequency: number;
  maxFrequency: number;
  minClarity: number;
  updateIntervalMs: number;
  adaptiveNoise: AdaptiveNoiseConfig;
}

export interface AudioDebugMetrics {
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

export interface AudioSnapshot {
  detection: NoteDetection | null;
  chordDetection: ChordDetection | null;
  candidateChordDetection: ChordDetection | null;
  representativeNoteDetection: RepresentativeNoteDetection | null;
  debugMetrics: AudioDebugMetrics;
  chordStability: ChordStabilityMetrics;
  rms: number;
  gateOpen: boolean;
  timestamp: number;
}
