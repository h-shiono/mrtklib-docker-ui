import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useMantineColorScheme } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import type { ENUEpoch } from './types';
import { Q_COLORS } from './types';

interface Plot2DViewProps {
  data: ENUEpoch[];
  height: number;
}

interface Bounds {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

const PADDING = { top: 10, right: 10, bottom: 30, left: 50 };

export function Plot2DView({ data, height }: Plot2DViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ref: containerRef, width: containerWidth } = useElementSize();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  // Use the smaller of width/height to make a square plot
  const size = Math.min(containerWidth, height);

  // Zoom/pan state stored in ref (avoid re-renders during interaction)
  const viewRef = useRef<Bounds | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    bounds: Bounds;
  } | null>(null);

  // Compute natural bounds from data (memoized)
  const naturalBounds = useMemo((): Bounds | null => {
    if (data.length === 0) return null;
    let minE = Infinity,
      maxE = -Infinity,
      minN = Infinity,
      maxN = -Infinity;
    for (const epoch of data) {
      if (epoch.e < minE) minE = epoch.e;
      if (epoch.e > maxE) maxE = epoch.e;
      if (epoch.n < minN) minN = epoch.n;
      if (epoch.n > maxN) maxN = epoch.n;
    }
    const rangeE = maxE - minE || 1;
    const rangeN = maxN - minN || 1;
    const padFrac = 0.1;
    return {
      minE: minE - rangeE * padFrac,
      maxE: maxE + rangeE * padFrac,
      minN: minN - rangeN * padFrac,
      maxN: maxN + rangeN * padFrac,
    };
  }, [data]);

  // Reset zoom when data changes
  useEffect(() => {
    viewRef.current = null;
  }, [data]);

  // Core draw function — reads zoom state from viewRef
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !naturalBounds || size < 100) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const textColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.7)';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
    const bgColor = isDark ? '#1a1b1e' : '#ffffff';
    const axisColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.25)';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    // Use zoom bounds if set, otherwise natural bounds with aspect-ratio adjustment
    let { minE, maxE, minN, maxN } = viewRef.current || naturalBounds;

    const plotW = size - PADDING.left - PADDING.right;
    const plotH = size - PADDING.top - PADDING.bottom;

    // When using natural bounds (no zoom), enforce equal aspect ratio
    if (!viewRef.current) {
      const scaleE = plotW / (maxE - minE);
      const scaleN = plotH / (maxN - minN);
      const scale = Math.min(scaleE, scaleN);
      const actualRangeE = plotW / scale;
      const actualRangeN = plotH / scale;
      const centerE = (minE + maxE) / 2;
      const centerN = (minN + maxN) / 2;
      minE = centerE - actualRangeE / 2;
      maxE = centerE + actualRangeE / 2;
      minN = centerN - actualRangeN / 2;
      maxN = centerN + actualRangeN / 2;
    }

    // Coordinate transforms
    const toX = (e: number) => PADDING.left + ((e - minE) / (maxE - minE)) * plotW;
    const toY = (n: number) => PADDING.top + plotH - ((n - minN) / (maxN - minN)) * plotH;

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const gridCount = 5;

    ctx.font = '10px monospace';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';

    for (let i = 0; i <= gridCount; i++) {
      const val = minE + ((maxE - minE) * i) / gridCount;
      const x = toX(val);
      ctx.beginPath();
      ctx.moveTo(x, PADDING.top);
      ctx.lineTo(x, PADDING.top + plotH);
      ctx.stroke();
      ctx.fillText(formatAxisValue(val), x, size - 5);
    }

    ctx.textAlign = 'right';
    for (let i = 0; i <= gridCount; i++) {
      const val = minN + ((maxN - minN) * i) / gridCount;
      const y = toY(val);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(PADDING.left + plotW, y);
      ctx.stroke();
      ctx.fillText(formatAxisValue(val), PADDING.left - 4, y + 3);
    }

    // Plot border
    ctx.strokeStyle = axisColor;
    ctx.strokeRect(PADDING.left, PADDING.top, plotW, plotH);

    // Origin crosshair at (0,0)
    if (minE <= 0 && maxE >= 0 && minN <= 0 && maxN >= 0) {
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
      ctx.setLineDash([4, 4]);
      const ox = toX(0);
      const oy = toY(0);
      ctx.beginPath();
      ctx.moveTo(ox, PADDING.top);
      ctx.lineTo(ox, PADDING.top + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PADDING.left, oy);
      ctx.lineTo(PADDING.left + plotW, oy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Data points (clip to plot area)
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADDING.left, PADDING.top, plotW, plotH);
    ctx.clip();
    for (const epoch of data) {
      const x = toX(epoch.e);
      const y = toY(epoch.n);
      ctx.fillStyle = Q_COLORS[epoch.Q] || '#888';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Axis labels
    ctx.fillStyle = textColor;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('East (m)', PADDING.left + plotW / 2, size - 1);

    ctx.save();
    ctx.translate(12, PADDING.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('North (m)', 0, 0);
    ctx.restore();
  }, [data, naturalBounds, size, isDark]);

  // Draw on dependency change
  useEffect(() => {
    draw();
  }, [draw]);

  // Mouse interaction: wheel zoom, drag pan, double-click reset
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !naturalBounds) return;

    const plotW = size - PADDING.left - PADDING.right;
    const plotH = size - PADDING.top - PADDING.bottom;

    const getEffectiveBounds = (): Bounds => {
      if (viewRef.current) return viewRef.current;
      // Compute aspect-ratio adjusted natural bounds (same logic as draw)
      let { minE, maxE, minN, maxN } = naturalBounds;
      const scaleE = plotW / (maxE - minE);
      const scaleN = plotH / (maxN - minN);
      const scale = Math.min(scaleE, scaleN);
      const actualRangeE = plotW / scale;
      const actualRangeN = plotH / scale;
      const centerE = (minE + maxE) / 2;
      const centerN = (minN + maxN) / 2;
      return {
        minE: centerE - actualRangeE / 2,
        maxE: centerE + actualRangeE / 2,
        minN: centerN - actualRangeN / 2,
        maxN: centerN + actualRangeN / 2,
      };
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (size < 100) return;

      const bounds = getEffectiveBounds();
      const rect = canvas.getBoundingClientRect();

      // Mouse position as fraction of plot area [0..1]
      const mx = Math.max(0, Math.min(1, (e.clientX - rect.left - PADDING.left) / plotW));
      const my = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top - PADDING.top) / plotH));

      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const rangeE = bounds.maxE - bounds.minE;
      const rangeN = bounds.maxN - bounds.minN;
      const newRangeE = rangeE * factor;
      const newRangeN = rangeN * factor;

      // Zoom centered on mouse cursor position
      const centerE = bounds.minE + mx * rangeE;
      const centerN = bounds.minN + my * rangeN;

      viewRef.current = {
        minE: centerE - mx * newRangeE,
        maxE: centerE + (1 - mx) * newRangeE,
        minN: centerN - my * newRangeN,
        maxN: centerN + (1 - my) * newRangeN,
      };
      draw();
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const bounds = getEffectiveBounds();
      dragRef.current = { startX: e.clientX, startY: e.clientY, bounds: { ...bounds } };
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current || size < 100) return;
      const { startX, startY, bounds } = dragRef.current;
      const rangeE = bounds.maxE - bounds.minE;
      const rangeN = bounds.maxN - bounds.minN;
      const dx = ((e.clientX - startX) / plotW) * rangeE;
      const dy = ((e.clientY - startY) / plotH) * rangeN;

      viewRef.current = {
        minE: bounds.minE - dx,
        maxE: bounds.maxE - dx,
        minN: bounds.minN + dy, // inverted: canvas Y goes down, North goes up
        maxN: bounds.maxN + dy,
      };
      draw();
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        canvas.style.cursor = 'grab';
      }
    };

    const handleDblClick = () => {
      viewRef.current = null;
      draw();
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('dblclick', handleDblClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDblClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [naturalBounds, size, draw]);

  return (
    <div ref={containerRef} style={{ width: '100%', height, display: 'flex', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

/** Format axis values: use meters with appropriate precision */
function formatAxisValue(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 100) return val.toFixed(0);
  if (abs >= 1) return val.toFixed(1);
  return val.toFixed(3);
}
