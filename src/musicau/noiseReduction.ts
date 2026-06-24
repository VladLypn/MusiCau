import { amplitudeToDb, clamp01, median, spectralCentroid } from "./dsp";
import type { NoiseDebugMetrics, SpectralFrame } from "./types";

interface AdaptiveNoiseReducerOptions {
  calibrationMs: number;
  rmsNoiseFloorAlpha: number;
  spectralNoiseAlpha: number;
  thresholdMultiplier: number;
  minimumThreshold: number;
  spectralSubtractionStrength: number;
}

export class AdaptiveNoiseReducer {
  private spectralNoiseFloor: Float32Array | null = null;
  private rmsNoiseFloor: number | null = null;
  private lastRms = 0;
  private startedAt: number | null = null;
  private gateOpenUntil = -Infinity;

  constructor(private readonly options: AdaptiveNoiseReducerOptions) {}

  process(
    magnitudes: Float32Array,
    frequencies: Float32Array,
    rms: number,
    timestamp: number,
  ): SpectralFrame & {
    gateOpen: boolean;
    transient: boolean;
    noiseFloorDb: number;
    debugMetrics: NoiseDebugMetrics;
  } {
    if (this.startedAt === null) {
      this.startedAt = timestamp;
    }

    if (this.rmsNoiseFloor === null) {
      this.rmsNoiseFloor =
        this.options.calibrationMs <= 0
          ? this.options.minimumThreshold
          : Math.max(rms, this.options.minimumThreshold);
    }

    if (!this.spectralNoiseFloor || this.spectralNoiseFloor.length !== magnitudes.length) {
      this.spectralNoiseFloor = new Float32Array(magnitudes.length);
      const initialScale = this.options.calibrationMs <= 0 ? 0.05 : 1;
      for (let bin = 0; bin < magnitudes.length; bin += 1) {
        this.spectralNoiseFloor[bin] = magnitudes[bin] * initialScale;
      }
    }

    const calibrationElapsed = timestamp - this.startedAt;
    const calibrating = calibrationElapsed < this.options.calibrationMs;
    const threshold = Math.max(
      this.rmsNoiseFloor * this.options.thresholdMultiplier,
      this.options.minimumThreshold,
    );
    const signalToNoiseRatio = rms / Math.max(this.rmsNoiseFloor, 1e-8);
    const isTransient =
      this.lastRms > 0 &&
      rms > this.lastRms * 2.8 &&
      isLikelyImpulsiveNoise(magnitudes, frequencies);
    const speechLike = isLikelySpeechOrTv(magnitudes, frequencies);
    const shouldOpenGate =
      !calibrating &&
      rms >= threshold &&
      signalToNoiseRatio >= 1.6 &&
      !speechLike &&
      !isTransient;
    if (shouldOpenGate) {
      this.gateOpenUntil = timestamp + 280;
    }

    const gateOpen =
      shouldOpenGate ||
      (!calibrating &&
        timestamp <= this.gateOpenUntil &&
        signalToNoiseRatio >= 1.15 &&
        !speechLike &&
        !isTransient);

    const shouldTrackNoise = calibrating || !gateOpen || rms < threshold || speechLike;
    const rmsAlpha = shouldTrackNoise
      ? this.options.rmsNoiseFloorAlpha
      : Math.min(0.9998, this.options.rmsNoiseFloorAlpha + 0.004);

    this.rmsNoiseFloor =
      rmsAlpha * this.rmsNoiseFloor + (1 - rmsAlpha) * rms;

    const spectralAlpha = shouldTrackNoise
      ? this.options.spectralNoiseAlpha
      : Math.min(0.9998, this.options.spectralNoiseAlpha + 0.004);

    for (let bin = 0; bin < magnitudes.length; bin += 1) {
      const current = this.spectralNoiseFloor[bin];
      const incoming = magnitudes[bin];
      this.spectralNoiseFloor[bin] =
        spectralAlpha * current + (1 - spectralAlpha) * incoming;
    }

    const noiseReducedMagnitudes = new Float32Array(magnitudes.length);
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
      const reduced =
        magnitudes[bin] -
        this.spectralNoiseFloor[bin] * this.options.spectralSubtractionStrength;
      const likelyNoise = magnitudes[bin] <= this.spectralNoiseFloor[bin] * 1.12;
      noiseReducedMagnitudes[bin] = likelyNoise ? 0 : Math.max(0, reduced);
    }

