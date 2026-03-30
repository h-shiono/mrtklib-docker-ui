import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  ActionIcon,
  UnstyledButton,
  ScrollArea,
  Button,
  Loader,
  Alert,
  SegmentedControl,
  Breadcrumbs,
  Anchor,
  Badge,
} from '@mantine/core';
import {
  IconFolder,
  IconFile,
  IconArrowUp,
  IconInfoCircle,
} from '@tabler/icons-react';
import { browseDirectory } from '../api/files';
import type { FileInfo } from '../api/files';

interface RootInfo {
  path: string;
  label: string;
  writable: boolean;
  mounted: boolean;
}

interface FileBrowserModalProps {
  opened: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  title?: string;
  fileExtensions?: string[];
  selectDirectory?: boolean;
  /** Default root: 'workspace', 'data', or 'system'. */
  defaultRoot?: 'workspace' | 'data' | 'system';
}

function formatSize(size: number | null): string {
  if (size === null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function FileBrowserModal({
  opened,
  onClose,
  onSelect,
  title = 'Select File',
  fileExtensions,
  selectDirectory = false,
  defaultRoot = 'workspace',
}: FileBrowserModalProps) {
  const [roots, setRoots] = useState<RootInfo[]>([]);
  const [rootsLoaded, setRootsLoaded] = useState(false);
  const [activeRoot, setActiveRoot] = useState<string>('/workspace');
  const [currentPath, setCurrentPath] = useState('/workspace');
  const [items, setItems] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Fetch available roots, then resolve preferred root
  useEffect(() => {
    if (!opened) return;
    setRootsLoaded(false);
    fetch('/api/files/roots')
      .then((r) => r.json())
      .then((data: RootInfo[]) => {
        setRoots(data);
        const preferred = defaultRoot === 'system' ? '/opt/mrtklib/corrections' : `/${defaultRoot}`;
        const prefRoot = data.find((r) => r.path === preferred && r.mounted);
        const resolvedRoot = prefRoot ? prefRoot.path : '/workspace';
        setActiveRoot(resolvedRoot);
        setCurrentPath(resolvedRoot);
        setRootsLoaded(true);
      })
      .catch(() => {
        setRoots([{ path: '/workspace', label: 'Workspace', writable: true, mounted: true }]);
        setActiveRoot('/workspace');
        setCurrentPath('/workspace');
        setRootsLoaded(true);
      });
  }, [opened, defaultRoot]);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    try {
      const listing = await browseDirectory(path);
      setCurrentPath(listing.path);
      let filtered = listing.items;
      if (fileExtensions && fileExtensions.length > 0 && !selectDirectory) {
        filtered = listing.items.filter(
          (item) =>
            item.type === 'directory' ||
            fileExtensions.some((ext) => item.name.toLowerCase().endsWith(ext.toLowerCase()))
        );
      }
      setItems(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse directory');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [fileExtensions, selectDirectory]);

  // Load directory only after roots are resolved
  useEffect(() => {
    if (opened && rootsLoaded && currentPath) {
      loadDirectory(currentPath);
    }
  }, [opened, rootsLoaded, currentPath, loadDirectory]);

  const handleRootChange = (root: string) => {
    setActiveRoot(root);
    setCurrentPath(root);
  };

  const handleGoUp = () => {
    // Don't go above root
    if (currentPath === activeRoot || currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length <= 1) {
      setCurrentPath(activeRoot);
    } else {
      parts.pop();
      setCurrentPath('/' + parts.join('/'));
    }
  };

  const handleItemClick = (item: FileInfo) => {
    if (item.type === 'directory' && !selectDirectory) {
      loadDirectory(item.path);
    } else {
      setSelectedPath(item.path);
    }
  };

  const handleItemDoubleClick = (item: FileInfo) => {
    if (item.type === 'directory') {
      loadDirectory(item.path);
    } else {
      onSelect(item.path);
      onClose();
    }
  };

  const handleConfirm = () => {
    if (selectedPath) {
      onSelect(selectedPath);
      onClose();
    }
  };

  // Breadcrumb segments from currentPath
  const breadcrumbSegments = (() => {
    const parts = currentPath.split('/').filter(Boolean);
    const segments: { label: string; path: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      segments.push({
        label: parts[i],
        path: '/' + parts.slice(0, i + 1).join('/'),
      });
    }
    return segments;
  })();

  // Root selector data (only show mounted roots)
  const rootOptions = roots
    .filter((r) => r.mounted)
    .map((r) => ({ value: r.path, label: r.label }));

  const isReadOnly = roots.find((r) => r.path === activeRoot)?.writable === false;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size="md"
      zIndex={1100}
      styles={{ title: { fontSize: '14px', fontWeight: 600 } }}
    >
      <Stack gap="xs">
        {/* Root selector */}
        {rootOptions.length > 1 && (
          <SegmentedControl
            size="xs"
            value={activeRoot}
            onChange={handleRootChange}
            data={rootOptions}
            fullWidth
          />
        )}

        {/* Breadcrumb navigation */}
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="light"
            size="sm"
            onClick={handleGoUp}
            disabled={currentPath === activeRoot}
            title="Go up"
          >
            <IconArrowUp size={14} />
          </ActionIcon>
          <Breadcrumbs separator="/" styles={{ separator: { fontSize: '11px', color: 'var(--mantine-color-dimmed)' } }}>
            {breadcrumbSegments.map((seg, i) => (
              i < breadcrumbSegments.length - 1 ? (
                <Anchor
                  key={seg.path}
                  size="xs"
                  onClick={() => loadDirectory(seg.path)}
                  style={{ fontFamily: 'var(--mantine-font-family-monospace)', fontSize: '11px' }}
                >
                  {seg.label}
                </Anchor>
              ) : (
                <Text key={seg.path} size="xs" fw={500} style={{ fontFamily: 'var(--mantine-font-family-monospace)', fontSize: '11px' }}>
                  {seg.label}
                </Text>
              )
            ))}
          </Breadcrumbs>
          {isReadOnly && <Badge variant="outline" size="xs" color="gray">read-only</Badge>}
        </Group>

        {error && (
          <Alert color="red" icon={<IconInfoCircle size={14} />} p="xs">
            <Text size="xs">{error}</Text>
          </Alert>
        )}

        {/* File listing */}
        <ScrollArea h={300} type="auto" offsetScrollbars>
          {loading ? (
            <Stack align="center" py="xl">
              <Loader size="sm" />
            </Stack>
          ) : items.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="xl">
              Empty directory
            </Text>
          ) : (
            <Stack gap={2}>
              {items.map((item) => (
                <UnstyledButton
                  key={item.path}
                  onClick={() => handleItemClick(item)}
                  onDoubleClick={() => handleItemDoubleClick(item)}
                  px="xs"
                  py={4}
                  style={(theme) => ({
                    borderRadius: theme.radius.sm,
                    backgroundColor:
                      selectedPath === item.path
                        ? 'var(--mantine-color-blue-light)'
                        : undefined,
                    '&:hover': {
                      backgroundColor: 'var(--mantine-color-gray-light-hover)',
                    },
                  })}
                >
                  <Group gap="xs" wrap="nowrap" justify="space-between">
                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                      {item.type === 'directory' ? (
                        <IconFolder size={16} color="var(--mantine-color-yellow-6)" />
                      ) : (
                        <IconFile size={16} color="var(--mantine-color-gray-6)" />
                      )}
                      <Text size="xs" truncate style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>
                        {item.name}
                      </Text>
                    </Group>
                    {item.type === 'file' && item.size !== null && (
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                        {formatSize(item.size)}
                      </Text>
                    )}
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          )}
        </ScrollArea>

        {/* Selected file display + confirm */}
        <Group gap="xs" justify="space-between">
          <Text size="xs" c="dimmed" truncate style={{ flex: 1, fontFamily: 'var(--mantine-font-family-monospace)' }}>
            {selectedPath || 'Double-click to select, or click and confirm'}
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button size="xs" onClick={handleConfirm} disabled={!selectedPath}>
              Select
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
