import { barTone } from '../format';

export function Battery({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className="battery" data-tone={barTone(clamped)} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)} title={`${Math.round(clamped)}% remaining`}>
      <i className="on" style={{ width: `${clamped}%` }} />
    </span>
  );
}
