type Props = {
  active: boolean;
  label: string;
};

export function BusyOverlay({ active, label }: Props) {
  if (!active) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="busy-card">
        <span className="busy-spinner" aria-hidden="true" />
        <div className="busy-copy">
          <strong>Çalışıyor</strong>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
