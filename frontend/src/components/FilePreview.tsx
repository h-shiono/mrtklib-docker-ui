import { useState, useEffect } from 'react';
import { ScrollArea, Code, Text, Loader, Stack, Badge, Group } from '@mantine/core';
import { readFile } from '../api/files';

interface FilePreviewProps {
  filePath: string | null;
  maxHeight?: number;
  refreshKey?: number;
  disabledMessage?: string;
}

export function FilePreview({
  filePath,
  maxHeight = 400,
  refreshKey = 0,
  disabledMessage,
}: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    totalLines: number;
    returnedLines: number;
    truncated: boolean;
    fileSize: number;
  } | null>(null);

  useEffect(() => {
    if (!filePath || disabledMessage) {
      setContent(null);
      setMeta(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    readFile(filePath)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setMeta({
          totalLines: res.total_lines,
          returnedLines: res.returned_lines,
          truncated: res.truncated,
          fileSize: res.file_size,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setContent(null);
        setMeta(null);
        setError(err instanceof Error ? err.message : 'Failed to load file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, refreshKey, disabledMessage]);

  if (disabledMessage) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          {disabledMessage}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Loader size="sm" color="gray" />
        <Text size="xs" c="dimmed">Loading file...</Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          {error}
        </Text>
      </Stack>
    );
  }

  if (content === null) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          No file to preview
        </Text>
      </Stack>
    );
  }

  return (
    <>
      {meta && (
        <Group gap="xs" px="sm" py={4}>
          <Badge size="xs" variant="light" color="gray">
            {meta.totalLines.toLocaleString()} lines
          </Badge>
          <Badge size="xs" variant="light" color="gray">
            {(meta.fileSize / 1024).toFixed(1)} KB
          </Badge>
          {meta.truncated && (
            <Badge size="xs" variant="light" color="yellow">
              Truncated (showing {meta.returnedLines.toLocaleString()})
            </Badge>
          )}
        </Group>
      )}
      <ScrollArea h={maxHeight - (meta ? 28 : 0)} p="sm">
        <Code
          block
          style={{
            backgroundColor: 'transparent',
            color: 'var(--mantine-color-gray-4)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontSize: '12px',
            lineHeight: 1.6,
          }}
        >
          {content}
        </Code>
      </ScrollArea>
    </>
  );
}
