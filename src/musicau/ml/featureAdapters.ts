import { chromaFromSpectrum } from "../chroma";
import { applyHannWindow } from "../dsp";
import { magnitudeSpectrum } from "../fft";
import type { HarmonicFeature } from "../types";

type DynamicImporter = (moduleName: string) => Promise<unknown>;

const dynamicImport: DynamicImporter = (moduleName) => {
  const importModule = new Function("moduleName", "return import(moduleName)") as DynamicImporter;
  return importModule(moduleName);
};

export interface MlFeatureBundle {
  spectrogram: number[][];
  chroma: number[];
  harmonicFeatures: HarmonicFeature[];
  meyda?: Record<string, unknown>;
  essentia?: Record<string, unknown>;
}

export async function extractMlFeatures(
  audioChunk: Float32Array,
  sampleRate: number,
): Promise<MlFeatureBundle> {
  const windowed = applyHannWindow(audioChunk);
  const spectrum = magnitudeSpectrum(windowed, sampleRate, 4096);
  const chroma = chromaFromSpectrum(spectrum.magnitudes, spectrum.frequencies);
  const spectrogram = buildLogSpectrogram(audioChunk, sampleRate);
  const [meyda, essentia] = await Promise.all([
    extractMeydaFeatures(audioChunk, sampleRate),
    extractEssentiaFeatures(audioChunk, sampleRate),
  ]);

  return {
    spectrogram,
    chroma,
    harmonicFeatures: [],
    meyda,
    essentia,
  };
}

async function extractMeydaFeatures(
  audioChunk: Float32Array,
  sampleRate: number,
): Promise<Record<string, unknown> | undefined> {
  try {
    const module = await dynamicImport("meyda");
    const candidate = module as {
      default?: {
        extract: (
          feature: string[],
          signal: Float32Array,
          options: { sampleRate: number; bufferSize: number },
        ) => Record<string, unknown>;
      };
      extract?: (
        feature: string[],
        signal: Float32Array,
        options: { sampleRate: number; bufferSize: number },
      ) => Record<string, unknown>;
    };
    const extract = candidate.default?.extract ?? candidate.extract;
    return extract?.(
      ["rms", "spectralCentroid", "spectralFlatness", "chroma"],
      audioChunk,
      { sampleRate, bufferSize: audioChunk.length },
    );
  } catch {
    return undefined;
  }
}

async function extractEssentiaFeatures(
  audioChunk: Float32Array,
  sampleRate: number,
): Promise<Record<string, unknown> | undefined> {
  try {
    const module = await dynamicImport("essentia.js");
    return {
      available: Boolean(module),
      sampleRate,
      frameSize: audioChunk.length,
    };
  } catch {
    return undefined;
  }
}

function buildLogSpectrogram(
  audioChunk: Float32Array,
  sampleRate: number,
  frameSize = 1024,
  hopSize = 256,
): number[][] {
  const frames: number[][] = [];

  for (let offset = 0; offset + frameSize <= audioChunk.length; offset += hopSize) {
    const frame = applyHannWindow(audioChunk.slice(offset, offset + frameSize));
    const spectrum = magnitudeSpectrum(frame, sampleRate, frameSize);
    frames.push(Array.from(spectrum.magnitudes.slice(0, 256), (value) =>
      Math.log1p(value * 1000),
    ));
  }

  return frames;
}
