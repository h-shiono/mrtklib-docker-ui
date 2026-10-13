import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ActionIcon, Box, Checkbox, Group, ScrollArea, Text, TextInput } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSearch, IconX } from '@tabler/icons-react';

const MONO = "'IBM Plex Mono', monospace";
const CONSOLE_BG = 'var(--mantine-color-dark-8, #1a1b1e)';
const TOOLBAR_H = 30;
const MARK_BG = 'rgba(250, 176, 5, 0.35)';
const MARK_CURRENT_BG = 'var(--mantine-color-yellow-5)';
const LINE_CURRENT_BG = 'rgba(76, 141, 255, 0.16)';

/** Case-insensitive [start, end) ranges of `q` (already lower-cased) in `line`. */
function findRanges(line: string, q: string): [number, number][] {
  const out: [number, number][] = [];
  const lower = line.toLowerCase();
  let i = lower.indexOf(q);
  while (i !== -1) {
    out.push([i, i + q.length]);
    i = lower.indexOf(q, i + q.length);
  }
  return out;
}

function Highlighted({ line, q, current }: { line: string; q: string; current: boolean }) {
  const ranges = findRanges(line, q);
  if (ranges.length === 0) return <>{line || ' '}</>;
  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], k) => {
    if (s > pos) parts.push(line.slice(pos, s));
    parts.push(
      <mark
        key={k}
        style={{
          backgroundColor: current ? MARK_CURRENT_BG : MARK_BG,
          color: current ? 'var(--mantine-color-dark-9)' : 'inherit',
          borderRadius: 2,
        }}
      >
        {line.slice(s, e)}
      </mark>,
    );
    pos = e;
  });
  if (pos < line.length) parts.push(line.slice(pos));
  return <>{parts}</>;
}

interface TraceLogViewProps {
  /** Lines to show (and search). */
  lines: string[];
  /** Total height, toolbar included. */
  height: number;
  /** Shown instead of the lines while `lines` is empty. */
  placeholder?: ReactNode;
  /** Wrap long lines (RT) or scroll horizontally (PP). */
  wrap?: boolean;
  /** ScrollArea viewport ref, e.g. from useFollowScroll. */
  viewportRef?: RefObject<HTMLDivElement | null>;
  onScrollPositionChange?: (pos: { x: number; y: number }) => void;
  /** Overlay inside the scroll box (e.g. JumpToLatest). */
  overlay?: ReactNode;
  /** Extra note at the right of the toolbar. */
  note?: ReactNode;
}

/**
 * Monospace log view with a search toolbar: highlight matches, step through
 * them, and optionally show only the matching lines. Search is client-side
 * over `lines`.
 *
 * With an empty query the lines render as one joined text node, as before:
 * live views (RT trace) re-render on every poll and per-line nodes are only
 * worth their cost while searching.
 *
 * Jumping to a match scrolls the viewport, so a useFollowScroll view holds
 * still (its snapshot is what is searched) until the user resumes.
 */
