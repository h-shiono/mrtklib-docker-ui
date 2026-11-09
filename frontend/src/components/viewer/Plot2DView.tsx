import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { ActionIcon, useMantineColorScheme } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconZoomReset } from '@tabler/icons-react';
import type { ENUEpoch } from './types';
import { qualityColor } from '../../utils/quality';

interface Plot2DViewProps {
  data: ENUEpoch[];
  height: number;
  /** Zoom / pan is reset when this changes (another source or reference);
   *  without it, whenever `data` changes. Live epochs keep the same key. */
  resetKey?: string;
}

interface Bounds {
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

const PADDING = { top: 20, right: 20, bottom: 20, left: 20 };

const RING_FONT = '10px "IBM Plex Mono", monospace';
const COMPASS_FONT = '500 11px "IBM Plex Sans", sans-serif';
/** Rings closer than this would have overlapping labels. */
const MIN_RING_SPACING_PX = 40;

/**
 * Distance from the reference (the ENU origin) shown as concentric rings with
 * N/E/S/W axes. The default view is centered on the reference and fits every
 * epoch; zooming or panning redraws the rings for the visible area.
 */
export function Plot2DView({ data, height, resetKey }: Plot2DViewProps) {
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

  // Default view: a square centered on the reference, reaching the farthest
  // epoch. Equal ranges on a square plot keep the rings circular.
  const naturalBounds = useMemo((): Bounds | null => {
    if (data.length === 0) return null;
    let farthest = 0;
    for (const epoch of data) {
      const d = Math.hypot(epoch.e, epoch.n);
      if (d > farthest) farthest = d;
    }
    const half = Math.max(farthest * 1.1, 0.01);
    return { minE: -half, maxE: half, minN: -half, maxN: half };
  }, [data]);

  // Reset zoom for new data, or only for a new source when keyed
  const resetDep = resetKey ?? data;
  useEffect(() => {
    viewRef.current = null;
  }, [resetDep]);

  // Whether the reset button shows: tagged with the source it was zoomed
  // for, so a new source hides it without a state update in the effect above.
  const [zoomedFor, setZoomedFor] = useState<unknown>(null);
  const zoomed = zoomedFor !== null && zoomedFor === resetDep;

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
    const ringColor = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.3)';
    const bgColor = isDark ? '#1a1b1e' : '#ffffff';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    const { minE, maxE, minN, maxN } = viewRef.current || naturalBounds;

    const plotW = size - PADDING.left - PADDING.right;
    const plotH = size - PADDING.top - PADDING.bottom;
    const right = PADDING.left + plotW;
    const bottom = PADDING.top + plotH;

    // Coordinate transforms
    const toX = (e: number) => PADDING.left + ((e - minE) / (maxE - minE)) * plotW;
    const toY = (n: number) => PADDING.top + plotH - ((n - minN) / (maxN - minN)) * plotH;
    const ox = toX(0);
    const oy = toY(0);
    const axisEVisible = minN <= 0 && maxN >= 0;
    const axisNVisible = minE <= 0 && maxE >= 0;

    // Rings crossing the visible area
    const halfRange = (maxE - minE) / 2;
    const mPerPx = (maxE - minE) / plotW;
    let step = ringStep(halfRange / 4);
    // A wider 1/2/5 step when the labels would touch, keeping a ring in view
    while (step < MIN_RING_SPACING_PX * mPerPx && ringStep(step * 2.2) <= halfRange) {
      step = ringStep(step * 2.2);
    }
    const nearest = Math.hypot(Math.max(minE, Math.min(maxE, 0)), Math.max(minN, Math.min(maxN, 0)));
    const farthest = Math.hypot(Math.max(-minE, maxE), Math.max(-minN, maxN));
    const firstRing = Math.max(1, Math.ceil(nearest / step));
    const lastRing = Math.floor(farthest / step);

