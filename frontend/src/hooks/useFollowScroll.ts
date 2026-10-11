import { useCallback, useEffect, useRef } from 'react';

/**
 * Keep a Mantine ScrollArea pinned to its bottom as content is appended.
 *
 * Scrolls instantly, not smoothly: with lines arriving every poll a smooth
 * scroll is interrupted by the next update and never reaches the bottom.
 * Following pauses while the user has scrolled up to read and resumes once
 * they scroll back to the bottom. Pass `active` = false while the panel is
 * hidden (display: none cannot be scrolled); it scrolls again on activation.
 *
 * Spread the result onto the ScrollArea:
 *   <ScrollArea {...useFollowScroll(active, lines)}>
 */
export function useFollowScroll(active: boolean, content: unknown) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!active || !vp || !followRef.current) return;
    vp.scrollTop = vp.scrollHeight;
  }, [active, content]);

  const onScrollPositionChange = useCallback(() => {
    const vp = viewportRef.current;
    if (vp) followRef.current = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 24;
  }, []);

  return { viewportRef, onScrollPositionChange };
}
