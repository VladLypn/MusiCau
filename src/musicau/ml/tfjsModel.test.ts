import { describe, expect, it } from "vitest";
import { MusicauTfjsModel } from "./tfjsModel";
import type { MlFeatureBundle } from "./featureAdapters";

class FakeTensor {
  disposed = false;

  constructor(private readonly values: number[] = []) {}

  dataSync(): ArrayLike<number> {
    return this.values;
  }

  dispose(): void {
    this.disposed = true;
  }
}

const FEATURES: MlFeatureBundle = {
  spectrogram: [
    [0.1, 0.2],
    [0.3, 0.4],
  ],
  chroma: [1, 0, 0, 0, 0.8, 0, 0, 0.9, 0, 0, 0, 0],
  harmonicFeatures: [],
};

describe("MusicauTfjsModel", () => {
  it("loads a TensorFlow.js graph model and reads named probability outputs", async () => {
    const outputs = {
      noteProbabilities: new FakeTensor([0.01, 0.92, 0.07]),
      chordProbabilities: new FakeTensor([0.84, 0.12, 0.04]),
      confidence: new FakeTensor([0.88]),
    };
    const model = new MusicauTfjsModel(async () => ({
      loadGraphModel: async () => ({
        predict: () => outputs,
      }),
      tensor: () => new FakeTensor(),
    }));

    await expect(model.load("/models/musicau/model.json")).resolves.toBe(true);
    const prediction = model.predict(FEATURES);

    expect(prediction).toEqual({
      noteProbabilities: [0.01, 0.92, 0.07],
      chordProbabilities: [0.84, 0.12, 0.04],
      confidence: 0.88,
    });
    expect(outputs.noteProbabilities.disposed).toBe(true);
    expect(outputs.chordProbabilities.disposed).toBe(true);
    expect(outputs.confidence.disposed).toBe(true);
  });
});
