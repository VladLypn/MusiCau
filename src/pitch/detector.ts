import type { AudioSnapshot, PitchDetectionConfig } from "../types/audio";
import type { ChordDetection, NoteDetection } from "./types";
import {
  getTuningStatus,
  STANDARD_GUITAR_RANGE,
} from "../utils/music";
import { MusicauRealtimeEngine } from "../musicau";
import type {
  MusicauChordDetection,
  MusicauNoteDetection,
  PitchClass,
} from "../musicau/types";

export const DEFAULT_DETECTION_CONFIG: PitchDetectionConfig = {
  minFrequency: STANDARD_GUITAR_RANGE.minFrequency,
  maxFrequency: STANDARD_GUITAR_RANGE.maxFrequency,
  minClarity: 0.82,
  updateIntervalMs: 100,
  adaptiveNoise: {
    calibrationMs: 2500,
    noiseFloorAlpha: 0.995,
    thresholdMultiplier: 3,
    minimumThreshold: 0.001,
  },
};

export class GuitarPitchDetector {
  private readonly engine: MusicauRealtimeEngine;
  private readonly buffer: Float32Array<ArrayBuffer>;

  constructor(
    private readonly analyser: AnalyserNode,
    private readonly sampleRate: number,
    private readonly config: PitchDetectionConfig = DEFAULT_DETECTION_CONFIG,
  ) {
    this.buffer = new Float32Array(
      new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
    );
    this.engine = new MusicauRealtimeEngine({
      sampleRate,
      fftSize: Math.min(4096, analyser.fftSize),
      minFrequency: config.minFrequency,
      maxFrequency: config.maxFrequency,
      minConfidence: config.minClarity * 0.72,
      calibrationMs: config.adaptiveNoise.calibrationMs,
      rmsNoiseFloorAlpha: config.adaptiveNoise.noiseFloorAlpha,
      spectralNoiseAlpha: config.adaptiveNoise.noiseFloorAlpha,
      thresholdMultiplier: config.adaptiveNoise.thresholdMultiplier,
      minimumThreshold: config.adaptiveNoise.minimumThreshold,
    });
  }

  detect(): AudioSnapshot {
    const timestamp = performance.now();
    this.analyser.getFloatTimeDomainData(this.buffer);
    const frame = this.engine.analyze(this.buffer, timestamp);

    return {
      detection: frame.note ? this.toDetection(frame.note) : null,
      chordDetection: frame.chord ? this.toChordDetection(frame.chord) : null,
      candidateChordDetection: frame.chordCandidate
        ? this.toChordDetection(frame.chordCandidate)
        : null,
      representativeNoteDetection: frame.note
        ? {
            note: frame.note.pitchClass,
            octave: frame.note.octave,
            frequency: frame.note.frequency,
            confidence: frame.note.confidence,
            alternatives: [],
          }
        : null,
      debugMetrics: frame.debugMetrics,
      chordStability: frame.chordStability,
      rms: frame.rms,
      gateOpen: frame.gateOpen,
      timestamp: frame.timestamp,
    };
  }

  private emptySnapshot(rms: number, gateOpen: boolean): AudioSnapshot {
    return {
      detection: null,
      chordDetection: null,
      candidateChordDetection: null,
      representativeNoteDetection: null,
      debugMetrics: {
        rms,
        noiseFloor: 0,
        threshold: 0,
        signalToNoiseRatio: 0,
        harmonicConfidence: 0,
        pitchConfidence: 0,
        currentChord: null,
        candidateChord: null,
        currentConfidence: 0,
        candidateConfidence: 0,
        confirmationProgress: 0,
        holdTimeRemaining: 0,
        smoothedProbabilities: {},
        calibrating: false,
        calibrationProgress: 0,
      },
      chordStability: {
        state: "UNKNOWN",
        currentChord: null,
        candidateChord: null,
        currentConfidence: 0,
        candidateConfidence: 0,
        confirmationProgress: 0,
        holdTimeRemaining: 0,
        smoothedProbabilities: {},
      },
      rms,
      gateOpen,
      timestamp: performance.now(),
    };
  }

  private toDetection(detection: MusicauNoteDetection): NoteDetection {
    return {
      note: detection.pitchClass,
      octave: detection.octave,
      centsOff: detection.centsOff,
      frequency: detection.frequency,
      confidence: Math.max(0, Math.min(1, detection.confidence)),
      status: getTuningStatus(detection.centsOff),
    };
  }

  private toChordDetection(detection: MusicauChordDetection): ChordDetection {
    const chordTones = new Set(detection.notes);

    return {
      chord: detection.chord
        .replace(" Major", "")
        .replace(" Minor", "m")
        .replace(" Major 7", "maj7")
        .replace(" Minor 7", "m7"),
      root: detection.root,
      quality: detection.quality.toLowerCase(),
      confidence: detection.confidence,
      pitchClasses: detection.notes,
      activePitchClasses: detection.chroma.map((energy, index) => {
        const note = [
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
        ][index];

        return {
          note,
          energy,
          isChordTone: chordTones.has(note as PitchClass),
        };
      }),
      alternatives: detection.alternatives.map((alternative) => ({
        chord: alternative.chord
          .replace(" Major", "")
          .replace(" Minor", "m")
          .replace(" Major 7", "maj7")
          .replace(" Minor 7", "m7"),
        confidence: alternative.confidence,
      })),
    };
  }
}