    const floorValues = Array.from(this.spectralNoiseFloor);
    this.lastRms = rms;
    const updatedThreshold = Math.max(
      this.rmsNoiseFloor * this.options.thresholdMultiplier,
      this.options.minimumThreshold,
    );
    const updatedSnr = rms / Math.max(this.rmsNoiseFloor, 1e-8);

    return {
      magnitudes,
      frequencies,
      noiseReducedMagnitudes,
      gateOpen,
      transient: isTransient,
      noiseFloorDb: amplitudeToDb(median(floorValues)),
      debugMetrics: {
        rms,
        noiseFloor: this.rmsNoiseFloor,
        threshold: updatedThreshold,
        signalToNoiseRatio: updatedSnr,
        harmonicConfidence: 0,
        pitchConfidence: 0,
        currentChord: null,
        candidateChord: null,
        currentConfidence: 0,
        candidateConfidence: 0,
        confirmationProgress: 0,
        holdTimeRemaining: 0,
        smoothedProbabilities: {},
        calibrating,
        calibrationProgress:
          this.options.calibrationMs <= 0
            ? 1
            : clamp01(calibrationElapsed / this.options.calibrationMs),
      },
    };
  }
}

export function harmonicValidation(
  magnitudes: Float32Array,
  frequencies: Float32Array,
  fundamental: number,
  maxHarmonics = 8,
): {
  confidence: number;
  features: Array<{ harmonic: number; frequency: number; magnitude: number }>;
} {
  const features: Array<{ harmonic: number; frequency: number; magnitude: number }> = [];
  let weightedSupport = 0;
  let possibleSupport = 0;

  for (let harmonic = 1; harmonic <= maxHarmonics; harmonic += 1) {
    const harmonicFrequency = fundamental * harmonic;
    if (harmonicFrequency > frequencies[frequencies.length - 1]) {
      break;
    }

    const magnitude = bandMagnitude(magnitudes, frequencies, harmonicFrequency, 0.018);
    const weight = 1 / Math.sqrt(harmonic);
    weightedSupport += magnitude * weight;
    possibleSupport += weight;
    features.push({
      harmonic,
      frequency: harmonicFrequency,
      magnitude,
    });
  }

  const localFloor = median(Array.from(magnitudes));
  const normalizedSupport =
    possibleSupport > 0 ? weightedSupport / Math.max(1e-8, possibleSupport) : 0;

  return {
    confidence: clamp01((normalizedSupport / Math.max(localFloor * 8, 1e-7) - 0.7) / 2.5),
    features,
  };
}

export function bandMagnitude(
  magnitudes: Float32Array,
  frequencies: Float32Array,
  targetFrequency: number,
  ratioWidth: number,
): number {
  const low = targetFrequency * (1 - ratioWidth);
  const high = targetFrequency * (1 + ratioWidth);
  let best = 0;

  for (let bin = 0; bin < frequencies.length; bin += 1) {
    const frequency = frequencies[bin];
    if (frequency >= low && frequency <= high) {
      best = Math.max(best, magnitudes[bin]);
    }
  }

  return best;
}

function isLikelySpeechOrTv(
  magnitudes: Float32Array,
  frequencies: Float32Array,
): boolean {
  const centroid = spectralCentroid(magnitudes, frequencies);
  let guitarBand = 0;
  let speechBand = 0;
  let highBand = 0;

  for (let bin = 0; bin < magnitudes.length; bin += 1) {
    const frequency = frequencies[bin];
    const magnitude = magnitudes[bin];
    if (frequency >= 75 && frequency <= 1400) {
      guitarBand += magnitude;
    }
    if (frequency >= 300 && frequency <= 3400) {
      speechBand += magnitude;
    }
    if (frequency >= 4500 && frequency <= 9000) {
      highBand += magnitude;
    }
  }

  const speechDominance = speechBand / Math.max(1e-8, guitarBand);
  const clickDominance = highBand / Math.max(1e-8, guitarBand + speechBand);

  return (centroid > 950 && speechDominance > 1.9) || clickDominance > 0.34;
}

function isLikelyImpulsiveNoise(
  magnitudes: Float32Array,
  frequencies: Float32Array,
): boolean {
  let guitarBand = 0;
  let highBand = 0;
  let total = 0;

  for (let bin = 0; bin < magnitudes.length; bin += 1) {
    const frequency = frequencies[bin];
    const magnitude = magnitudes[bin];
    total += magnitude;

    if (frequency >= 75 && frequency <= 1600) {
      guitarBand += magnitude;
    }

    if (frequency >= 3500 && frequency <= 11000) {
      highBand += magnitude;
    }
  }

  return highBand / Math.max(total, 1e-8) > 0.42 && highBand > guitarBand * 0.9;
}
