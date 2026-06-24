interface MeterProps {
  label: string;
  value: number;
  max?: number;
}

export function Meter({ label, value, max = 1 }: MeterProps) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm font-medium text-zinc-700">
        <span>{label}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded bg-zinc-200">
        <div
          className="h-full rounded bg-fret transition-[width] duration-100"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
