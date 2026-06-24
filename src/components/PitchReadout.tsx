import type { AudioSnapshot } from "../types/audio";
import { formatFrequency, formatPercent } from "../utils/format";
import { formatNote, tuningStatusLabel } from "../utils/music";
import { Meter } from "./Meter";
import { TuningIndicator } from "./TuningIndicator";

interface PitchReadoutProps {
  snapshot: AudioSnapshot;
}

export function PitchReadout({ snapshot }: PitchReadoutProps) {
  const detection = snapshot.detection;

  return (
    <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadoutCell
            label="Detected Note"
            value={detection ? formatNote(detection) : "--"}
            strong
          />
          <ReadoutCell
            label="Frequency"
            value={formatFrequency(detection?.frequency ?? null)}
          />
          <ReadoutCell
            label="Confidence"
            value={formatPercent(detection?.confidence ?? null)}
          />
          <ReadoutCell
            label="Status"
            value={detection ? tuningStatusLabel(detection.status) : "Listening"}
          />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Meter label="Input Level" value={snapshot.rms} max={0.08} />
          <Meter label="Pitch Confidence" value={detection?.confidence ?? 0} />
        </div>
      </div>

      <TuningIndicator detection={detection} />
    </section>
  );
}

interface ReadoutCellProps {
  label: string;
  value: string;
  strong?: boolean;
}

function ReadoutCell({ label, value, strong = false }: ReadoutCellProps) {
  return (
    <div className="min-h-24 rounded border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-sm font-semibold text-zinc-500">{label}</p>
      <p
        className={`mt-2 leading-none text-ink ${
          strong ? "text-5xl font-black" : "text-3xl font-bold"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
