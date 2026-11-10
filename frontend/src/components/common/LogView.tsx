import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Box, Checkbox, Group, ScrollArea, Text, TextInput, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconCopy, IconSearch, IconX } from '@tabler/icons-react';
import { useFollowScroll } from '../../hooks/useFollowScroll';
import { logSeverity } from '../../utils/logSeverity';
import { maskLogLine } from '../../utils/maskPath';
import { STATUS_COLOR } from '../../utils/status';
import { FONT_SIZE, MONO } from '../../utils/typography';
import { JumpToLatest } from './JumpToLatest';

const CONSOLE_BG = 'var(--app-console-bg)';
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

/** One occurrence of the query: its line and start offset. */
interface Match {
  line: number;
  start: number;
}

/** `line` with every occurrence of `q` marked; the one starting at
 *  `currentStart` (if any) is the selected match. */
function Highlighted({ line, q, currentStart }: { line: string; q: string; currentStart: number }) {
  const ranges = findRanges(line, q);
  if (ranges.length === 0) return <>{line || ' '}</>;
  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], k) => {
    if (s > pos) parts.push(line.slice(pos, s));
    const current = s === currentStart;
    parts.push(
      <mark
        key={k}
        data-current={current || undefined}
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

interface LogViewProps {
  /** Lines to show and search. Masked here, so no caller can forget it. */
  lines: string[];
  /** Total height, toolbar included. Omit to fill a parent with a definite height. */
  height?: number;
  /** The panel is visible: following needs a layout to scroll. */
  active?: boolean;
  /** Live lines: offer "Jump to latest" while scrolled up. */
  live?: boolean;
  wrap?: boolean;
  /** Offer a Wrap checkbox, starting from `wrap`. */
  wrapToggle?: boolean;
  /** Colour [ERROR] and [WARN] lines. */
  severity?: boolean;
  /** The process is running, for the empty message. */
  running?: boolean;
  /** The button that starts it, for the empty message. */
  startLabel?: string;
  /** Replaces the empty message. */
  emptyText?: string;
  /** Lines the buffer keeps; says so once it is full. */
  cap?: number;
  /** After the search controls, e.g. the file being shown. */
  note?: ReactNode;
  /** Before Copy, e.g. a download button. */
  actions?: ReactNode;
}

/**
 * The one log view: Console, Solution and Trace on every screen. A search
 * toolbar over monospace lines that follow the end as they arrive.
 *
 * Without a search or severity colours the lines render as one joined text
 * node: live views re-render on every poll and per-line nodes are only worth
 * their cost when something differs per line.
 *
 * Selecting a match holds the view, so new lines cannot replace the lines the
 * selection is on, until the user resumes.
 */
export function LogView({
  lines: rawLines,
  height,
  active = true,
  live = true,
  wrap: wrapDefault = false,
  wrapToggle = false,
  severity = false,
  running = false,
  startLabel = 'Start',
  emptyText,
  cap,
  note,
  actions,
}: LogViewProps) {
  const masked = useMemo(() => rawLines.map(maskLogLine), [rawLines]);
  const { scrollProps, shown: lines, held, resume, hold: onMatchSelect } = useFollowScroll(active, masked);
  const { viewportRef: vpRef, onScrollPositionChange } = scrollProps;
  const [wrap, setWrap] = useState(wrapDefault);
  const [query, setQuery] = useState('');
  const [matchOnly, setMatchOnly] = useState(false);
  // Selected occurrence: an index into `matches`, valid only for the `lines` it
  // was chosen on. A live view that keeps following gets new lines every
  // poll, and the same index would then point at a different line.
  const [sel, setSel] = useState<{ lines: string[]; idx: number } | null>(null);
  // Set before a query / filter change that switches the rendering mode, so a
  // view sitting at the bottom (following) stays there.
  const pinBottomRef = useRef(false);

  const q = query.toLowerCase();
  // Every occurrence (a line may hold several), for the counter and stepping
  const matches = useMemo(() => {
    const out: Match[] = [];
    if (!q) return out;
    for (let i = 0; i < lines.length; i++) {
      for (const [start] of findRanges(lines[i], q)) out.push({ line: i, start });
    }
    return out;
  }, [lines, q]);
  // Lines holding at least one occurrence, for "Matching lines only"
  const matchLines = useMemo(() => {
    const out: number[] = [];
    for (const m of matches) if (out[out.length - 1] !== m.line) out.push(m.line);
    return out;
  }, [matches]);

  const cur = sel && sel.lines === lines && sel.idx < matches.length ? sel.idx : -1;
  const current = cur >= 0 ? matches[cur] : null;
  const currentLine = current ? current.line : -1;

  const step = useCallback(
    (dir: 1 | -1) => {
      if (matches.length === 0) return;
      const next = cur === -1 ? (dir === 1 ? 0 : matches.length - 1) : (cur + dir + matches.length) % matches.length;
      setSel({ lines, idx: next });
      onMatchSelect?.();
    },
    [cur, lines, matches.length, onMatchSelect],
  );

  // Bring the selected match into view (centred) after it has rendered: on a
  // new selection, and after the filter toggle reflows the lines. Not keyed on
  // the lines, so new lines while following do not re-centre it.
  useEffect(() => {
    if (!sel) return;
    const vp = vpRef.current;
    const el = vp?.querySelector<HTMLElement>('mark[data-current]');
    if (!vp || !el) return;
    const vpRect = vp.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    vp.scrollTop += elRect.top - vpRect.top - (vp.clientHeight - elRect.height) / 2;
    // Unwrapped lines (PP) can put the match off to the side
    if (!wrap) vp.scrollLeft += elRect.left - vpRect.left - (vp.clientWidth - elRect.width) / 2;
  }, [sel, matchOnly, wrap, vpRef]);

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
    fontSize: FONT_SIZE.label,
    lineHeight: 1.5,
    whiteSpace: wrap ? 'pre-wrap' : 'pre',
    wordBreak: wrap ? 'break-all' : undefined,
  } as const;

  const perLine = !!q || severity;
  const renderLine = (i: number) => {
    const level = severity ? logSeverity(lines[i]) : null;
    return (
      <div
        key={i}
        style={{
          backgroundColor: i === currentLine ? LINE_CURRENT_BG : undefined,
          color: level === 'error' ? STATUS_COLOR.error : level === 'warn' ? STATUS_COLOR.warn : undefined,
          // Pulled out by its own width, so the text stays in line with the others.
          ...(level === 'error' ? { borderLeft: '2px solid currentColor', marginLeft: -8, paddingLeft: 6 } : null),
        }}
      >
        {q
          ? <Highlighted line={lines[i]} q={q} currentStart={i === currentLine && current ? current.start : -1} />
          : lines[i] || ' '}
      </div>
    );
  };

  let body: ReactNode;
  if (lines.length === 0) {
    body = (
      <Text c="dimmed" style={textStyle}>
        {emptyText ?? (running ? 'Waiting for output…' : `No output yet. Press ${startLabel}.`)}
      </Text>
    );
  } else if (!perLine) {
    body = (
      <Text c="var(--app-console-fg)" style={textStyle}>
        {lines.join('\n')}
      </Text>
    );
  } else {
    const shown = q && matchOnly ? matchLines : null;
    body = (
      <Box c="var(--app-console-fg)" style={textStyle}>
        {shown ? shown.map(renderLine) : lines.map((_, i) => renderLine(i))}
        {shown && shown.length === 0 && <Text c="dimmed" style={textStyle}>No matching lines</Text>}
      </Box>
    );
  }

  return (
    <Box style={{ height: height ?? '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Group gap={6} wrap="nowrap" h={TOOLBAR_H} pb={4} style={{ flexShrink: 0 }}>
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
          // Input sections ignore pointer events by default; the clear button needs them
          rightSectionPointerEvents="all"
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
          styles={{ input: { fontFamily: MONO } }}
          style={{ width: 180, minWidth: 80, flexShrink: 1 }}
        />
        <Text
          size="xs"
          c={q && matches.length === 0 ? STATUS_COLOR.error : 'dimmed'}
          style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, whiteSpace: 'nowrap', minWidth: 48 }}
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
          styles={{ label: { fontSize: FONT_SIZE.label, paddingLeft: 6, whiteSpace: 'nowrap' } }}
        />
        {wrapToggle && (
          <Checkbox
            size="xs"
            label="Wrap"
            checked={wrap}
            onChange={(e) => setWrap(e.currentTarget.checked)}
            styles={{ label: { fontSize: FONT_SIZE.label, paddingLeft: 6 } }}
          />
        )}
        <Box style={{ flex: 1, minWidth: 0 }}>{note}</Box>
        {cap !== undefined && rawLines.length >= cap && (
          <Text c="dimmed" style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, whiteSpace: 'nowrap' }}>
            last {cap} lines
          </Text>
        )}
        {actions}
        <Tooltip label="Copy">
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            aria-label="Copy"
            disabled={lines.length === 0}
            onClick={() => void navigator.clipboard.writeText(lines.join('\n'))}
          >
            <IconCopy size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box pos="relative" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea
          h="100%"
          viewportRef={vpRef}
          onScrollPositionChange={onScrollPositionChange}
          styles={{ viewport: { backgroundColor: CONSOLE_BG, padding: '8px 12px' } }}
        >
          {body}
        </ScrollArea>
        {live && held && <JumpToLatest onClick={resume} />}
      </Box>
    </Box>
  );
}
