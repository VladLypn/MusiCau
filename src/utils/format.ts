export function formatFrequency(frequency: number | null): string {
  return frequency === null ? "-- Hz" : `${frequency.toFixed(1)} Hz`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "--%" : `${Math.round(value * 100)}%`;
}

export function formatCents(cents: number | null): string {
  if (cents === null) {
    return "-- cents";
  }

  const sign = cents > 0 ? "+" : "";
  return `${sign}${cents} cents`;
}
