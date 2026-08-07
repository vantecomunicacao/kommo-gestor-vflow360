// Extraído de src/pages/Reports.tsx (Fase 5 do plano de remediação, 2026-08) —
// componente puro, sem estado. Extração mecânica, mesmo código.

// Sparkline SVG minimalista.
export function Sparkline({ values }: { values: number[] }) {
  const w = 88, h = 24, pad = 2;
  if (values.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
