import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMusicauAudioGraph,
  type MusicauAudioGraph,
} from "../musicau/audio/createMusicauAudioGraph";
import type {
  MusicauAnalysisFrame,
  MusicauChordDetection,
  MusicauNoteDetection,
  PitchClass,
} from "../musicau/types";
import type {
  AudioSnapshot,
  MicrophoneStatus,
} from "../types/audio";
import type {
  ChordDetection,
  NoteDetection,
  RepresentativeNoteDetection,
} from "../pitch/types";
import { getTuningStatus } from "../utils/music";

interface WorkerAnalysisMessage {
  type: "analysis";
  frame: MusicauAnalysisFrame;
}

export interface UseMusicauRecognitionResult {
  status: MicrophoneStatus;
  snapshot: AudioSnapshot;
  error: string | null;
  usingAudioWorklet: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const EMPTY_CHORD_STABILITY = {
  state: "UNKNOWN" as const,
  currentChord: null,
  candidateChord: null,
  currentConfidence: 0,
  candidateConfidence: 0,
  confirmationProgress: 0,
  holdTimeRemaining: 0,
  smoothedProbabilities: {},
};

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
  chordStability: EMPTY_CHORD_STABILITY,
  rms: 0,
  gateOpen: false,
  timestamp: 0,
};

const FALLBACK_INTERVAL_MS = 46;

export function useMusicauRecognition(): UseMusicauRecognitionResult {
  const [status, setStatus] = useState<MicrophoneStatus>("idle");
  const [snapshot, setSnapshot] = useState<AudioSnapshot>(INITIAL_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [usingAudioWorklet, setUsingAudioWorklet] = useState(false);
  const graphRef = useRef<MusicauAudioGraph | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const fallbackBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  const stopFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(async () => {
    stopFallback();
    const graph = graphRef.current;
    graphRef.current = null;
    fallbackBufferRef.current = null;

    if (graph) {
      await graph.stop();
    }

    setStatus("idle");
    setUsingAudioWorklet(false);
    setSnapshot(INITIAL_SNAPSHOT);
  }, [stopFallback]);

  const start = useCallback(async () => {
    if (graphRef.current || status === "requesting") {
      return;
    }

    setStatus("requesting");
    setError(null);

    try {
      const graph = await createMusicauAudioGraph();
      graphRef.current = graph;
      setUsingAudioWorklet(Boolean(graph.workletNode));
      setStatus("connected");
      setSnapshot(INITIAL_SNAPSHOT);

      graph.worker.onmessage = (event: MessageEvent<WorkerAnalysisMessage>) => {
        if (event.data.type !== "analysis") {
          return;
        }

        setSnapshot(frameToSnapshot(event.data.frame));
      };

      if (!graph.workletNode) {
        fallbackBufferRef.current = new Float32Array(
          new ArrayBuffer(graph.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
        );
        fallbackTimerRef.current = window.setInterval(() => {
          const activeGraph = graphRef.current;
          const buffer = fallbackBufferRef.current;
          if (!activeGraph || !buffer) {
            return;
          }

          activeGraph.analyser.getFloatTimeDomainData(buffer);
          const samples = new Float32Array(
            new ArrayBuffer(buffer.length * Float32Array.BYTES_PER_ELEMENT),
          );
          samples.set(buffer);
          activeGraph.worker.postMessage(
            {
              type: "audio",
              timestamp: performance.now(),
              samples,
            },
            [samples.buffer],
          );
        }, FALLBACK_INTERVAL_MS);
      }
    } catch (caughtError) {
      setStatus(permissionErrorToStatus(caughtError));
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not start microphone input.",
      );
    }
  }, [status]);

  useEffect(() => {
    return () => {
      stopFallback();
      void graphRef.current?.stop();
      graphRef.current = null;
      fallbackBufferRef.current = null;
    };
  }, [stopFallback]);

  return {
    status,
    snapshot,
    error,
    usingAudioWorklet,
    start,
    stop,
  };
}

function frameToSnapshot(frame: MusicauAnalysisFrame): AudioSnapshot {
  return {
    detection: frame.note ? toNoteDetection(frame.note) : null,
    chordDetection: frame.chord ? toChordDetection(frame.chord) : null,
    candidateChordDetection: frame.chordCandidate
      ? toChordDetection(frame.chordCandidate)
      : null,
    representativeNoteDetection: frame.note
      ? toRepresentativeNoteDetection(frame.note)
      : null,
    debugMetrics: frame.debugMetrics,
    chordStability: frame.chordStability,
    rms: frame.rms,
    gateOpen: frame.gateOpen,
    timestamp: frame.timestamp,
  };
}

function toNoteDetection(detection: MusicauNoteDetection): NoteDetection {
  return {
    note: detection.pitchClass,
    octave: detection.octave,
    centsOff: detection.centsOff,
    frequency: detection.frequency,
    confidence: detection.confidence,
    status: getTuningStatus(detection.centsOff),
  };
}

function toRepresentativeNoteDetection(
  detection: MusicauNoteDetection,
): RepresentativeNoteDetection {
  return {
    note: detection.pitchClass,
    octave: detection.octave,
    frequency: detection.frequency,
    confidence: detection.confidence,
    alternatives: [],
  };
}

function toChordDetection(detection: MusicauChordDetection): ChordDetection {
  const chordTones = new Set<PitchClass>(detection.notes);

  return {
    chord: formatChordName(detection.chord),
    root: detection.root,
    quality: detection.quality.toLowerCase(),
    confidence: detection.confidence,
    pitchClasses: detection.notes,
    activePitchClasses: detection.chroma.map((energy, index) => {
      const note = [
        "C",
        "C#",
        "D",
        "D#",
        "E",
        "F",
        "F#",
        "G",
        "G#",
        "A",
        "A#",
        "B",
      ][index] as PitchClass;

      return {
        note,
        energy,
        isChordTone: chordTones.has(note),
      };
    }),
    alternatives: detection.alternatives.map((alternative) => ({
      chord: formatChordName(alternative.chord),
      confidence: alternative.confidence,
    })),
  };
}

function formatChordName(chord: string): string {
  return chord
    .replace(" Major 7", "maj7")
    .replace(" Minor 7", "m7")
    .replace(" Major", "")
    .replace(" Minor", "m");
}

function permissionErrorToStatus(error: unknown): MicrophoneStatus {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "denied";
    }
  }

  return "error";
}
