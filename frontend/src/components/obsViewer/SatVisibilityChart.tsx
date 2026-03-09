import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useElementSize } from '@mantine/hooks';
import type { SatVisSegment } from '../../api/obsQc';

interface SatVisibilityChartProps {
  visibility: SatVisSegment[];
  satellites: string[];
  snr: number[][]; // [[time, sat_idx, snr, el, az], ...]
  height: number;
  constellationFilter: Set<string>;
}

// Constellation colors (for satellite labels)
const CONSTELLATION_COLORS: Record<string, string> = {
  G: '#4CAF50', // GPS - Green
  R: '#F44336', // GLONASS - Red
  E: '#2196F3', // Galileo - Blue
  C: '#FF9800', // BeiDou - Orange
  J: '#9C27B0', // QZSS - Purple
  S: '#795548', // SBAS - Brown
  I: '#607D8B', // IRNSS - Blue Grey
};

const ROW_HEIGHT = 16;
const LABEL_WIDTH = 50;
const TOP_MARGIN = 24;
const BOTTOM_MARGIN = 44; // Room for time axis + colorbar

const SNR_MIN = 10;
const SNR_MAX = 50;
const QC_BLOCK_WIDTH = 30; // seconds (matches backend QC_INTERVAL)

/** Map SNR value (dBHz) to HSL color: red(low) → yellow → green(high) */
function snrToColor(snr: number): string {
  const t = Math.max(0, Math.min(1, (snr - SNR_MIN) / (SNR_MAX - SNR_MIN)));
  const hue = t * 120; // 0=red, 60=yellow, 120=green
  return `hsl(${hue}, 85%, 45%)`;
}

