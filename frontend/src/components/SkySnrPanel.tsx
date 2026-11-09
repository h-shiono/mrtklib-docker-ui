import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chip,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { bandGroupsIn, bandSnr, hasBandSnr, hasSkyPosition, isUsed } from '../utils/satellites';
import type { Satellite } from '../types/satellite';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { FONT_SIZE, MONO } from '../utils/typography';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

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

/** Order of the system toggles; systems not listed follow by name. */
const SYS_ORDER = ['GPS', 'GLONASS', 'Galileo', 'QZSS', 'BeiDou', 'SBAS', 'NavIC'];

function sysRank(sys: string): number {
  const i = SYS_ORDER.indexOf(sys);
  return i < 0 ? SYS_ORDER.length : i;
}

/** Without per-band C/N0 (Real-Time), a band keeps the systems that
 *  broadcast it; the SNR shown stays the satellite's one value. */
const FREQ_SYSTEMS: Record<string, string[]> = {
  L1:  ['GPS', 'QZSS', 'Galileo', 'GLONASS', 'BeiDou', 'SBAS'],
  L2:  ['GPS', 'GLONASS', 'BeiDou'],
  L5:  ['GPS', 'QZSS', 'Galileo', 'BeiDou'],
};

/** A satellite as shown: with a band selected, `snr` is that band's and
 *  `band` names the signal. */
type ShownSatellite = Satellite & { band?: string };


function prnNumber(prn: string): string {
  return prn.replace(/^[A-Z]/, '');
}

