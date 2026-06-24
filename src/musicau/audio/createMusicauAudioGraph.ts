export interface MusicauAudioGraph {
  audioContext: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  worker: Worker;
  workletNode: AudioWorkletNode | null;
  stop: () => Promise<void>;
}

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

interface WorkletAudioMessage {
  type: "audio";
  sampleRate: number;
  timestamp: number;
  samples: Float32Array;
}

const WORKLET_FRAME_SIZE = 2048;

export async function createMusicauAudioGraph(): Promise<MusicauAudioGraph> {
  const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      latency: 0.02,
    } as MediaTrackConstraints;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  });

  const AudioContextClass =
    window.AudioContext ??
    (window as WindowWithWebkitAudioContext).webkitAudioContext;
  const audioContext = new AudioContextClass({
    latencyHint: "interactive",
    sampleRate: 44100,
  });
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const worker = new Worker(
    new URL("../workers/musicauAudioWorker.ts", import.meta.url),
    { type: "module" },
  );
  worker.postMessage({
    type: "configure",
    sampleRate: audioContext.sampleRate,
    fftSize: analyser.fftSize,
  });

  const workletNode = await createCaptureWorklet(audioContext, worker);
  let mutedMonitor: GainNode | null = null;
  if (workletNode) {
    mutedMonitor = audioContext.createGain();
    mutedMonitor.gain.value = 0;
    source.connect(workletNode);
    workletNode.connect(mutedMonitor);
    mutedMonitor.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return {
    audioContext,
    stream,
    analyser,
    worker,
    workletNode,
    stop: async () => {
      worker.terminate();
      workletNode?.disconnect();
      mutedMonitor?.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      if (audioContext.state !== "closed") {
        await audioContext.close();
      }
    },
  };
}

async function createCaptureWorklet(
  audioContext: AudioContext,
  worker: Worker,
): Promise<AudioWorkletNode | null> {
  if (!audioContext.audioWorklet) {
    return null;
  }

  try {
    await audioContext.audioWorklet.addModule(
      new URL("./musicauCaptureProcessor.ts", import.meta.url),
    );
  } catch {
    return null;
  }

  const workletNode = new AudioWorkletNode(audioContext, "musicau-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  workletNode.port.onmessage = (event: MessageEvent<WorkletAudioMessage>) => {
    if (event.data.type !== "audio") {
      return;
    }

    worker.postMessage(
      {
        type: "audio",
        timestamp: event.data.timestamp,
        samples: event.data.samples,
      },
      [event.data.samples.buffer],
    );
  };
  workletNode.port.postMessage({
    type: "configure",
    frameSize: WORKLET_FRAME_SIZE,
  });

  return workletNode;
}
