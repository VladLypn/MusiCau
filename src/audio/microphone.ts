import type { MicrophoneStatus } from "../types/audio";

export interface MicrophoneSession {
  audioContext: AudioContext;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
  stop: () => Promise<void>;
}

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export async function createMicrophoneSession(): Promise<MicrophoneSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone input is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
    video: false,
  });

  const AudioContextClass =
    window.AudioContext ??
    (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  const audioContext = new AudioContextClass({ latencyHint: "interactive" });
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();

  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return {
    audioContext,
    analyser,
    source,
    stream,
    stop: async () => {
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      if (audioContext.state !== "closed") {
        await audioContext.close();
      }
    },
  };
}

export function permissionErrorToStatus(error: unknown): MicrophoneStatus {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "denied";
    }
  }

  return "error";
}
