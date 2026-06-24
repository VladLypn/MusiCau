import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMicrophoneSession,
  permissionErrorToStatus,
  type MicrophoneSession,
} from "../audio/microphone";
import {
  DEFAULT_DETECTION_CONFIG,
  GuitarPitchDetector,
} from "../pitch/detector";
import type {
  AudioSnapshot,
  MicrophoneStatus,
  PitchDetectionConfig,
} from "../types/audio";

export interface UseGuitarPitchResult {
  status: MicrophoneStatus;
  snapshot: AudioSnapshot;
  error: string | null;
  config: PitchDetectionConfig;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const INITIAL_SNAPSHOT: AudioSnapshot = {
  detection: null,
  chordDetection: null,
  candidateChordDetection: null,
  representativeNoteDetection: null,
  debugMetrics: {
    rms: 0,
    noiseFloor: 0,
    threshold: 0,
    signalToNoiseRatio: 0,
    harmonicConfidence: 0,
    pitchConfidence: 0,
    currentChord: null,
    candidateChord: null,
    currentConfidence: 0,
    candidateConfidence: 0,
    confirmationProgress: 0,
    holdTimeRemaining: 0,
    smoothedProbabilities: {},
    calibrating: false,
    calibrationProgress: 0,
  },
  chordStability: {
    state: "UNKNOWN",
    currentChord: null,
    candidateChord: null,
    currentConfidence: 0,
    candidateConfidence: 0,
    confirmationProgress: 0,
    holdTimeRemaining: 0,
    smoothedProbabilities: {},
  },
  rms: 0,
  gateOpen: false,
  timestamp: 0,
};

export function useGuitarPitch(
  initialConfig: PitchDetectionConfig = DEFAULT_DETECTION_CONFIG,
): UseGuitarPitchResult {
  const [status, setStatus] = useState<MicrophoneStatus>("idle");
  const [snapshot, setSnapshot] = useState<AudioSnapshot>(INITIAL_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [config] = useState<PitchDetectionConfig>(initialConfig);

  const sessionRef = useRef<MicrophoneSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const detectorRef = useRef<GuitarPitchDetector | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(async () => {
    stopTimer();
    const session = sessionRef.current;
    sessionRef.current = null;
    detectorRef.current = null;

    if (session) {
      await session.stop();
    }

    setStatus("idle");
    setSnapshot(INITIAL_SNAPSHOT);
  }, [stopTimer]);

  const start = useCallback(async () => {
    if (sessionRef.current || status === "requesting") {
      return;
    }

    setStatus("requesting");
    setError(null);

    try {
      const session = await createMicrophoneSession();
      const detector = new GuitarPitchDetector(
        session.analyser,
        session.audioContext.sampleRate,
        config,
      );

      sessionRef.current = session;
      detectorRef.current = detector;
      setStatus("connected");
      setSnapshot(INITIAL_SNAPSHOT);

      stopTimer();
      timerRef.current = window.setInterval(() => {
        const activeDetector = detectorRef.current;
        if (activeDetector) {
          setSnapshot(activeDetector.detect());
        }
      }, config.updateIntervalMs);
    } catch (caughtError) {
      setStatus(permissionErrorToStatus(caughtError));
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not start microphone input.",
      );
    }
  }, [config, status, stopTimer]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || status !== "connected") {
      return;
    }

    detectorRef.current = new GuitarPitchDetector(
      session.analyser,
      session.audioContext.sampleRate,
      config,
    );
  }, [config, status]);

  useEffect(() => {
    return () => {
      stopTimer();
      void sessionRef.current?.stop();
      sessionRef.current = null;
      detectorRef.current = null;
    };
  }, [stopTimer]);

  return {
    status,
    snapshot,
    error,
    config,
    start,
    stop,
  };
}
