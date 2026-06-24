import { clamp01 } from "./dsp";
import { PITCH_CLASSES, frequencyToMidi, midiToFrequency } from "./notes";
import { bandMagnitude } from "./noiseReduction";

const CHORD_PITCH_TOLERANCE_CENTS = 49.5;

export function chromaFromSpectrum(
  magnitudes: Float32Array,
  frequencies: Float32Array,
  minFrequency = 70,
  maxFrequency = 1800,
): number[] {
  const chroma = Array.from({ length: 12 }, () => 0);

  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    const frequency = frequencies[bin];
    if (frequency < minFrequency || frequency > maxFrequency) {
      continue;
    }

    const midi = frequencyToMidi(frequency);
    const nearestMidi = Math.round(midi);
    const cents = Math.abs((midi - nearestMidi) * 100);
    if (cents > CHORD_PITCH_TOLERANCE_CENTS) {
      continue;
    }

    const pitchClass = ((nearestMidi % 12) + 12) % 12;
    const tuningWeight = Math.cos(
      (cents / CHORD_PITCH_TOLERANCE_CENTS) * (Math.PI / 2),
    );
    chroma[pitchClass] += magnitudes[bin] * Math.max(0, tuningWeight);
  }

  return normalizeChroma(chroma);
}

export function normalizeChroma(chroma: readonly number[]): number[] {
  const max = Math.max(...chroma);
  if (max <= 0) {
    return Array.from({ length: 12 }, () => 0);
  }

  return chroma.map((value) => clamp01(value / max));
}

export function harmonicChromaFromSpectrum(
  magnitudes: Float32Array,
  frequencies: Float32Array,
  minFrequency = 70,
  maxFrequency = 1400,
  maxHarmonics = 6,
): number[] {
  const chroma = Array.from({ length: 12 }, () => 0);
  const minMidi = Math.round(frequencyToMidi(minFrequency));
  const maxMidi = Math.round(frequencyToMidi(maxFrequency));

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const fundamental = midiToFrequency(midi);
    let energy = 0;

    for (let harmonic = 1; harmonic <= maxHarmonics; harmonic += 1) {
      const harmonicFrequency = fundamental * harmonic;
      if (harmonicFrequency > frequencies[frequencies.length - 1]) {
        break;
      }

      energy +=
        bandMagnitude(magnitudes, frequencies, harmonicFrequency, 0.028) /
        Math.sqrt(harmonic);
    }

    chroma[((midi % 12) + 12) % 12] += energy / Math.sqrt(fundamental);
  }

  return normalizeChroma(chroma);
}

export function blendChroma(
  primary: readonly number[],
  secondary: readonly number[],
  primaryWeight = 0.62,
): number[] {
  return normalizeChroma(
    primary.map((value, index) => {
      return value * primaryWeight + (secondary[index] ?? 0) * (1 - primaryWeight);
    }),
  );
}

export function activePitchClasses(chroma: readonly number[], threshold = 0.22) {
  return chroma
    .map((energy, index) => ({
      pitchClass: PITCH_CLASSES[index],
      energy,
    }))
    .filter(({ energy }) => energy >= threshold)
    .sort((a, b) => b.energy - a.energy);
}
