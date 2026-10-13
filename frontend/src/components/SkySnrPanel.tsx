import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export interface Satellite {
  prn: string;
  system: string;
  azimuth: number;
  elevation: number;
  valid: boolean;
  fix: string;
  snr: number;
}

interface SkySnrPanelProps {
  satellites: Satellite[];
  updateTime?: string;
}

const SYS_COLOR: Record<string, string> = {
  GPS:     '#3b82f6',
  GLONASS: '#a855f7',
  Galileo: '#f59e0b',
  QZSS:    '#22c55e',
  BeiDou:  '#ef4444',
  SBAS:    '#6b7280',
  NavIC:   '#6b7280',
  Unknown: '#6b7280',
};

const FREQ_SYSTEMS: Record<string, string[]> = {
  L1:  ['GPS', 'QZSS', 'Galileo', 'GLONASS', 'BeiDou', 'SBAS'],
  L2:  ['GPS', 'GLONASS', 'BeiDou'],
  L5:  ['GPS', 'QZSS', 'Galileo', 'BeiDou'],
};

function isUsed(sat: Satellite): boolean {
  return sat.valid && sat.fix !== 'NONE';
}

function prnNumber(prn: string): string {
  return prn.replace(/^[A-Z]/, '');
}

/** Native SVG tooltip text for a sky plot marker. */
function satTooltip(sat: Satellite): string {
  const state = isUsed(sat)
    ? `Used (${sat.fix})`
    : sat.valid
      ? 'Valid, not used'
      : 'Not valid';
  const snr = sat.snr > 0 ? `${sat.snr.toFixed(1)} dBHz` : 'n/a';
  return [
    `${sat.prn} · ${sat.system}`,
    `Az ${sat.azimuth.toFixed(1)}°  El ${sat.elevation.toFixed(1)}°`,
    `SNR ${snr}`,
    state,
  ].join('\n');
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Sky Plot (SVG) ──────────────────────────────────────────────────────────

function SkyPlot({ satellites }: { satellites: Satellite[] }) {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const R = 140;

  const elToR = (el: number) => R * (1 - el / 90);
  const toXY = (az: number, el: number) => {
    const r = elToR(el);
    const azRad = (az * Math.PI) / 180 - Math.PI / 2;
    return { x: cx + Math.cos(azRad) * r, y: cy + Math.sin(azRad) * r };
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: size, aspectRatio: '1' }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={0.5} opacity={0.3} />
      <circle cx={cx} cy={cy} r={elToR(30)} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.2} />
      <circle cx={cx} cy={cy} r={elToR(60)} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.2} />
      <circle cx={cx} cy={cy} r={2} fill="var(--mantine-color-dimmed)" opacity={0.3} />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.15} />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.15} />
      <text x={cx} y={cy - R - 4} textAnchor="middle" fontSize={9} fill="var(--mantine-color-dimmed)">N</text>
      <text x={cx + R + 6} y={cy + 3} textAnchor="start" fontSize={9} fill="var(--mantine-color-dimmed)">E</text>
      <text x={cx} y={cy + R + 12} textAnchor="middle" fontSize={9} fill="var(--mantine-color-dimmed)">S</text>
      <text x={cx - R - 6} y={cy + 3} textAnchor="end" fontSize={9} fill="var(--mantine-color-dimmed)">W</text>
      <text x={cx + 3} y={cy - elToR(30) - 1} fontSize={7} fill="var(--mantine-color-dimmed)" opacity={0.5}>30</text>
      <text x={cx + 3} y={cy - elToR(60) - 1} fontSize={7} fill="var(--mantine-color-dimmed)" opacity={0.5}>60</text>

      {satellites.map((sat) => {
        const { x, y } = toXY(sat.azimuth, sat.elevation);
        const used = isUsed(sat);
        const color = SYS_COLOR[sat.system] || SYS_COLOR.Unknown;
        return (
          <g key={sat.prn}>
            <title>{satTooltip(sat)}</title>
            <circle
              cx={x}
              cy={y}
              r={7}
              fill={color}
              opacity={used ? 1.0 : 0.25}
              stroke={used ? 'white' : 'none'}
              strokeWidth={used ? 1 : 0}
            />
            <text
              x={x}
              y={y + 2.5}
              textAnchor="middle"
              fontSize={7}
              fill="white"
              fontWeight={500}
              style={{ pointerEvents: 'none' }}
            >
              {prnNumber(sat.prn)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── SNR Bar Chart (Chart.js) ───────────────────────────────────────────────

function SnrBarChart({ satellites }: { satellites: Satellite[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const sorted = useMemo(
    () => [...satellites].sort((a, b) => b.snr - a.snr),
    [satellites],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!chartRef.current) {
      chartRef.current = new Chart(canvas, {
        type: 'bar',
        data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.label}: ${(ctx.parsed.y ?? 0).toFixed(1)} dBHz`,
              },
            },
          },
          scales: {
            x: {
              ticks: {
                font: { family: "'IBM Plex Mono'", size: 9 },
                maxRotation: 60,
                minRotation: 45,
                color: '#868e96',
              },
              grid: { display: false },
            },
            y: {
              min: 0,
              max: 55,
              title: {
                display: true,
                text: 'SNR (dBHz)',
                font: { size: 9 },
                color: '#868e96',
              },
              ticks: {
                stepSize: 10,
                font: { size: 9 },
                color: '#868e96',
              },
              grid: {
                color: 'rgba(255,255,255,0.06)',
              },
            },
          },
        },
      });
    }

    const chart = chartRef.current;
    const ds = chart.data.datasets[0];
    chart.data.labels = sorted.map((s) => s.prn);
    ds.data = sorted.map((s) => s.snr);
    ds.backgroundColor = sorted.map((s) => {
      const hex = SYS_COLOR[s.system] || SYS_COLOR.Unknown;
      return hexToRgba(hex, isUsed(s) ? 0.8 : 0.25);
    });
    chart.update('none');

    return () => {};
  }, [sorted]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} />;
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export function SkySnrPanel({ satellites, updateTime }: SkySnrPanelProps) {
  const [freqFilter, setFreqFilter] = useState('All');

  const filtered = useMemo(() => {
    if (freqFilter === 'All') return satellites;
    const systems = FREQ_SYSTEMS[freqFilter] || [];
    return satellites.filter((s) => systems.includes(s.system));
  }, [satellites, freqFilter]);

  const usedCount = filtered.filter(isUsed).length;

  if (satellites.length === 0) {
    return (
      <Stack align="center" justify="center" style={{ height: '100%', minHeight: 120 }}>
        <Text size="xs" c="dimmed">No satellite data</Text>
      </Stack>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Frequency filter */}
      <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <SegmentedControl
          size="xs"
          value={freqFilter}
          onChange={setFreqFilter}
          data={['All', 'L1', 'L2', 'L5']}
        />
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--mantine-color-dimmed)' }}>
          {usedCount}/{filtered.length} sats used{updateTime ? ` \u00b7 ${updateTime}` : ''}
        </span>
      </div>

      {/* Sky Plot - takes remaining space */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0 }}>
        <SkyPlot satellites={filtered} />
      </div>

      {/* SNR Bar Chart - fixed height */}
      <div style={{ height: 160, borderTop: '0.5px solid var(--mantine-color-default-border)', padding: '4px 8px 4px' }}>
        <SnrBarChart satellites={filtered} />
      </div>
    </div>
  );
}
