import { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  Stack,
  Group,
  Text,
  Button,
  ActionIcon,
  TextInput,
  ScrollArea,
  Menu,
  Modal,
  Badge,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconDotsVertical,
  IconDownload,
  IconTrash,
  IconCopy,
  IconPencil,
} from '@tabler/icons-react';
import type { MrtkPostConfig } from '../types/mrtkPostConfig';
import { tomlToConfig } from '../utils/tomlImport';
import { FONT_SIZE } from '../utils/typography';

interface Preset {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** Bundled read-only preset shipped in the image — cannot rename/delete. */
  read_only?: boolean;
}

interface PresetPanelProps {
  opened: boolean;
  onClose: () => void;
  mode: 'post' | 'realtime';
  currentConfig: MrtkPostConfig;
  onLoad: (config: MrtkPostConfig) => void;
}

export function PresetPanel({ opened, onClose, mode, currentConfig, onLoad }: PresetPanelProps) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveModalOpened, { open: openSaveModal, close: closeSaveModal }] = useDisclosure(false);
  const [saveName, setSaveName] = useState('');
  const [confirmLoadId, setConfirmLoadId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch(`/api/presets/${mode}`);
      if (res.ok) setPresets(await res.json());
    } catch { /* ignore */ }
  }, [mode]);

  useEffect(() => {
    if (opened) fetchPresets();
  }, [opened, fetchPresets]);

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/presets/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim(), config: currentConfig }),
      });
      if (!res.ok) throw new Error('Save failed');
      notifications.show({ title: 'Preset saved', message: `"${saveName}" saved`, color: 'green' });
      closeSaveModal();
      setSaveName('');
      fetchPresets();
    } catch (e) {
      notifications.show({ title: 'Save failed', message: e instanceof Error ? e.message : 'Error', color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (id: string) => {
    setConfirmLoadId(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/presets/${mode}/${id}`);
      if (!res.ok) throw new Error('Load failed');
      const { config, name } = await res.json();
      const mapped = tomlToConfig(config);
      onLoad(mapped);
      notifications.show({ title: 'Preset loaded', message: `"${name}" loaded`, color: 'green' });
    } catch (e) {
      notifications.show({ title: 'Load failed', message: e instanceof Error ? e.message : 'Error', color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicate = async (preset: Preset) => {
    try {
      const getRes = await fetch(`/api/presets/${mode}/${preset.id}`);
      if (!getRes.ok) throw new Error('Failed to read preset');
      const { config } = await getRes.json();
      const res = await fetch(`/api/presets/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${preset.name} copy`, config }),
      });
      if (!res.ok) throw new Error('Duplicate failed');
      fetchPresets();
    } catch (e) {
      notifications.show({ title: 'Duplicate failed', message: e instanceof Error ? e.message : 'Error', color: 'red' });
    }
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      const res = await fetch(`/api/presets/${mode}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!res.ok) throw new Error('Rename failed');
      setRenamingId(null);
      fetchPresets();
    } catch (e) {
      notifications.show({ title: 'Rename failed', message: e instanceof Error ? e.message : 'Error', color: 'red' });
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/presets/${mode}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      fetchPresets();
    } catch (e) {
      notifications.show({ title: 'Delete failed', message: e instanceof Error ? e.message : 'Error', color: 'red' });
    }
  };

  return (
    <>
      <Drawer opened={opened} onClose={onClose} position="left" size={260} title="Presets" withCloseButton>
        <Stack gap="sm" style={{ height: '100%' }}>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openSaveModal} fullWidth>
            Save current
          </Button>

          <ScrollArea style={{ flex: 1 }}>
            {presets.length === 0 ? (
              <Stack align="center" gap="xs" py="xl">
                <Text size="sm" c="dimmed" ta="center">No presets saved yet.</Text>
                <Text size="xs" c="dimmed" ta="center">Save your current configuration to reuse it later.</Text>
              </Stack>
            ) : (
              <Stack gap={4}>
                {presets.map((p) => (
                  <Group key={p.id} wrap="nowrap" gap="xs" p="xs" style={{
                    borderRadius: 4,
                    border: '1px solid var(--mantine-color-default-border)',
                  }}>
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      {renamingId === p.id ? (
                        <TextInput
                          size="xs"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.currentTarget.value)}
                          onBlur={() => handleRename(p.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRename(p.id); if (e.key === 'Escape') setRenamingId(null); }}
                          autoFocus
                        />
                      ) : (
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" fw={500} truncate>{p.name}</Text>
                          {p.read_only && (
                            <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                              Built-in
                            </Badge>
                          )}
                        </Group>
                      )}
                      <Text size="xs" c="dimmed" style={{ fontSize: FONT_SIZE.label }}>
                        {new Date(p.updated_at).toLocaleDateString()}
                      </Text>
                    </Stack>
                    <ActionIcon size="sm" variant="light" color="blue" onClick={() => setConfirmLoadId(p.id)} title="Load">
                      <IconDownload size={13} />
                    </ActionIcon>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon size="sm" variant="subtle">
                          <IconDotsVertical size={13} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {!p.read_only && (
                          <Menu.Item leftSection={<IconPencil size={13} />}
                            onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}>
                            Rename
                          </Menu.Item>
                        )}
                        <Menu.Item leftSection={<IconCopy size={13} />} onClick={() => handleDuplicate(p)}>
                          Duplicate
                        </Menu.Item>
                        {!p.read_only && (
                          <Menu.Item leftSection={<IconTrash size={13} />} color="red" onClick={() => setConfirmDeleteId(p.id)}>
                            Delete
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                ))}
              </Stack>
            )}
          </ScrollArea>
        </Stack>
      </Drawer>

      {/* Save modal */}
      <Modal opened={saveModalOpened} onClose={closeSaveModal} title="Save Preset" size="sm" zIndex={1100}>
        <Stack gap="sm">
          <TextInput
            label="Preset name"
            placeholder="e.g. RTK Baseline 10km"
            value={saveName}
            onChange={(e) => setSaveName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeSaveModal}>Cancel</Button>
            <Button onClick={handleSave} loading={loading} disabled={!saveName.trim()}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Load confirm */}
      <Modal opened={!!confirmLoadId} onClose={() => setConfirmLoadId(null)} title="Load Preset" size="sm" zIndex={1100}>
        <Stack gap="sm">
          <Text size="sm">Load preset will overwrite current settings. Continue?</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmLoadId(null)}>Cancel</Button>
            <Button onClick={() => confirmLoadId && handleLoad(confirmLoadId)} loading={loading}>Load</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete confirm */}
      <Modal opened={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} title="Delete Preset" size="sm" zIndex={1100}>
        <Stack gap="sm">
          <Text size="sm">Delete this preset? This cannot be undone.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            <Button color="red" onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
