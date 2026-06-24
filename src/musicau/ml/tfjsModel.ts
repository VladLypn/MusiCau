import type { MlFeatureBundle } from "./featureAdapters";

type DynamicImporter = (moduleName: string) => Promise<unknown>;

const dynamicImport: DynamicImporter = (moduleName) => {
  const importModule = new Function("moduleName", "return import(moduleName)") as DynamicImporter;
  return importModule(moduleName);
};

export interface NeuralPrediction {
  noteProbabilities: number[];
  chordProbabilities: number[];
  confidence: number;
}

interface TensorLike {
  dispose: () => void;
  dataSync?: () => ArrayLike<number>;
  arraySync?: () => unknown;
}

type PredictionOutput = TensorLike | TensorLike[] | Record<string, TensorLike>;

interface TensorflowLike {
  loadGraphModel: (url: string) => Promise<{
    predict: (input: TensorLike | TensorLike[]) => PredictionOutput;
  }>;
  tensor: (values: unknown, shape?: number[]) => TensorLike;
}

export class MusicauTfjsModel {
  private tensorflow: TensorflowLike | null = null;
  private model: Awaited<ReturnType<TensorflowLike["loadGraphModel"]>> | null = null;

  constructor(private readonly importer: DynamicImporter = dynamicImport) {}

  async load(modelUrl: string): Promise<boolean> {
    try {
      this.tensorflow = (await this.importer("@tensorflow/tfjs")) as TensorflowLike;
      this.model = await this.tensorflow.loadGraphModel(modelUrl);
      return true;
    } catch {
      this.tensorflow = null;
      this.model = null;
      return false;
    }
  }

  predict(features: MlFeatureBundle): NeuralPrediction | null {
    if (!this.tensorflow || !this.model) {
      return null;
    }

    const spectrogramTensor = this.tensorflow.tensor(features.spectrogram, [
      1,
      features.spectrogram.length,
      features.spectrogram[0]?.length ?? 0,
      1,
    ]);
    const chromaTensor = this.tensorflow.tensor(features.chroma, [1, 12]);

    try {
      const prediction = this.model.predict([spectrogramTensor, chromaTensor]);
      try {
        return toNeuralPrediction(prediction);
      } finally {
        disposePrediction(prediction);
      }
    } catch {
      return {
        noteProbabilities: [],
        chordProbabilities: [],
        confidence: 0,
      };
    } finally {
      spectrogramTensor.dispose();
      chromaTensor.dispose();
    }
  }
}

function toNeuralPrediction(prediction: PredictionOutput): NeuralPrediction {
  if (Array.isArray(prediction)) {
    const noteProbabilities = readTensorNumbers(prediction[0]);
    const chordProbabilities = readTensorNumbers(prediction[1]);
    const explicitConfidence = readTensorNumbers(prediction[2])[0];

    return {
      noteProbabilities,
      chordProbabilities,
      confidence: scorePredictionConfidence(
        explicitConfidence,
        noteProbabilities,
        chordProbabilities,
      ),
    };
  }

  if (isTensorLike(prediction)) {
    const values = readTensorNumbers(prediction);
    return {
      noteProbabilities: values,
      chordProbabilities: [],
      confidence: scorePredictionConfidence(undefined, values, []),
    };
  }

  const noteProbabilities = readTensorNumbers(
    prediction.noteProbabilities ?? prediction.notes ?? prediction.note,
  );
  const chordProbabilities = readTensorNumbers(
    prediction.chordProbabilities ?? prediction.chords ?? prediction.chord,
  );
  const explicitConfidence = readTensorNumbers(prediction.confidence)[0];

  return {
    noteProbabilities,
    chordProbabilities,
    confidence: scorePredictionConfidence(
      explicitConfidence,
      noteProbabilities,
      chordProbabilities,
    ),
  };
}

function readTensorNumbers(tensor: TensorLike | undefined): number[] {
  if (!tensor) {
    return [];
  }

  if (tensor.dataSync) {
    return Array.from(tensor.dataSync(), sanitizeProbability);
  }

  if (tensor.arraySync) {
    return flattenNumbers(tensor.arraySync()).map(sanitizeProbability);
  }

  return [];
}

function flattenNumbers(value: unknown): number[] {
  if (typeof value === "number") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => flattenNumbers(entry));
}

function scorePredictionConfidence(
  explicitConfidence: number | undefined,
  noteProbabilities: readonly number[],
  chordProbabilities: readonly number[],
): number {
  if (explicitConfidence !== undefined && Number.isFinite(explicitConfidence)) {
    return sanitizeProbability(explicitConfidence);
  }

  return Math.max(0, ...noteProbabilities, ...chordProbabilities);
}

function sanitizeProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function disposePrediction(prediction: PredictionOutput): void {
  if (Array.isArray(prediction)) {
    prediction.forEach((tensor) => tensor.dispose());
    return;
  }

  if (isTensorLike(prediction)) {
    prediction.dispose();
    return;
  }

  Object.values(prediction).forEach((tensor) => tensor.dispose());
}

function isTensorLike(value: unknown): value is TensorLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}
