import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Group,
  Text,
  PasswordInput,
  Select,
  Button,
  Alert,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconAlertTriangle, IconPlugConnected } from '@tabler/icons-react';

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];

export function AiSettingsPanel() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-5');
  const [configured, setConfigured] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Load current settings on mount
  useEffect(() => {
    fetch('/api/ai/settings')
      .then((r) => r.json())
      .then((data) => {
        setConfigured(data.configured);
        if (data.model) setModel(data.model);
      })
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) {
      notifications.show({ title: 'Error', message: 'API key is required', color: 'red' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim(), model }),
      });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      setConfigured(data.configured);
      setTestResult(null);
      notifications.show({ title: 'Saved', message: 'AI settings saved', color: 'green' });
    } catch {
      notifications.show({ title: 'Error', message: 'Failed to save settings', color: 'red' });
    } finally {
      setSaving(false);
    }
  }, [apiKey, model]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/test', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: 'Request failed' });
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <Stack gap="lg" style={{ maxWidth: 560 }}>
      <Text size="lg" fw={600}>AI Settings</Text>

      {/* API Key + Model */}
      <Stack gap="sm">
        <Text size="xs" fw={600} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Anthropic API
        </Text>

        <Group justify="space-between" align="flex-end" mb={6}>
          <Text size="sm" c="dimmed" style={{ width: 130, flexShrink: 0 }}>API Key</Text>
          <Box style={{ flex: 1 }}>
            <PasswordInput
              size="xs"
              placeholder={configured ? '(configured — enter new key to update)' : 'sk-ant-...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}
            />
          </Box>
        </Group>

        <Group justify="space-between" align="center" mb={6}>
          <Text size="sm" c="dimmed" style={{ width: 130, flexShrink: 0 }}>Model</Text>
          <Box style={{ flex: 1 }}>
            <Select
              size="xs"
              data={MODEL_OPTIONS}
              value={model}
              onChange={(v) => v && setModel(v)}
            />
          </Box>
        </Group>

        <Group gap="xs">
          <Button size="xs" onClick={handleSave} loading={saving}>
            Save
          </Button>
          <Button size="xs" variant="light" onClick={handleTest} loading={testing} disabled={!configured}>
            <IconPlugConnected size={14} style={{ marginRight: 4 }} />
            Test connection
          </Button>
        </Group>

        {testResult && (
          <Alert
            color={testResult.ok ? 'green' : 'red'}
            icon={testResult.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}
            variant="light"
            p="xs"
          >
            {testResult.ok ? 'Connected' : `Invalid key: ${testResult.error}`}
          </Alert>
        )}
      </Stack>

      {/* Info */}
      <Text size="xs" c="dimmed">
        Stored in <code>/workspace/.ai_settings.toml</code><br />
        Never sent to any server other than api.anthropic.com
      </Text>
    </Stack>
  );
}
