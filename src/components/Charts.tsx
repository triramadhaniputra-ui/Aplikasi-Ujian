import React, { useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  subLabel?: string;
}

export const SimpleBarChart: React.FC<{
  data: BarDatum[];
  maxVal?: number;
  unit?: string;
  barColor?: string;
  emptyText?: string;
}> = ({ data, maxVal, unit = '', barColor = '#2563EB', emptyText = 'Belum ada data grafik' }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="h-52 flex items-center justify-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
        {emptyText}
      </div>
    );
  }

  const max = maxVal ?? Math.max(10, ...data.map((d) => d.value));

  return (
    <div className="w-full">
      <div className="h-52 flex items-end gap-3 pt-6 pb-2 px-2 border-b border-slate-200">
        {data.map((item, idx) => {
          const pct = Math.max(4, Math.min(100, (item.value / max) * 100));
          const isHovered = hoverIdx === idx;
          return (
            <div
              key={`${item.label}-${idx}`}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="flex-1 flex flex-col items-center justify-end h-full relative group"
            >
              {isHovered && (
                <div className="absolute -top-2 z-10 px-2 py-1 rounded bg-slate-900 text-white text-xs font-mono tabular-nums whitespace-nowrap shadow">
                  {item.value}
                  {unit}
                </div>
              )}
              <span className="text-xs font-mono tabular-nums text-slate-600 mb-1">
                {item.value}
                {unit}
              </span>
              <div
                className="w-full max-w-[44px] rounded-t-md transition-all duration-150"
                style={{
                  height: `${pct}%`,
                  backgroundColor: isHovered ? '#1D4ED8' : barColor,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-start gap-3 px-2 pt-2">
        {data.map((item, idx) => (
          <div key={`lbl-${idx}`} className="flex-1 text-center">
            <div className="text-xs font-medium text-slate-700 truncate" title={item.label}>
              {item.label}
            </div>
            {item.subLabel && (
              <div className="text-[11px] text-slate-400 truncate">{item.subLabel}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export const DonutChart: React.FC<{
  data: DonutDatum[];
  centerLabel?: string;
  centerValue?: string;
}> = ({ data, centerLabel, centerValue }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth={strokeWidth}
          />
          {total > 0 &&
            data.map((seg, idx) => {
              const dash = (seg.value / total) * circumference;
              const offset = -cumulative;
              cumulative += dash;
              return (
                <circle
                  key={idx}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${circumference}`}
                  strokeDashoffset={offset}
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
            {centerValue ?? total}
          </span>
          {centerLabel && <span className="text-xs text-slate-500">{centerLabel}</span>}
        </div>
      </div>

      <div className="flex-1 w-full space-y-2.5">
        {data.map((seg, idx) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 1000) / 10 : 0;
          return (
            <div key={idx} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-sm shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="text-slate-700 font-medium">{seg.label}</span>
              </div>
              <div className="font-mono tabular-nums text-slate-900 text-xs">
                <span className="font-semibold">{seg.value}</span>{' '}
                <span className="text-slate-400">({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
