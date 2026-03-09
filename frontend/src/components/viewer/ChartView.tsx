import { useEffect, useRef, useMemo } from 'react';
import { useElementSize } from '@mantine/hooks';
import { useMantineColorScheme } from '@mantine/core';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ENUEpoch, ChartMetric } from './types';
import { Q_COLORS } from './types';

interface ChartViewProps {
  data: ENUEpoch[];
  height: number;
  metric: ChartMetric;
  /** Shared X-axis range [min, max] in unix seconds. null = auto */
  xRange?: [number, number] | null;
  /** Y-axis range [min, max]. null = auto */
  yRange?: [number, number] | null;
  /** Called when user zooms/resets on X axis (for cross-chart sync) */
  onXRangeChange?: (range: [number, number] | null) => void;
  /** Shared cursor sync key (all charts with same key sync their cursors) */
  cursorSyncKey?: string;
}

const METRIC_LABELS: Record<ChartMetric, string> = {
  e: 'East (m)',
  n: 'North (m)',
  u: 'Up (m)',
  ns: '# Satellites',
};

const METRIC_SHORT: Record<ChartMetric, string> = {
  e: 'E',
  n: 'N',
  u: 'U',
  ns: 'ns',
};

/** uPlot plugin to draw Q-flag colored points */
function qColorPlugin(qValues: number[]): uPlot.Plugin {
  return {
    hooks: {
      drawSeries: (u: uPlot, seriesIdx: number) => {
        if (seriesIdx !== 1) return;
        const ctx = u.ctx;
        const xData = u.data[0];
        const yData = u.data[seriesIdx];

        ctx.save();
        for (let i = 0; i < xData.length; i++) {
          const x = u.valToPos(xData[i], 'x', true);
          const y = u.valToPos(yData[i] as number, 'y', true);
          if (x < 0 || y < 0) continue;

          const q = qValues[i] ?? 5;
          ctx.fillStyle = Q_COLORS[q] || '#888';
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },
  };
}

/** uPlot plugin for floating tooltip near the data point */
function tooltipPlugin(metricKey: ChartMetric, isDark: boolean): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;

  return {
    hooks: {
      init: (u: uPlot) => {
        tip = document.createElement('div');
        tip.style.position = 'absolute';
        tip.style.pointerEvents = 'none';
        tip.style.display = 'none';
        tip.style.padding = '3px 6px';
        tip.style.borderRadius = '4px';
        tip.style.fontSize = '10px';
        tip.style.fontFamily = 'monospace';
        tip.style.zIndex = '100';
        tip.style.whiteSpace = 'nowrap';
        tip.style.backgroundColor = isDark ? 'rgba(30,30,30,0.9)' : 'rgba(255,255,255,0.92)';
        tip.style.color = isDark ? '#ddd' : '#333';
        tip.style.border = isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(0,0,0,0.12)';
        tip.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        u.over.appendChild(tip);
      },
      setCursor: (u: uPlot) => {
        if (!tip) return;
        const idx = u.cursor.idx;
        if (idx == null) {
          tip.style.display = 'none';
          return;
        }

        const xVal = u.data[0][idx];
        const yVal = u.data[1][idx] as number;
        if (xVal == null || yVal == null) {
          tip.style.display = 'none';
          return;
        }

        // Format time (UTC)
        const d = new Date(xVal * 1000);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const ss = String(d.getUTCSeconds()).padStart(2, '0');

        // Format value
        const valStr = metricKey === 'ns' ? String(yVal) : yVal.toFixed(4);
        tip.textContent = `${hh}:${mm}:${ss}  ${METRIC_SHORT[metricKey]}=${valStr}`;
        tip.style.display = 'block';

        // Position: near the data point, offset to top-right
        const cx = Math.round(u.valToPos(xVal, 'x'));
        const cy = Math.round(u.valToPos(yVal, 'y'));
        const overW = u.over.clientWidth;

        // Flip to left side if too close to right edge
        const tipW = tip.offsetWidth || 100;
        const left = cx + tipW + 12 > overW ? cx - tipW - 8 : cx + 8;
        const top = Math.max(0, cy - 22);

        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      },
    },
  };
}

export function ChartView({
  data,
  height,
  metric,
  xRange = null,
  yRange = null,
  onXRangeChange,
  cursorSyncKey,
}: ChartViewProps) {
  const { ref: containerRef, width } = useElementSize();
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  // Refs to avoid stale closures in uPlot hooks
  const programmaticRef = useRef(false);
  const onXRangeChangeRef = useRef(onXRangeChange);
  onXRangeChangeRef.current = onXRangeChange;

  // Prepare uPlot data arrays
  const plotData = useMemo(() => {
    if (data.length === 0) return null;
    const xValues = new Float64Array(data.length);
    const yValues = new Float64Array(data.length);
    const qValues: number[] = [];

    for (let i = 0; i < data.length; i++) {
      xValues[i] = data[i].timeUnix;
      yValues[i] = data[i][metric];
      qValues.push(data[i].Q);
    }

    return { xValues, yValues, qValues };
  }, [data, metric]);

  // Create/destroy uPlot instance
  useEffect(() => {
    if (!chartRef.current || !plotData || width < 100) return;

    const axisColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
    const textColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.7)';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';

    const opts: uPlot.Options = {
      width,
      height: height - 8,
      plugins: [
        qColorPlugin(plotData.qValues),
        tooltipPlugin(metric, isDark),
      ],
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false },
        ...(cursorSyncKey ? { sync: { key: cursorSyncKey } } : {}),
      },
      scales: {
        x: { time: true },
        y: metric === 'ns' ? {
          range: (_u: uPlot, _min: number, max: number) => [0, max] as uPlot.Range.MinMax,
        } : {},
      },
      hooks: {
        setScale: [
          (u: uPlot, key: string) => {
            if (key === 'x' && !programmaticRef.current && onXRangeChangeRef.current) {
              const min = u.scales.x.min;
              const max = u.scales.x.max;
              if (min != null && max != null) {
                // Check if it's a full-range reset (double-click)
                const xData = u.data[0];
                const fullMin = xData[0];
                const fullMax = xData[xData.length - 1];
                if (min === fullMin && max === fullMax) {
                  onXRangeChangeRef.current(null);
                } else {
                  onXRangeChangeRef.current([min, max]);
                }
              }
            }
          },
        ],
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor },
          ticks: { stroke: axisColor },
          font: '10px monospace',
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) => {
              const d = new Date(v * 1000);
              return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
            }),
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor },
          ticks: { stroke: axisColor },
          font: '10px monospace',
          label: METRIC_LABELS[metric],
          labelFont: '11px sans-serif',
          size: 60,
        },
      ],
      series: [
        {},
        {
          stroke: 'transparent',
          points: { show: false },
        },
      ],
    };

    const uplotData: uPlot.AlignedData = [
      Array.from(plotData.xValues),
      Array.from(plotData.yValues),
    ];

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(opts, uplotData, chartRef.current);

    // Apply initial ranges after creation
    if (xRange) {
      programmaticRef.current = true;
      uplotRef.current.setScale('x', { min: xRange[0], max: xRange[1] });
      programmaticRef.current = false;
    }
    if (yRange) {
      uplotRef.current.setScale('y', { min: yRange[0], max: yRange[1] });
    }

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
    // Do NOT include xRange/yRange — those are applied imperatively below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotData, width, height, isDark, metric, cursorSyncKey]);

  // Apply shared X-range changes imperatively (from other charts' zoom)
  useEffect(() => {
    if (!uplotRef.current) return;
    programmaticRef.current = true;
    if (xRange) {
      uplotRef.current.setScale('x', { min: xRange[0], max: xRange[1] });
    } else {
      // Reset to full data range
      const xData = uplotRef.current.data[0];
      if (xData && xData.length > 0) {
        uplotRef.current.setScale('x', { min: xData[0], max: xData[xData.length - 1] });
      }
    }
    programmaticRef.current = false;
  }, [xRange]);

  // Apply Y-range changes imperatively
  useEffect(() => {
    if (!uplotRef.current) return;
    if (yRange) {
      uplotRef.current.setScale('y', { min: yRange[0], max: yRange[1] });
    } else {
      // Reset to auto: compute from visible data
      const yData = uplotRef.current.data[1];
      if (yData && yData.length > 0) {
        let min = Infinity,
          max = -Infinity;
        for (const v of yData) {
          if (v != null) {
            if (v < min) min = v as number;
            if (v > max) max = v as number;
          }
        }
        const padding = (max - min) * 0.05 || 1;
        uplotRef.current.setScale('y', { min: min - padding, max: max + padding });
      }
    }
  }, [yRange]);

  return (
    <div ref={containerRef} style={{ width: '100%', height }}>
      <div ref={chartRef} />
    </div>
  );
}
