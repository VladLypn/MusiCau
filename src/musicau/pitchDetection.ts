import { clamp01 } from "./dsp";

export interface PitchCandidate {
  frequency: number;
  confidence: number;
  probability: number;
}

export function detectPitchYin(
  buffer: Float32Array,
  sampleRate: number,
  minFrequency: number,
  maxFrequency: number,
  threshold = 0.1,
): PitchCandidate | null {
  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(buffer.length - 2, Math.ceil(sampleRate / minFrequency));
  if (maxTau <= minTau) {
    return null;
  }

  const difference = new Float32Array(maxTau + 1);
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    let sum = 0;
    const limit = buffer.length - tau;
    for (let index = 0; index < limit; index += 1) {
      const delta = buffer[index] - buffer[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const cumulative = new Float32Array(maxTau + 1);
  let runningSum = 0;
  cumulative[0] = 1;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    cumulative[tau] = runningSum > 0 ? (difference[tau] * tau) / runningSum : 1;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cumulative[tau] < threshold) {
      while (tau + 1 <= maxTau && cumulative[tau + 1] < cumulative[tau]) {
        tau += 1;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    let best = minTau;
    for (let tau = minTau + 1; tau <= maxTau; tau += 1) {
      if (cumulative[tau] < cumulative[best]) {
        best = tau;
      }
    }
    tauEstimate = best;
  }

  const refinedTau = parabolicInterpolate(cumulative, tauEstimate);
  const frequency = sampleRate / refinedTau;
  const probability = 1 - cumulative[tauEstimate];

  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) {
    return null;
  }

  return {
    frequency,
    confidence: clamp01((probability - 0.45) / 0.5),
    probability: clamp01(probability),
  };
}

export function validatePitchAutocorrelation(
  buffer: Float32Array,
  sampleRate: number,
  targetFrequency: number,
): PitchCandidate | null {
  if (targetFrequency <= 0) {
    return null;
  }

  const expectedLag = sampleRate / targetFrequency;
  const searchRadius = Math.max(2, Math.round(expectedLag * 0.08));
  const startLag = Math.max(2, Math.floor(expectedLag - searchRadius));
  const endLag = Math.min(buffer.length - 2, Math.ceil(expectedLag + searchRadius));
  let zeroLag = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    zeroLag += buffer[index] * buffer[index];
  }
  if (zeroLag <= 1e-9) {
    return null;
  }

  let bestLag = startLag;
  let bestCorrelation = -Infinity;
  for (let lag = startLag; lag <= endLag; lag += 1) {
    let correlation = 0;
    const limit = buffer.length - lag;
    for (let index = 0; index < limit; index += 1) {
      correlation += buffer[index] * buffer[index + lag];
    }
    const normalized = correlation / zeroLag;
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestLag = lag;
    }
  }

  const frequency = sampleRate / parabolicAutocorrelationLag(buffer, bestLag);
  return {
    frequency,
    confidence: clamp01((bestCorrelation - 0.28) / 0.52),
    probability: clamp01(bestCorrelation),
  };
}

function parabolicInterpolate(values: Float32Array, index: number): number {
  if (index <= 0 || index >= values.length - 1) {
    return index;
  }

  const previous = values[index - 1];
  const current = values[index];
  const next = values[index + 1];
  const denominator = previous - 2 * current + next;

  if (Math.abs(denominator) < 1e-9) {
    return index;
  }

  return index + (previous - next) / (2 * denominator);
}

function parabolicAutocorrelationLag(buffer: Float32Array, lag: number): number {
  const correlationAt = (targetLag: number) => {
    let correlation = 0;
    const limit = buffer.length - targetLag;
    for (let index = 0; index < limit; index += 1) {
      correlation += buffer[index] * buffer[index + targetLag];
    }
    return correlation;
  };

  if (lag <= 1 || lag >= buffer.length - 2) {
    return lag;
  }

  const previous = correlationAt(lag - 1);
  const current = correlationAt(lag);
  const next = correlationAt(lag + 1);
  const denominator = previous - 2 * current + next;

  if (Math.abs(denominator) < 1e-9) {
    return lag;
  }

  return lag + (previous - next) / (2 * denominator);
}
