import type { NoteDetection } from "../pitch/types";
import { formatCents } from "../utils/format";
import { tuningStatusLabel } from "../utils/music";

interface TuningIndicatorProps {
  detection: NoteDetection | null;
}

export function TuningIndicator({ detection }: TuningIndicatorProps) {
  const cents = detection?.centsOff ?? null;
  const offset = cents === null ? 0 : Math.max(-50, Math.min(50, cents));
  const markerPosition = 50 + offset;

  return (
    <div className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Tuning</h2>
        <span className="text-sm font-semibold text-zinc-600">
          {detection ? tuningStatusLabel(detection.status) : "Waiting"}
        </span>
      </div>

      <div className="relative mt-6 h-4 rounded bg-gradient-to-r from-danger via-signal to-brass">
        <div className="absolute left-1/2 top-[-8px] h-8 w-px bg-ink/70" />
        <div
          className="absolute top-[-5px] h-7 w-1.5 rounded bg-ink shadow transition-[left] duration-100"
          style={{ left: `calc(${markerPosition}% - 3px)` }}
        />
      </div>

      <div className="mt-3 flex justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <span>Flat</span>
        <span>{formatCents(cents)}</span>
        <span>Sharp</span>
      </div>
    </div>
  );
}