/** Native SVG tooltip text for a sky plot marker. */
function satTooltip(sat: ShownSatellite): string {
  let state: string;
  if (sat.used == null && sat.valid === undefined) state = 'Tracked (usage not reported)';
  else if (isUsed(sat)) state = sat.fix && sat.fix !== 'NONE' ? `Used (${sat.fix})` : 'Used';
  else if (sat.valid === undefined) state = 'Not used';
  else state = sat.valid ? 'Valid, not used' : 'Not valid';
  const snr = sat.snr != null && sat.snr > 0 ? `${sat.snr.toFixed(1)} dBHz` : 'n/a';
  const pos = hasSkyPosition(sat)
    ? `Az ${sat.azimuth.toFixed(1)}°  El ${sat.elevation.toFixed(1)}°`
    : 'Az / El n/a';
  return [
    `${sat.prn} · ${sat.system}`,
    pos,
    `SNR${sat.band ? ` ${sat.band}` : ''} ${snr}`,
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

// Marker radius and PRN font size in viewBox units (#127). The plot scales
// with the panel, up to SKY_MAX_PX.
const SAT_R = 11;
const SAT_FONT = 10;
const SKY_MAX_PX = 440;

function SkyPlot({ satellites }: { satellites: ShownSatellite[] }) {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const R = 138;
  // Used satellites on top, so they are not hidden by unused ones. A satellite
  // without a position (the Stream Monitor's stream did not give az/el) is
  // left off the plot but stays in the SNR bars.
  const ordered = satellites
    .filter(hasSkyPosition)
    .sort((a, b) => Number(isUsed(a)) - Number(isUsed(b)));

  const elToR = (el: number) => R * (1 - el / 90);
  const toXY = (az: number, el: number) => {
    const r = elToR(el);
    const azRad = (az * Math.PI) / 180 - Math.PI / 2;
    return { x: cx + Math.cos(azRad) * r, y: cy + Math.sin(azRad) * r };
  };

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      // Fit the panel's width and height (viewBox keeps it square)
      style={{ width: '100%', height: '100%', maxWidth: SKY_MAX_PX, maxHeight: SKY_MAX_PX }}
    >
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={0.5} opacity={0.3} />
      <circle cx={cx} cy={cy} r={elToR(30)} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.2} />
      <circle cx={cx} cy={cy} r={elToR(60)} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.2} />
      <circle cx={cx} cy={cy} r={2} fill="var(--mantine-color-dimmed)" opacity={0.3} />
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.15} />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="var(--mantine-color-dimmed)" strokeWidth={0.3} opacity={0.15} />
      <text x={cx} y={cy - R - 4} textAnchor="middle" fontSize={11} fill="var(--mantine-color-dimmed)">N</text>
      <text x={cx + R + 6} y={cy + 3} textAnchor="start" fontSize={11} fill="var(--mantine-color-dimmed)">E</text>
      <text x={cx} y={cy + R + 12} textAnchor="middle" fontSize={11} fill="var(--mantine-color-dimmed)">S</text>
      <text x={cx - R - 6} y={cy + 3} textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)">W</text>
      <text x={cx + 3} y={cy - elToR(30) - 1} fontSize={9} fill="var(--mantine-color-dimmed)" opacity={0.5}>30</text>
      <text x={cx + 3} y={cy - elToR(60) - 1} fontSize={9} fill="var(--mantine-color-dimmed)" opacity={0.5}>60</text>

      {ordered.map((sat) => {
        const { x, y } = toXY(sat.azimuth, sat.elevation);
        const used = isUsed(sat);
        const color = SYS_COLOR[sat.system] || SYS_COLOR.Unknown;
        return (
          <g key={sat.prn}>
            <title>{satTooltip(sat)}</title>
            <circle
              cx={x}
              cy={y}
              r={SAT_R}
              fill={color}
              fillOpacity={used ? 1.0 : 0.3}
              stroke={used ? 'white' : color}
              strokeWidth={used ? 1.2 : 0.8}
              strokeOpacity={used ? 1 : 0.7}
            />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={SAT_FONT}
              fontFamily="'IBM Plex Mono', monospace"
              fontWeight={600}
              // White on a solid marker; an unused marker is a faint tint, so
              // its label takes the theme's text colour (dark in light theme)
              style={{ pointerEvents: 'none', fill: used ? 'white' : 'var(--mantine-color-text)' }}
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

function SnrBarChart({ satellites }: { satellites: ShownSatellite[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const sorted = useMemo(
    () => [...satellites].sort((a, b) => (b.snr ?? 0) - (a.snr ?? 0)),
    [satellites],
  );
  // For the tooltip, which the chart keeps from its creation.
  const sortedRef = useRef(sorted);
  useEffect(() => {
    sortedRef.current = sorted;
  }, [sorted]);

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
                label: (ctx) => {
                  const band = sortedRef.current[ctx.dataIndex]?.band;
                  return `${ctx.label}${band ? ` ${band}` : ''}: ${(ctx.parsed.y ?? 0).toFixed(1)} dBHz`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                font: { family: "'IBM Plex Mono'", size: FONT_SIZE.caption },
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
                font: { size: FONT_SIZE.caption },
                color: '#868e96',
              },
              ticks: {
                stepSize: 10,
                font: { size: FONT_SIZE.caption },
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
    ds.data = sorted.map((s) => s.snr ?? 0);
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
  // Systems switched off (not the ones switched on), so a system that shows
  // up later is visible. Kept per browser, shared by RT and Stream Monitor.
  const [hiddenSystems, setHiddenSystems] = useLocalStorage<string[]>({
    key: 'mrtk-skyplot-hidden-systems',
    defaultValue: [],
  });

  // Per-band C/N0 (Stream Monitor): the bands in the data, and each
  // satellite's SNR in the selected band. Otherwise (Real-Time): L1 / L2 / L5
  // by the systems that broadcast them.
  const perBand = useMemo(() => hasBandSnr(satellites), [satellites]);
  const bandOptions = useMemo(
    () => ['All', ...(perBand ? bandGroupsIn(satellites) : Object.keys(FREQ_SYSTEMS))],
    [perBand, satellites],
  );
  // A band no longer in the data shows All (the choice comes back with it).
  const band = bandOptions.includes(freqFilter) ? freqFilter : 'All';

  const bandFiltered = useMemo((): ShownSatellite[] => {
    if (band === 'All') return satellites;
    if (perBand) {
      return satellites.flatMap((s) => {
        const b = bandSnr(s, band);
        return b ? [{ ...s, snr: b.snr, band: b.band }] : [];
      });
    }
    const systems = FREQ_SYSTEMS[band] || [];
    return satellites.filter((s) => systems.includes(s.system));
  }, [satellites, band, perBand]);

  // Systems in view (after the band filter), with their satellite counts.
  const systems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of bandFiltered) counts.set(s.system, (counts.get(s.system) ?? 0) + 1);
    return [...counts.entries()].sort(
      ([a], [b]) => sysRank(a) - sysRank(b) || a.localeCompare(b),
    );
  }, [bandFiltered]);

  const filtered = useMemo(
    () => bandFiltered.filter((s) => !hiddenSystems.includes(s.system)),
    [bandFiltered, hiddenSystems],
  );

  const toggleSystem = (sys: string, on: boolean) =>
    setHiddenSystems((prev) => (on ? prev.filter((x) => x !== sys) : [...prev, sys]));

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
          value={band}
          onChange={setFreqFilter}
          data={bandOptions}
        />
        <span style={{ marginLeft: 'auto', fontSize: FONT_SIZE.label, fontFamily: MONO, color: 'var(--mantine-color-dimmed)' }}>
          {usedCount}/{filtered.length} sats used{updateTime ? ` \u00b7 ${updateTime}` : ''}
        </span>
      </div>

      {/* System toggles: also the colour legend */}
      {systems.length > 0 && (
        <Group gap={4} px={10} pb={4} wrap="wrap">
          {systems.map(([sys, n]) => (
            <Chip
              key={sys}
              size="xs"
              variant="light"
              color={SYS_COLOR[sys] || SYS_COLOR.Unknown}
              checked={!hiddenSystems.includes(sys)}
              onChange={(on) => toggleSystem(sys, on)}
              styles={{ label: { fontFamily: MONO, fontSize: FONT_SIZE.label } }}
            >
              {sys} {n}
            </Chip>
          ))}
        </Group>
      )}

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
