import { MusicauRealtimeEngine } from "../engine";

type WorkerMessage =
  | {
      type: "configure";
      sampleRate: number;
      fftSize?: number;
      minFrequency?: number;
      maxFrequency?: number;
    }
  | {
      type: "audio";
      timestamp: number;
      samples: Float32Array;
    };

let engine = new MusicauRealtimeEngine();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === "configure") {
    engine = new MusicauRealtimeEngine(event.data);
    return;
  }

  const frame = engine.analyze(event.data.samples, event.data.timestamp);
  self.postMessage({
    type: "analysis",
    frame,
  });
};
