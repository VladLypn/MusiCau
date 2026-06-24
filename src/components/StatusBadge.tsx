import type { MicrophoneStatus } from "../types/audio";

interface StatusBadgeProps {
  status: MicrophoneStatus;
}

const STATUS_COPY: Record<MicrophoneStatus, { label: string; className: string }> =
  {
    idle: {
      label: "Mic Idle",
      className: "bg-zinc-200 text-zinc-700 ring-zinc-300",
    },
    requesting: {
      label: "Requesting Mic",
      className: "bg-brass/20 text-amber-900 ring-brass/40",
    },
    connected: {
      label: "Mic Connected",
      className: "bg-signal/20 text-emerald-900 ring-signal/40",
    },
    denied: {
      label: "Mic Blocked",
      className: "bg-danger/15 text-red-900 ring-danger/30",
    },
    error: {
      label: "Mic Error",
      className: "bg-danger/15 text-red-900 ring-danger/30",
    },
  };

export function StatusBadge({ status }: StatusBadgeProps) {
  const copy = STATUS_COPY[status];

  return (
    <span
      className={`inline-flex min-h-9 items-center gap-2 rounded px-3 text-sm font-semibold ring-1 ${copy.className}`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          status === "connected" ? "bg-signal" : "bg-current"
        }`}
      />
      {copy.label}
    </span>
  );
}
