import type { AudioDebugMetrics } from "../types/audio";
import type { ChordStabilityMetrics } from "../musicau/types";

interface AutomaticSensitivityPanelProps {
  gateOpen: boolean;
  metrics: AudioDebugMetrics;
  chordStability: ChordStabilityMetrics;
}

export function AutomaticSensitivityPanel({
  gateOpen,
  metrics,
  chordStability,
}: AutomaticSensitivityPanelProps) {
  return (
    <section className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Automatic Sensitivity</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {metrics.calibrating
              ? `Calibrating ${Math.round(metrics.calibrationProgress * 100)}%`
              : `Threshold ${metrics.threshold.toFixed(4)} RMS`}
          </p>
        </div>
        <span
          className={`rounded px-3 py-1 text-sm font-semibold ${
            gateOpen ? "bg-signal/20 text-emerald-900" : "bg-zinc-200 text-zinc-700"
          }`}
        >
          Input {gateOpen ? "Active" : "Idle"}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <DebugMetric label="Noise floor" value={metrics.noiseFloor.toFixed(4)} />
        <DebugMetric label="SNR" value={metrics.signalToNoiseRatio.toFixed(1)} />
        <DebugMetric label="Pitch confidence" value={`${Math.round(metrics.pitchConfidence * 100)}%`} />
        <DebugMetric label="Chord state" value={chordStability.state} />
        <DebugMetric
          label="Confirm"
          value={`${Math.round(chordStability.confirmationProgress * 100)}%`}
        />
        <DebugMetric
          label="Hold"
          value={`${Math.round(chordStability.holdTimeRemaining)} ms`}
        />
      </div>
    </section>
  );
}

function DebugMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-xs font-bold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}
