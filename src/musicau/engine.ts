import { applyHannWindow, calculateRms, BiquadBandpass, clamp01, removeDc } from "./dsp";
import { magnitudeSpectrum } from "./fft";
import { blendChroma, chromaFromSpectrum, harmonicChromaFromSpectrum } from "./chroma";
import { detectChordCandidatesFromChroma } from "./chords";
import { ChordStateStabilizer } from "./chordStabilizer";
import { frequencyToNote } from "./notes";
import { AdaptiveNoiseReducer, harmonicValidation } from "./noiseReduction";
import { detectPitchYin, validatePitchAutocorrelation } from "./pitchDetection";
import { evaluatePerformance } from "./performance";
import type {
  DetectedPerformance,
  ExpectedPerformance,
  MusicauAnalysisFrame,
  MusicauChordDetection,
  MusicauEngineConfig,
  MusicauNoteDetection,
  NoiseDebugMetrics,
} from "./types";

export const DEFAULT_MUSICAU_ENGINE_CONFIG: MusicauEngineConfig = {
  minFrequency: 70,
  maxFrequency: 1400,
  yinThreshold: 0.1,
  minConfidence: 0.48,
  sampleRate: 44100,
  fftSize: 4096,
  hopSize: 512,
  calibrationMs: 2500,
  rmsNoiseFloorAlpha: 0.995,
  thresholdMultiplier: 3,
  minimumThreshold: 0.001,
  spectralNoiseAlpha: 0.995,
  spectralSubtractionStrength: 1.45,
  harmonicToleranceCents: 24,
  chordConfirmationFrames: 5,
  chordSwitchMargin: 0.01,
  chordSmoothingWindow: 12,
  chordMinHoldMs: 350,
};

export class MusicauRealtimeEngine {
  private config: MusicauEngineConfig;
  private bandpass: BiquadBandpass;
  private noiseReducer: AdaptiveNoiseReducer;
  private chordStabilizer: ChordStateStabilizer;
  private lastFrame: MusicauAnalysisFrame | null = null;
  private recentPitchFrequencies: number[] = [];

  constructor(config: Partial<MusicauEngineConfig> = {}) {
    this.config = { ...DEFAULT_MUSICAU_ENGINE_CONFIG, ...config };
    this.bandpass = new BiquadBandpass(
      this.config.sampleRate,
      Math.max(55, this.config.minFrequency * 0.82),
      Math.min(2600, this.config.maxFrequency * 1.6),
    );
    this.noiseReducer = this.createNoiseReducer();
    this.chordStabilizer = this.createChordStabilizer();
  }

  setConfig(config: Partial<MusicauEngineConfig>): void {
    this.config = { ...this.config, ...config };
    this.bandpass = new BiquadBandpass(
      this.config.sampleRate,
      Math.max(55, this.config.minFrequency * 0.82),
      Math.min(2600, this.config.maxFrequency * 1.6),
    );
    this.noiseReducer = this.createNoiseReducer();
    this.chordStabilizer = this.createChordStabilizer();
  }

