import { useNoteMatch } from "../hooks/useNoteMatch";
import type { NoteDetection } from "../pitch/types";
import { formatNote } from "../utils/music";

export interface NoteChallengeProps {
  targetNote: string;
  detection?: NoteDetection | null;
  toleranceCents?: number;
  onCorrectNoteDetected?: () => void;
}

export function NoteChallenge({
  targetNote,
  detection = null,
  toleranceCents = 50,
  onCorrectNoteDetected,
}: NoteChallengeProps) {
  const matched = useNoteMatch({
    targetNote,
    detection,
    toleranceCents,
    onCorrectNoteDetected,
  });

  const detectedNote = detection ? formatNote(detection) : "--";

  return (
    <section className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Note Challenge</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Target note must be held within +/-{toleranceCents} cents.
          </p>
        </div>
        <span
          className={`rounded px-3 py-1 text-sm font-semibold ${
            matched ? "bg-signal/20 text-emerald-900" : "bg-zinc-200 text-zinc-700"
          }`}
        >
          {matched ? "Matched" : "Listening"}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-500">Target</p>
          <p className="mt-2 text-4xl font-black text-ink">{targetNote}</p>
        </div>
        <div className="rounded bg-zinc-50 p-4">
          <p className="text-sm font-semibold text-zinc-500">Detected</p>
          <p className="mt-2 text-4xl font-black text-ink">{detectedNote}</p>
        </div>
      </div>
    </section>
  );
}
