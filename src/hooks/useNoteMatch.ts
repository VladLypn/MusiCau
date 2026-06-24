import { useEffect, useRef, useState } from "react";
import type { NoteDetection } from "../pitch/types";
import { isNoteWithinTolerance } from "../utils/music";

export interface UseNoteMatchOptions {
  targetNote: string;
  detection: NoteDetection | null;
  toleranceCents?: number;
  holdMs?: number;
  enabled?: boolean;
  onCorrectNoteDetected?: () => void;
}

export function useNoteMatch({
  targetNote,
  detection,
  toleranceCents = 50,
  holdMs = 220,
  enabled = true,
  onCorrectNoteDetected,
}: UseNoteMatchOptions): boolean {
  const [matched, setMatched] = useState(false);
  const firstMatchAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    setMatched(false);
    firstMatchAtRef.current = null;
    firedRef.current = false;
  }, [targetNote]);

  useEffect(() => {
    if (!enabled || !detection) {
      firstMatchAtRef.current = null;
      setMatched(false);
      return;
    }

    const isMatch = isNoteWithinTolerance(
      detection,
      targetNote,
      toleranceCents,
    );

    if (!isMatch) {
      firstMatchAtRef.current = null;
      setMatched(false);
      return;
    }

    firstMatchAtRef.current ??= performance.now();
    const heldLongEnough = performance.now() - firstMatchAtRef.current >= holdMs;
    setMatched(heldLongEnough);

    if (heldLongEnough && !firedRef.current) {
      firedRef.current = true;
      onCorrectNoteDetected?.();
    }
  }, [
    detection,
    enabled,
    holdMs,
    onCorrectNoteDetected,
    targetNote,
    toleranceCents,
  ]);

  return matched;
}
