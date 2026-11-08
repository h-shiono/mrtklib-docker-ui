import { useState, useEffect } from 'react';
import { Stack, Text, Loader } from '@mantine/core';
import { readFile } from '../../api/files';
import { parsePosFile } from './posParser';
import { PositionViewer } from './PositionViewer';
import type { PosEpoch, ReferencePosition } from './types';

/** A solution file (.pos / NMEA) in the position views. */
interface ResultViewerProps {
  filePath: string | null;
  maxHeight: number;
  refreshKey?: number;
}

const NO_EPOCHS: PosEpoch[] = [];

interface LoadResult {
  key: string;
  epochs: PosEpoch[];
  headerRefPos: ReferencePosition | null;
  error: string | null;
  notice: string | null;
  timeSystem: string;
}

export function ResultViewer({
  filePath,
  maxHeight,
  refreshKey = 0,
}: ResultViewerProps) {
  // The last load result, tagged with the file/refresh it belongs to. Values
  // are derived during render (no synchronous setState in the load effect):
  // a result for another key means "loading".
  const loadKey = filePath ? `${filePath}\0${refreshKey}` : '';
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  const current = filePath && loaded?.key === loadKey ? loaded : null;
  const loading = !!filePath && !current;
  const epochs = current?.epochs ?? NO_EPOCHS;
  const headerRefPos = current?.headerRefPos ?? null;
  const error = current?.error ?? null;
  const notice = current?.notice ?? null;
  const timeSystem = current?.timeSystem ?? 'GPST';

  // Load .pos file
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    const key = `${filePath}\0${refreshKey}`;

    readFile(filePath, 50000)
      .then((res) => {
        if (cancelled) return;
        const parsed = parsePosFile(res.content, filePath);
        setLoaded({
          key,
          epochs: parsed.epochs,
          headerRefPos: parsed.headerRefPos,
          error: parsed.epochs.length === 0 ? 'No position data found in file' : null,
          notice: [
            res.truncated
              ? `Showing the first ${res.returned_lines.toLocaleString()} of ${res.total_lines.toLocaleString()} lines`
              : null,
            parsed.notice,
          ].filter(Boolean).join(' · ') || null,
          timeSystem: parsed.timeSystem,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoaded({
          key,
          epochs: NO_EPOCHS,
          headerRefPos: null,
          error: err instanceof Error ? err.message : 'Failed to load file',
          notice: null,
          timeSystem: 'GPST',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, refreshKey]);

  // Placeholder states
  if (!filePath) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          No result file to display
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Loader size="sm" color="gray" />
        <Text size="xs" c="dimmed">Loading position data...</Text>
      </Stack>
    );
  }

  if (error && epochs.length === 0) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          {error}
        </Text>
      </Stack>
    );
  }

  return (
    <PositionViewer
      epochs={epochs}
      dataKey={loadKey}
      maxHeight={maxHeight}
      timeSystem={timeSystem}
      headerRefPos={headerRefPos}
      notice={notice}
    />
  );
}
