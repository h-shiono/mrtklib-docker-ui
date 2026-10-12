import { useEffect, useLayoutEffect, useRef, useMemo } from 'react';
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

/** uPlot plugin to draw Q-flag colored points. Reads Q values through a ref
 *  so setData() with new data does not need a new plugin (or chart). */
function qColorPlugin(qValuesRef: { current: number[] }): uPlot.Plugin {
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

          const q = qValuesRef.current[i] ?? 5;
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

        // Format time (the Date's UTC fields carry the file's own time system)
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
  const onXRangeChangeRef = useRef(onXRangeChange);

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

  // Latest props for the effects below, so a resize or new data updates the
  // existing chart (setSize / setData) instead of rebuilding it.
  const plotDataRef = useRef(plotData);
  const qValuesRef = useRef<number[]>([]);
  const sizeRef = useRef({ width, height });
  const rangesRef = useRef({ xRange, yRange });
  // Layout effects run before the effects below, so they always see these.
  useLayoutEffect(() => {
    onXRangeChangeRef.current = onXRangeChange;
    plotDataRef.current = plotData;
    qValuesRef.current = plotData?.qValues ?? [];
    sizeRef.current = { width, height };
    rangesRef.current = { xRange, yRange };
  });
  // The plotData currently shown by the chart instance.
  const shownDataRef = useRef<typeof plotData>(null);

  const ready = !!plotData && width >= 100;

  const applyRanges = (u: uPlot) => {
    const { xRange: xr, yRange: yr } = rangesRef.current;
    if (xr) u.setScale('x', { min: xr[0], max: xr[1] });
    if (yr) u.setScale('y', { min: yr[0], max: yr[1] });
  };

  // Create/destroy the uPlot instance. Only things baked into its options
  // (theme, metric, cursor sync) rebuild it; size and data are updated below.
  useEffect(() => {
    const plotData = plotDataRef.current;
    if (!chartRef.current || !plotData || !ready) return;
    const { width, height } = sizeRef.current;

    const axisColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
    const textColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.7)';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';

    const opts: uPlot.Options = {
      width,
      height: height - 8,
      plugins: [
        qColorPlugin(qValuesRef),
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
            // uPlot fires this hook from a deferred commit (a microtask), also
            // for our own setScale()/setData() calls, so a "programmatic" flag
            // set around those calls cannot tell them apart. Instead, report
            // only ranges that differ from the current shared range: that is
            // a user zoom or a double-click reset.
            if (key !== 'x' || !onXRangeChangeRef.current) return;
            const min = u.scales.x.min;
            const max = u.scales.x.max;
            if (min == null || max == null) return;
            const xData = u.data[0];
            const isFull = xData.length > 0 && min === xData[0] && max === xData[xData.length - 1];
            const cur = rangesRef.current.xRange;
            if (cur ? min === cur[0] && max === cur[1] : isFull) return;
            onXRangeChangeRef.current(isFull ? null : [min, max]);
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
    shownDataRef.current = plotData;
    applyRanges(uplotRef.current);

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
      shownDataRef.current = null;
    };
    // Size, data and ranges come from refs and are applied by the effects
    // below, so they do not rebuild the chart.
  }, [ready, isDark, metric, cursorSyncKey]);

  // Resize in place
  useEffect(() => {
    uplotRef.current?.setSize({ width, height: height - 8 });
  }, [width, height]);

  // New data in place (resets scales to the data, then re-applies the
  // shared x / y ranges)
  useEffect(() => {
    const u = uplotRef.current;
    if (!u || !plotData || shownDataRef.current === plotData) return;
    u.setData([Array.from(plotData.xValues), Array.from(plotData.yValues)]);
    shownDataRef.current = plotData;
    applyRanges(u);
  }, [plotData]);

  // Apply shared X-range changes imperatively (from other charts' zoom)
  useEffect(() => {
    if (!uplotRef.current) return;
    if (xRange) {
      uplotRef.current.setScale('x', { min: xRange[0], max: xRange[1] });
    } else {
      // Reset to full data range
      const xData = uplotRef.current.data[0];
      if (xData && xData.length > 0) {
        uplotRef.current.setScale('x', { min: xData[0], max: xData[xData.length - 1] });
      }
    }
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