  analyze(audioChunk: Float32Array, timestamp = performance.now()): MusicauAnalysisFrame {
    const prepared = applyHannWindow(removeDc(this.bandpass.process(audioChunk)));
    const rms = calculateRms(prepared);
    const spectrum = magnitudeSpectrum(prepared, this.config.sampleRate, this.config.fftSize);
    const denoised = this.noiseReducer.process(
      spectrum.magnitudes,
      spectrum.frequencies,
      rms,
      timestamp,
    );

    if (!denoised.gateOpen) {
      const releasedChord = this.chordStabilizer.update([], timestamp);
      const chordStability = releasedChord.metrics;
      const quietFrame = {
        note: null,
        chord: null,
        chordCandidate: null,
        chroma: Array.from({ length: 12 }, () => 0),
        harmonicFeatures: [],
        debugMetrics: {
          ...denoised.debugMetrics,
          ...chordMetricsForDebug(chordStability),
        },
        chordStability,
        rms,
        gateOpen: false,
        transient: denoised.transient,
        timestamp,
      };
      this.lastFrame = quietFrame;
      return quietFrame;
    }

    const note = this.detectNoteFromPreparedBuffer(
      prepared,
      denoised.noiseReducedMagnitudes,
      denoised.frequencies,
      denoised.noiseFloorDb,
      denoised.debugMetrics,
    );
    const binChroma = chromaFromSpectrum(
      denoised.noiseReducedMagnitudes,
      denoised.frequencies,
      this.config.minFrequency,
      this.config.maxFrequency * 1.8,
    );
    const harmonicChroma = harmonicChromaFromSpectrum(
      denoised.noiseReducedMagnitudes,
      denoised.frequencies,
      this.config.minFrequency,
      this.config.maxFrequency,
    );
    const chroma = blendChroma(harmonicChroma, binChroma, 0.74);
    const chordCandidates = detectChordCandidatesFromChroma(chroma);
    const stabilizedChord = this.chordStabilizer.update(chordCandidates, timestamp);
    const harmonicResult = note
      ? harmonicValidation(
          denoised.noiseReducedMagnitudes,
          denoised.frequencies,
          note.frequency,
        )
      : null;

    const debugMetrics = {
      ...denoised.debugMetrics,
      harmonicConfidence: note?.harmonicConfidence ?? 0,
      pitchConfidence: note?.confidence ?? 0,
      ...chordMetricsForDebug(stabilizedChord.metrics),
    };

    const frame = {
      note,
      chord: stabilizedChord.chord,
      chordCandidate: stabilizedChord.rawCandidate,
      chroma,
      harmonicFeatures: harmonicResult?.features ?? [],
      debugMetrics,
      chordStability: stabilizedChord.metrics,
      rms,
      gateOpen: true,
      transient: denoised.transient,
      timestamp,
    };
    this.lastFrame = frame;
    return frame;
  }

  detectNote(audioChunk: Float32Array): MusicauNoteDetection | null {
    return this.analyze(audioChunk).note;
  }

  detectChord(audioChunk: Float32Array): MusicauChordDetection | null {
    return this.analyze(audioChunk).chord;
  }

  getLastFrame(): MusicauAnalysisFrame | null {
    return this.lastFrame;
  }

  private detectNoteFromPreparedBuffer(
    prepared: Float32Array,
    magnitudes: Float32Array,
    frequencies: Float32Array,
    noiseFloorDb: number,
    debugMetrics: NoiseDebugMetrics,
  ): MusicauNoteDetection | null {
    const yin = detectPitchYin(
      prepared,
      this.config.sampleRate,
      this.config.minFrequency,
      this.config.maxFrequency,
      this.config.yinThreshold,
    );

    if (!yin) {
      return null;
    }

    const autocorrelation = validatePitchAutocorrelation(
      prepared,
      this.config.sampleRate,
      yin.frequency,
    );
    const harmonic = harmonicValidation(magnitudes, frequencies, yin.frequency);
    const fftAgreement = estimateFftAgreement(magnitudes, frequencies, yin.frequency);
    const stability = this.scorePitchStability(yin.frequency);
    const snrConfidence = clamp01(
      (debugMetrics.signalToNoiseRatio - this.config.thresholdMultiplier) /
        Math.max(1.2, this.config.thresholdMultiplier),
    );
    const agreement =
      autocorrelation && autocorrelation.frequency > 0
        ? 1 - Math.min(1, Math.abs(1200 * Math.log2(yin.frequency / autocorrelation.frequency)) / 50)
        : 0;
    const confidence = clamp01(
      yin.confidence * 0.32 +
        (autocorrelation?.confidence ?? 0) * 0.16 +
        harmonic.confidence * 0.22 +
        agreement * 0.1 +
        fftAgreement * 0.08 +
        stability * 0.07 +
        snrConfidence * 0.05,
    );

    if (
      confidence < this.config.minConfidence ||
      harmonic.confidence < 0.18 ||
      agreement < 0.2
    ) {
      return null;
    }

    this.rememberPitch(yin.frequency);
    const note = frequencyToNote(yin.frequency);
    return {
      note: note.note,
      pitchClass: note.pitchClass,
      octave: note.octave,
      frequency: Math.round(yin.frequency * 10) / 10,
      centsOff: note.centsOff,
      confidence,
      yinConfidence: yin.confidence,
      autocorrelationConfidence: autocorrelation?.confidence ?? 0,
      harmonicConfidence: harmonic.confidence,
      gateOpen: true,
      noiseFloorDb,
    };
  }