export function SatVisibilityChart({
  visibility,
  satellites,
  snr,
  height,
  constellationFilter,
}: SatVisibilityChartProps) {
  const { ref: containerRef, width } = useElementSize();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Zoom state
  const zoomRef = useRef<{ xMin: number; xMax: number } | null>(null);
  const dragRef = useRef<{ startX: number; isDragging: boolean }>({ startX: 0, isDragging: false });

  // Filter satellites by constellation
  const filteredSats = useMemo(() => {
    return satellites.filter((s) => constellationFilter.has(s[0]));
  }, [satellites, constellationFilter]);

  // Map original sat index → filtered index
  const satIdxToFiltered = useMemo(() => {
    const map = new Map<number, number>();
    let filteredIdx = 0;
    satellites.forEach((s, origIdx) => {
      if (constellationFilter.has(s[0])) {
        map.set(origIdx, filteredIdx++);
      }
    });
    return map;
  }, [satellites, constellationFilter]);

  // Filter visibility segments
  const filteredVis = useMemo(() => {
    return visibility.filter((v) => constellationFilter.has(v.constellation));
  }, [visibility, constellationFilter]);

  // Filter SNR data by constellation
  const filteredSnr = useMemo(() => {
    return snr.filter((row) => {
      const satId = satellites[row[1]];
      return satId && constellationFilter.has(satId[0]);
    });
  }, [snr, satellites, constellationFilter]);

  // Compute time range
  const timeRange = useMemo(() => {
    if (filteredVis.length === 0) return { min: 0, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const seg of filteredVis) {
      if (seg.start < min) min = seg.start;
      if (seg.end > max) max = seg.end;
    }
    return { min, max };
  }, [filteredVis]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 100) return;

    const dpr = window.devicePixelRatio || 1;
    const chartWidth = width - LABEL_WIDTH;
    const chartHeight = filteredSats.length * ROW_HEIGHT;
    const totalHeight = chartHeight + TOP_MARGIN + BOTTOM_MARGIN;

    canvas.width = width * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const isDark = document.documentElement.getAttribute('data-mantine-color-scheme') === 'dark';
    const bgColor = isDark ? '#1a1b1e' : '#ffffff';
    const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const segmentBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    // Clear
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, totalHeight);

    const zoom = zoomRef.current;
    const xMin = zoom ? zoom.xMin : timeRange.min;
    const xMax = zoom ? zoom.xMax : timeRange.max;
    const xSpan = xMax - xMin || 1;

    const toX = (t: number) => LABEL_WIDTH + ((t - xMin) / xSpan) * chartWidth;

    // Draw satellite labels and rows
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < filteredSats.length; i++) {
      const y = TOP_MARGIN + i * ROW_HEIGHT;
      const sid = filteredSats[i];

      // Alternating row background
      if (i % 2 === 0) {
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
        ctx.fillRect(LABEL_WIDTH, y, chartWidth, ROW_HEIGHT);
      }

      // Horizontal grid line
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Label (colored by constellation)
      ctx.fillStyle = CONSTELLATION_COLORS[sid[0]] || textColor;
      ctx.fillText(sid, LABEL_WIDTH - 4, y + ROW_HEIGHT / 2);
    }

    // Draw gray visibility segment bars (background — satellite presence)
    for (const seg of filteredVis) {
      const satIdx = filteredSats.indexOf(seg.sat_id);
      if (satIdx < 0) continue;

      const x1 = Math.max(toX(seg.start), LABEL_WIDTH);
      const x2 = Math.min(toX(seg.end), width);
      if (x2 < LABEL_WIDTH || x1 > width) continue;

      const y = TOP_MARGIN + satIdx * ROW_HEIGHT + 2;
      const barH = ROW_HEIGHT - 4;

      ctx.fillStyle = segmentBg;
      ctx.fillRect(x1, y, Math.max(x2 - x1, 1), barH);
    }

    // Draw SNR-colored blocks (per-epoch)
    const blockWidthPx = Math.max(1, (QC_BLOCK_WIDTH / xSpan) * chartWidth);
    for (const row of filteredSnr) {
      const [t, satIdx, snrVal] = row;
      const fIdx = satIdxToFiltered.get(satIdx);
      if (fIdx === undefined) continue;

      const x = toX(t);
      if (x + blockWidthPx < LABEL_WIDTH || x > width) continue;

      const clampedX = Math.max(x, LABEL_WIDTH);
      const drawW = Math.min(x + blockWidthPx, width) - clampedX;
      if (drawW <= 0) continue;

      const y = TOP_MARGIN + fIdx * ROW_HEIGHT + 2;
      const barH = ROW_HEIGHT - 4;

      ctx.fillStyle = snrToColor(snrVal);
      ctx.fillRect(clampedX, y, drawW, barH);
    }

    // Draw time axis
    ctx.fillStyle = textColor;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const numTicks = Math.max(Math.floor(chartWidth / 80), 2);
    for (let i = 0; i <= numTicks; i++) {
      const t = xMin + (i / numTicks) * xSpan;
      const x = toX(t);
      const d = new Date(t * 1000);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');

      // Tick line
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, TOP_MARGIN);
      ctx.lineTo(x, TOP_MARGIN + chartHeight);
      ctx.stroke();

      // Label
      ctx.fillStyle = textColor;
      ctx.fillText(`${hh}:${mm}`, x, TOP_MARGIN + chartHeight + 4);
    }

    // Draw colorbar legend
    const legendY = TOP_MARGIN + chartHeight + 22;
    const legendH = 10;
    const legendLeft = LABEL_WIDTH + 40;
    const legendRight = width - 40;
    const legendW = legendRight - legendLeft;

    if (legendW > 80) {
      // Gradient bar
      for (let px = 0; px < legendW; px++) {
        const snrVal = SNR_MIN + (px / legendW) * (SNR_MAX - SNR_MIN);
        ctx.fillStyle = snrToColor(snrVal);
        ctx.fillRect(legendLeft + px, legendY, 1, legendH);
      }

      // Border
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(legendLeft, legendY, legendW, legendH);

      // Tick labels
      ctx.fillStyle = textColor;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tickValues = [10, 20, 30, 40, 50];
      for (const tv of tickValues) {
        const tx = legendLeft + ((tv - SNR_MIN) / (SNR_MAX - SNR_MIN)) * legendW;
        ctx.fillText(`${tv}`, tx, legendY + legendH + 2);
      }

      // Unit label
      ctx.textAlign = 'left';
      ctx.fillText('dBHz', legendRight + 6, legendY + 1);
    }
  }, [width, filteredSats, filteredVis, filteredSnr, satIdxToFiltered, timeRange]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Mouse handlers for zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const chartWidth = width - LABEL_WIDTH;
    const zoom = zoomRef.current;
    const xMin = zoom ? zoom.xMin : timeRange.min;
    const xMax = zoom ? zoom.xMax : timeRange.max;
    const xSpan = xMax - xMin || 1;

    const xFromPixel = (px: number) => xMin + ((px - LABEL_WIDTH) / chartWidth) * xSpan;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x > LABEL_WIDTH) {
        dragRef.current = { startX: x, isDragging: true };
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const startX = dragRef.current.startX;
      dragRef.current.isDragging = false;

      if (Math.abs(endX - startX) > 10) {
        const t1 = xFromPixel(Math.min(startX, endX));
        const t2 = xFromPixel(Math.max(startX, endX));
        zoomRef.current = { xMin: t1, xMax: t2 };
        draw();
      }
    };

    const handleDblClick = () => {
      zoomRef.current = null;
      draw();
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('dblclick', handleDblClick);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('dblclick', handleDblClick);
    };
  }, [width, timeRange, draw]);

  const canvasHeight = filteredSats.length * ROW_HEIGHT + TOP_MARGIN + BOTTOM_MARGIN;

  return (
    <div ref={containerRef} style={{ width: '100%', height, overflow: 'auto' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: canvasHeight,
          cursor: 'crosshair',
        }}
      />
    </div>
  );
}