    // Rings, axes and points stay inside the plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADDING.left, PADDING.top, plotW, plotH);
    ctx.clip();

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    const pxPerM = plotW / (maxE - minE);
    for (let k = firstRing; k <= lastRing; k++) {
      ctx.beginPath();
      ctx.arc(ox, oy, k * step * pxPerM, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (axisNVisible) {
      ctx.beginPath();
      ctx.moveTo(ox, PADDING.top);
      ctx.lineTo(ox, bottom);
      ctx.stroke();
    }
    if (axisEVisible) {
      ctx.beginPath();
      ctx.moveTo(PADDING.left, oy);
      ctx.lineTo(right, oy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const epoch of data) {
      const x = toX(epoch.e);
      const y = toY(epoch.n);
      ctx.fillStyle = qualityColor(epoch.Q);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Ring labels along the east axis; when it is off-screen or the plot is
    // panned past the reference, along the bearing to the view center so
    // they stay visible.
    const onEastAxis = axisEVisible && maxE >= -minE;
    const labelBearing = onEastAxis ? 0 : Math.atan2((minN + maxN) / 2, (minE + maxE) / 2);
    ctx.fillStyle = textColor;
    ctx.font = RING_FONT;
    ctx.textAlign = 'right';
    for (let k = firstRing; k <= lastRing; k++) {
      const r = k * step;
      const x = toX(r * Math.cos(labelBearing));
      const y = toY(r * Math.sin(labelBearing));
      if (x < PADDING.left || x > right || y < PADDING.top || y > bottom) continue;
      const label = formatRing(r, step);
      // A label cut off by the canvas edge would misread ("0.015m" as "015m")
      if (x - 3 - ctx.measureText(label).width < 0) continue;
      ctx.fillText(label, x - 3, y + 11);
    }

    // Compass letters where the axes meet the plot edge
    ctx.font = COMPASS_FONT;
    ctx.textAlign = 'center';
    if (axisNVisible) {
      ctx.fillText('N', ox, PADDING.top - 6);
      ctx.fillText('S', ox, bottom + 14);
    }
    if (axisEVisible) {
      ctx.textAlign = 'left';
      ctx.fillText('E', right + 5, oy + 4);
      ctx.textAlign = 'right';
      ctx.fillText('W', PADDING.left - 5, oy + 4);
    }
  }, [data, naturalBounds, size, isDark]);

  // Draw on dependency change. Canvas text does not wait for web fonts:
  // redraw once IBM Plex has loaded, or the first draw keeps the fallback.
  useEffect(() => {
    draw();
    if (!document.fonts || document.fonts.check(RING_FONT)) return;
    let current = true;
    document.fonts.load(RING_FONT).then(() => {
      if (current) draw();
    }).catch(() => {});
    return () => {
      current = false;
    };
  }, [draw]);

  const resetView = useCallback(() => {
    viewRef.current = null;
    setZoomedFor(null);
    draw();
  }, [draw]);

  // Mouse interaction: wheel zoom, drag pan, double-click reset
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !naturalBounds) return;

    const plotW = size - PADDING.left - PADDING.right;
    const plotH = size - PADDING.top - PADDING.bottom;

    const getEffectiveBounds = (): Bounds => viewRef.current ?? naturalBounds;

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
      setZoomedFor(resetDep);
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
      setZoomedFor(resetDep);
      draw();
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        canvas.style.cursor = 'grab';
      }
    };

    const handleDblClick = resetView;

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
  }, [naturalBounds, size, draw, resetView, resetDep]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height, display: 'flex', justifyContent: 'center' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {zoomed && (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          onClick={resetView}
          title="Reset zoom"
          aria-label="Reset zoom"
          style={{ position: 'absolute', top: 4, right: 8 }}
        >
          <IconZoomReset size={14} />
        </ActionIcon>
      )}
    </div>
  );
}

/** Nearest 1/2/5 x 10^k to `rough`. */
function ringStep(rough: number): number {
  const pow = 10 ** Math.floor(Math.log10(rough));
  const m = rough / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

/** Ring radius in metres, with the decimals its step needs. */
function formatRing(r: number, step: number): string {
  const dec = Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  return `${r.toFixed(dec)}m`;
}