export function TraceLogView({
  lines,
  height,
  placeholder,
  wrap = false,
  viewportRef,
  onScrollPositionChange,
  overlay,
  note,
}: TraceLogViewProps) {
  const [query, setQuery] = useState('');
  const [matchOnly, setMatchOnly] = useState(false);
  // Selected match: an index into `matches`, valid only for the `lines` it
  // was chosen on. A live view that keeps following gets new lines every
  // poll, and the same index would then point at a different line.
  const [sel, setSel] = useState<{ lines: string[]; idx: number } | null>(null);
  const ownViewportRef = useRef<HTMLDivElement | null>(null);
  const vpRef = viewportRef ?? ownViewportRef;
  // Set before a query / filter change that switches the rendering mode, so a
  // view sitting at the bottom (following) stays there.
  const pinBottomRef = useRef(false);

  const q = query.toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) out.push(i);
    }
    return out;
  }, [lines, q]);

  const cur = sel && sel.lines === lines && sel.idx < matches.length ? sel.idx : -1;
  const currentLine = cur >= 0 ? matches[cur] : -1;

  const step = useCallback(
    (dir: 1 | -1) => {
      if (matches.length === 0) return;
      const next = cur === -1 ? (dir === 1 ? 0 : matches.length - 1) : (cur + dir + matches.length) % matches.length;
      setSel({ lines, idx: next });
    },
    [cur, lines, matches.length],
  );

  // Bring a newly selected match into view (centred), after it has rendered.
  // Keyed on the selection object, so new lines do not re-centre it.
  useEffect(() => {
    if (!sel) return;
    const vp = vpRef.current;
    const el = vp?.querySelector<HTMLElement>('[data-current]');
    if (!vp || !el) return;
    const vpRect = vp.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    vp.scrollTop += elRect.top - vpRect.top - (vp.clientHeight - elRect.height) / 2;
  }, [sel, vpRef]);

  const keepBottom = () => {
    const vp = vpRef.current;
    pinBottomRef.current = !!vp && vp.scrollHeight - vp.scrollTop - vp.clientHeight < 24;
  };
  useLayoutEffect(() => {
    const vp = vpRef.current;
    if (pinBottomRef.current && vp) vp.scrollTop = vp.scrollHeight;
    pinBottomRef.current = false;
  }, [q, matchOnly, vpRef]);

  const changeQuery = (value: string) => {
    keepBottom();
    setQuery(value);
    setSel(null);
  };

  const textStyle = {
    fontFamily: MONO,
    fontSize: '11px',
    lineHeight: 1.5,
    whiteSpace: wrap ? 'pre-wrap' : 'pre',
    wordBreak: wrap ? 'break-all' : undefined,
  } as const;

  let body: ReactNode;
  if (lines.length === 0) {
    body = (
      <Text c="dimmed" fs="italic" style={textStyle}>
        {placeholder}
      </Text>
    );
  } else if (!q) {
    body = (
      <Text c="gray.4" style={textStyle}>
        {lines.join('\n')}
      </Text>
    );
  } else {
    const shown = matchOnly ? matches : null;
    const render = (i: number) => (
      <div
        key={i}
        data-current={i === currentLine || undefined}
        style={i === currentLine ? { backgroundColor: LINE_CURRENT_BG } : undefined}
      >
        <Highlighted line={lines[i]} q={q} current={i === currentLine} />
      </div>
    );
    body = (
      <Box c="gray.4" style={textStyle}>
        {shown ? shown.map(render) : lines.map((_, i) => render(i))}
        {shown && shown.length === 0 && (
          <Text c="dimmed" fs="italic" style={textStyle}>No matching lines</Text>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <Group gap={6} wrap="nowrap" h={TOOLBAR_H} pb={4}>
        <TextInput
          size="xs"
          placeholder="Search"
          aria-label="Search lines"
          value={query}
          onChange={(e) => changeQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              changeQuery('');
            }
          }}
          leftSection={<IconSearch size={12} />}
          rightSection={
            query ? (
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                aria-label="Clear search"
                onClick={() => changeQuery('')}
              >
                <IconX size={12} />
              </ActionIcon>
            ) : null
          }
          styles={{ input: { fontFamily: MONO, fontSize: '11px' } }}
          style={{ width: 240, minWidth: 0, flexShrink: 1 }}
        />
        <Text
          size="xs"
          c={q && matches.length === 0 ? 'red.5' : 'dimmed'}
          style={{ fontFamily: MONO, fontSize: '11px', whiteSpace: 'nowrap', minWidth: 64 }}
        >
          {q ? `${cur >= 0 ? cur + 1 : '–'} / ${matches.length}` : ''}
        </Text>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          aria-label="Previous match (Shift+Enter)"
          title="Previous match (Shift+Enter)"
          disabled={matches.length === 0}
          onClick={() => step(-1)}
        >
          <IconChevronUp size={14} />
        </ActionIcon>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          aria-label="Next match (Enter)"
          title="Next match (Enter)"
          disabled={matches.length === 0}
          onClick={() => step(1)}
        >
          <IconChevronDown size={14} />
        </ActionIcon>
        <Checkbox
          size="xs"
          label="Matching lines only"
          checked={matchOnly}
          onChange={(e) => {
            keepBottom();
            setMatchOnly(e.currentTarget.checked);
          }}
          styles={{ label: { fontSize: '11px', paddingLeft: 6, whiteSpace: 'nowrap' } }}
        />
        {note && <Box style={{ flex: 1, minWidth: 0 }}>{note}</Box>}
      </Group>
      <Box pos="relative">
        <ScrollArea
          h={height - TOOLBAR_H}
          viewportRef={vpRef}
          onScrollPositionChange={onScrollPositionChange}
          styles={{ viewport: { backgroundColor: CONSOLE_BG, padding: '8px 12px' } }}
        >
          {body}
        </ScrollArea>
        {overlay}
      </Box>
    </Box>
  );
}
