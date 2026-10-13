import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Keep a Mantine ScrollArea pinned to its bottom as content is appended,
 * and hold the view still while the user has scrolled up to read.
 *
 * Scrolls instantly, not smoothly: with lines arriving every poll a smooth
 * scroll is interrupted by the next update and never reaches the bottom.
 *
 * Holding: live buffers are trimmed from the top (`slice(-N)`), so once
 * full every update shifts the text under a fixed scrollTop. While the
 * user is scrolled up, `shown` is therefore a snapshot of the content taken
 * when they left the bottom; it is released (back to live content) when
 * they scroll to the bottom again, call `resume()`, or the content is
 * cleared (an empty array: a new run).
 *
 * Pass `active` = false while the panel is hidden (display: none cannot be
 * scrolled); it scrolls again on activation.
 *
 *   const s = useFollowScroll(active, lines);
 *   <ScrollArea {...s.scrollProps}>{render(s.shown)}</ScrollArea>
 *   {s.held && <JumpToLatest onClick={s.resume} />}
 *
 * `hold()` holds without a scroll (e.g. when a search match is selected).
 */
export function useFollowScroll<T>(active: boolean, content: T) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Snapshot shown while the user is scrolled up; null = following.
  const [held, setHeld] = useState<{ value: T } | null>(null);
  const contentRef = useRef(content);
  useLayoutEffect(() => {
    contentRef.current = content;
  });

  // Cleared content (a new run) releases the hold, or the old run's snapshot
  // would hide the new one.
  if (held && Array.isArray(content) && content.length === 0) setHeld(null);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!active || !vp || held) return;
    vp.scrollTop = vp.scrollHeight;
  }, [active, content, held]);

  const onScrollPositionChange = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const atBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 24;
    // Same object while nothing changes, so scrolling does not re-render.
    setHeld((prev) => (atBottom ? null : prev ?? { value: contentRef.current }));
  }, []);

  const resume = useCallback(() => setHeld(null), []);
  // Hold explicitly (e.g. a search match was selected), whatever the scroll
  // position: near the bottom the scroll alone would keep following.
  const hold = useCallback(() => setHeld((prev) => prev ?? { value: contentRef.current }), []);

  return {
    scrollProps: { viewportRef, onScrollPositionChange },
    shown: held ? held.value : content,
    held: held !== null,
    resume,
    hold,
  };
}
