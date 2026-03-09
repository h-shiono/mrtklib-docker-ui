import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  ActionIcon,
  UnstyledButton,
  ScrollArea,
  TextInput,
  Button,
  Loader,
  Alert,
} from '@mantine/core';
import {
  IconFolder,
  IconFile,
  IconArrowUp,
  IconInfoCircle,
} from '@tabler/icons-react';
import { browseDirectory } from '../api/files';
import type { FileInfo } from '../api/files';

interface FileBrowserModalProps {
  opened: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  title?: string;
  /** Filter to show only specific file types. If not set, all files are shown. */
  fileExtensions?: string[];
  /** If true, allows selecting directories instead of files */
  selectDirectory?: boolean;
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
}: FileBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

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

  useEffect(() => {
    if (opened) {
      loadDirectory(currentPath);
    }
  }, [opened]);

  const handleNavigate = (path: string) => {
    loadDirectory(path);
  };

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parent);
  };

  const handleItemClick = (item: FileInfo) => {
    if (item.type === 'directory' && !selectDirectory) {
      handleNavigate(item.path);
    } else if (item.type === 'directory' && selectDirectory) {
      setSelectedPath(item.path);
    } else {
      setSelectedPath(item.path);
    }
  };

  const handleItemDoubleClick = (item: FileInfo) => {
    if (item.type === 'directory') {
      handleNavigate(item.path);
    } else {
      onSelect(`/workspace${item.path}`);
      onClose();
    }
  };

  const handleConfirm = () => {
    if (selectedPath) {
      onSelect(`/workspace${selectedPath}`);
      onClose();
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size="md"
      styles={{
        title: { fontSize: '14px', fontWeight: 600 },
      }}
    >
      <Stack gap="xs">
        {/* Current path + navigation */}
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="light"
            size="sm"
            onClick={handleGoUp}
            disabled={currentPath === '/' || currentPath === ''}
            title="Go up"
          >
            <IconArrowUp size={14} />
          </ActionIcon>
          <TextInput
            size="xs"
            value={`/workspace${currentPath === '/' ? '' : currentPath}`}
            readOnly
            style={{ flex: 1 }}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: '11px' } }}
          />
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
          <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
            {selectedPath
              ? `/workspace${selectedPath}`
              : 'Double-click to select, or click and confirm'}
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
