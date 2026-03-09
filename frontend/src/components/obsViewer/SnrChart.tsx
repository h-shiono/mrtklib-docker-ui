import { useEffect, useRef, useMemo } from 'react';
import { useElementSize } from '@mantine/hooks';
import { useMantineColorScheme, Stack, Text } from '@mantine/core';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface SnrChartProps {
  /** SNR data: [[time, sat_idx, snr, el, az], ...] */
  snr: number[][];
  satellites: string[];
  height: number;
  mode: 'time' | 'elevation';
  constellationFilter: Set<string>;
  hasElevation: boolean;
}

// Constellation colors
const CONSTELLATION_COLORS: Record<string, string> = {
  G: '#4CAF50',
  R: '#F44336',
  E: '#2196F3',
  C: '#FF9800',
  J: '#9C27B0',
  S: '#795548',
  I: '#607D8B',
};

/** uPlot plugin to draw constellation-colored scatter points */
function constellationScatterPlugin(
  xValues: number[],
  yValues: number[],
  colors: string[],
): uPlot.Plugin {
  return {
    hooks: {
      drawSeries: (u: uPlot, seriesIdx: number) => {
        if (seriesIdx !== 1) return;
        const ctx = u.ctx;
        ctx.save();

        for (let i = 0; i < xValues.length; i++) {
          const x = u.valToPos(xValues[i], 'x', true);
          const y = u.valToPos(yValues[i], 'y', true);
          if (x < 0 || y < 0 || isNaN(x) || isNaN(y)) continue;

          ctx.fillStyle = colors[i];
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.arc(x, y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      },
    },
  };
}

/** uPlot tooltip plugin for SNR charts */
function snrTooltipPlugin(
  xValues: number[],
  yValues: number[],
  satIds: string[],
  mode: 'time' | 'elevation',
  isDark: boolean,
): uPlot.Plugin {
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
        tip.style.border = isDark
          ? '1px solid rgba(255,255,255,0.15)'
          : '1px solid rgba(0,0,0,0.12)';
        tip.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        u.over.appendChild(tip);
      },
      setCursor: (u: uPlot) => {
        if (!tip) return;
        const idx = u.cursor.idx;
        if (idx == null || idx >= xValues.length) {
          tip.style.display = 'none';
          return;
        }

        const xVal = xValues[idx];
        const yVal = yValues[idx];
        const satId = satIds[idx];
        if (xVal == null || yVal == null) {
          tip.style.display = 'none';
          return;
        }

        let xLabel: string;
        if (mode === 'time') {
          const d = new Date(xVal * 1000);
          const hh = String(d.getUTCHours()).padStart(2, '0');
          const mm = String(d.getUTCMinutes()).padStart(2, '0');
          const ss = String(d.getUTCSeconds()).padStart(2, '0');
          xLabel = `${hh}:${mm}:${ss}`;
        } else {
          xLabel = `El=${xVal.toFixed(1)}°`;
        }

        tip.textContent = `${satId} ${xLabel} SNR=${yVal.toFixed(1)}`;
        tip.style.display = 'block';

        const cx = Math.round(u.valToPos(xVal, 'x'));
        const cy = Math.round(u.valToPos(yVal, 'y'));
        const overW = u.over.clientWidth;
        const tipW = tip.offsetWidth || 100;
        const left = cx + tipW + 12 > overW ? cx - tipW - 8 : cx + 8;
        const top = Math.max(0, cy - 22);
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      },
    },
  };
}

export function SnrChart({
  snr,
  satellites,
  height,
  mode,
  constellationFilter,
  hasElevation,
}: SnrChartProps) {
  const { ref: containerRef, width } = useElementSize();
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  // If elevation mode but no elevation data, show message
  if (mode === 'elevation' && !hasElevation) {
    return (
      <Stack align="center" justify="center" h={height} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          NAV file required for SNR vs Elevation plot
        </Text>
      </Stack>
    );
  }

  // Filter and prepare data
  const plotData = useMemo(() => {
    const xArr: number[] = [];
    const yArr: number[] = [];
    const colorArr: string[] = [];
    const satIdArr: string[] = [];

    for (const row of snr) {
      const [time, satIdx, snrVal, el, _az] = row;
      const satId = satellites[satIdx];
      if (!satId) continue;
      const constellation = satId[0];
      if (!constellationFilter.has(constellation)) continue;

      if (mode === 'elevation') {
        if (el < 0) continue; // No elevation data
        xArr.push(el);
      } else {
        xArr.push(time);
      }
      yArr.push(snrVal);
      colorArr.push(CONSTELLATION_COLORS[constellation] || '#888');
      satIdArr.push(satId);
    }

    return { xArr, yArr, colorArr, satIdArr };
  }, [snr, satellites, mode, constellationFilter]);

  useEffect(() => {
    if (!chartRef.current || plotData.xArr.length === 0 || width < 100) return;

    const axisColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
    const textColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.7)';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';

    // For uPlot, we need sorted x data. Create sorted index.
    const indices = Array.from({ length: plotData.xArr.length }, (_, i) => i);
    indices.sort((a, b) => plotData.xArr[a] - plotData.xArr[b]);

    const sortedX = indices.map((i) => plotData.xArr[i]);
    const sortedY = indices.map((i) => plotData.yArr[i]);
    const sortedColors = indices.map((i) => plotData.colorArr[i]);
    const sortedSatIds = indices.map((i) => plotData.satIdArr[i]);

    const opts: uPlot.Options = {
      width,
      height: height - 8,
      plugins: [
        constellationScatterPlugin(sortedX, sortedY, sortedColors),
        snrTooltipPlugin(sortedX, sortedY, sortedSatIds, mode, isDark),
      ],
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false },
      },
      scales: {
        x: { time: mode === 'time' },
        y: {
          range: (_u: uPlot, min: number, max: number) => {
            const lo = Math.max(0, Math.floor(min / 5) * 5);
            const hi = Math.ceil(max / 5) * 5 + 5;
            return [lo, hi] as uPlot.Range.MinMax;
          },
        },
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor },
          ticks: { stroke: axisColor },
          font: '10px monospace',
          ...(mode === 'time'
            ? {
                values: (_u: uPlot, vals: number[]) =>
                  vals.map((v) => {
                    const d = new Date(v * 1000);
                    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
                  }),
              }
            : {
                label: 'Elevation (°)',
                labelFont: '11px sans-serif',
              }),
        },
        {
          stroke: textColor,
          grid: { stroke: gridColor },
          ticks: { stroke: axisColor },
          font: '10px monospace',
          label: 'SNR (dBHz)',
          labelFont: '11px sans-serif',
          size: 50,
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

    const uplotData: uPlot.AlignedData = [sortedX, sortedY];

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(opts, uplotData, chartRef.current);

    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, [plotData, width, height, isDark, mode]);

  if (plotData.xArr.length === 0) {
    return (
      <Stack align="center" justify="center" h={height} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          No SNR data available
        </Text>
      </Stack>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height }}>
      <div ref={chartRef} />
    </div>
  );
}