  private createNoiseReducer(): AdaptiveNoiseReducer {
    return new AdaptiveNoiseReducer({
      calibrationMs: this.config.calibrationMs,
      rmsNoiseFloorAlpha: this.config.rmsNoiseFloorAlpha,
      spectralNoiseAlpha: this.config.spectralNoiseAlpha,
      thresholdMultiplier: this.config.thresholdMultiplier,
      minimumThreshold: this.config.minimumThreshold,
      spectralSubtractionStrength: this.config.spectralSubtractionStrength,
    });
  }

  private createChordStabilizer(): ChordStateStabilizer {
    return new ChordStateStabilizer({
      confirmationFrames: this.config.chordConfirmationFrames,
      switchMargin: this.config.chordSwitchMargin,
      smoothingWindow: this.config.chordSmoothingWindow,
      minHoldTimeMs: this.config.chordMinHoldMs,
    });
  }

  private scorePitchStability(frequency: number): number {
    if (this.recentPitchFrequencies.length < 2) {
      return 0.75;
    }

    const cents = this.recentPitchFrequencies.map(
      (recent) => 1200 * Math.log2(frequency / recent),
    );
    const mean = cents.reduce((sum, value) => sum + value, 0) / cents.length;
    const variance =
      cents.reduce((sum, value) => sum + (value - mean) ** 2, 0) / cents.length;
    const standardDeviation = Math.sqrt(variance);

    return clamp01(1 - standardDeviation / 38);
  }

  private rememberPitch(frequency: number): void {
    this.recentPitchFrequencies.push(frequency);
    if (this.recentPitchFrequencies.length > 8) {
      this.recentPitchFrequencies.shift();
    }
  }
}

function estimateFftAgreement(
  magnitudes: Float32Array,
  frequencies: Float32Array,
  targetFrequency: number,
): number {
  let bestMagnitude = 0;
  let bestFrequency = 0;
  const low = targetFrequency * 0.94;
  const high = targetFrequency * 1.06;

  for (let bin = 0; bin < frequencies.length; bin += 1) {
    const frequency = frequencies[bin];
    if (frequency < low || frequency > high) {
      continue;
    }

    if (magnitudes[bin] > bestMagnitude) {
      bestMagnitude = magnitudes[bin];
      bestFrequency = frequency;
    }
  }

  if (bestFrequency <= 0) {
    return 0;
  }

  const centsAway = Math.abs(1200 * Math.log2(bestFrequency / targetFrequency));
  return clamp01(1 - centsAway / 65);
}

const defaultEngine = new MusicauRealtimeEngine();

export function detectNote(audioChunk: Float32Array): MusicauNoteDetection | null {
  return defaultEngine.detectNote(audioChunk);
}

export function detectChord(audioChunk: Float32Array): MusicauChordDetection | null {
  return defaultEngine.detectChord(audioChunk);
}

export { evaluatePerformance };
export type { DetectedPerformance, ExpectedPerformance };

function chordMetricsForDebug(metrics: {
  currentChord: string | null;
  candidateChord: string | null;
  currentConfidence: number;
  candidateConfidence: number;
  confirmationProgress: number;
  holdTimeRemaining: number;
  smoothedProbabilities: Record<string, number>;
}) {
  return {
    currentChord: metrics.currentChord,
    candidateChord: metrics.candidateChord,
    currentConfidence: metrics.currentConfidence,
    candidateConfidence: metrics.candidateConfidence,
    confirmationProgress: metrics.confirmationProgress,
    holdTimeRemaining: metrics.holdTimeRemaining,
    smoothedProbabilities: metrics.smoothedProbabilities,
  };
}
