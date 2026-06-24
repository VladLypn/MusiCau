declare const sampleRate: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

interface ConfigureMessage {
  type: "configure";
  frameSize?: number;
}

const DEFAULT_FRAME_SIZE = 2048;

class MusicauCaptureProcessor extends AudioWorkletProcessor {
  private frame = new Float32Array(DEFAULT_FRAME_SIZE);
  private writeIndex = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ConfigureMessage>) => {
      if (event.data.type !== "configure") {
        return;
      }

      const frameSize = sanitizeFrameSize(event.data.frameSize);
      this.frame = new Float32Array(frameSize);
      this.writeIndex = 0;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) {
      return true;
    }

    for (let index = 0; index < channel.length; index += 1) {
      this.frame[this.writeIndex] = channel[index];
      this.writeIndex += 1;

      if (this.writeIndex === this.frame.length) {
        const samples = new Float32Array(this.frame);
        this.port.postMessage(
          {
            type: "audio",
            sampleRate,
            timestamp: currentTime * 1000,
            samples,
          },
          [samples.buffer],
        );
        this.writeIndex = 0;
      }
    }

    return true;
  }
}

function sanitizeFrameSize(frameSize = DEFAULT_FRAME_SIZE): number {
  if (!Number.isFinite(frameSize)) {
    return DEFAULT_FRAME_SIZE;
  }

  return Math.max(512, Math.min(4096, Math.round(frameSize)));
}

registerProcessor("musicau-capture", MusicauCaptureProcessor);

export {};
