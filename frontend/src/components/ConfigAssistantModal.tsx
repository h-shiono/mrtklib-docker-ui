import { useState, useCallback } from 'react';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  Button,
  Group,
  Alert,
  ScrollArea,
  Code,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSparkles, IconAlertTriangle } from '@tabler/icons-react';
import { tomlToConfig } from '../utils/tomlImport';
import type { MrtkPostConfig } from '../types/mrtkPostConfig';

type ModalState = 'idle' | 'loading' | 'result' | 'error';

interface ConfigAssistantModalProps {
  opened: boolean;
  onClose: () => void;
  mode: 'post' | 'realtime';
  onApply: (config: Partial<MrtkPostConfig>) => void;
}

const EXAMPLE_PROMPTS = [
  'u-blox F9PでNTRIPからCLASを使ったリアルタイム測位',
  'MADOCA-PPPで後処理、GPS+Galileo+QZSS',
  '静止観測でRTK、基線長1km以内',
];

export function ConfigAssistantModal({ opened, onClose, mode, onApply }: ConfigAssistantModalProps) {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<ModalState>('idle');
  const [generatedToml, setGeneratedToml] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setState('loading');
    setGeneratedToml('');
    setErrorMsg('');

    try {
      const res = await fetch('/api/ai/generate-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Generation failed' }));
        throw new Error(err.detail || 'Generation failed');
      }
      const data = await res.json();
      setGeneratedToml(data.toml);
      setState('result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
      setState('error');
    }
  }, [prompt, mode]);

  const handleApply = useCallback(async () => {
    try {
      const res = await fetch('/api/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toml_content: generatedToml }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Import failed' }));
        throw new Error(err.detail || 'Import failed');
      }
      const { config: parsed } = await res.json();
      const mapped = tomlToConfig(parsed);
      onApply(mapped);
      notifications.show({
        title: 'Configuration applied',
        message: 'Please review all settings.',
        color: 'green',
      });
      // Reset and close
      setPrompt('');
      setState('idle');
      setGeneratedToml('');
      setErrorMsg('');
      onClose();
    } catch (e) {
      notifications.show({
        title: 'Apply failed',
        message: e instanceof Error ? e.message : 'Unknown error',
        color: 'red',
      });
    }
  }, [generatedToml, onApply, onClose]);

  const handleClose = useCallback(() => {
    setPrompt('');
    setState('idle');
    setGeneratedToml('');
    setErrorMsg('');
    onClose();
  }, [onClose]);

  return (
    <Modal opened={opened} onClose={handleClose} title="Config Assistant" size="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            どのような測位をしたいか説明してください
          </Text>
          <Text size="xs" c="dimmed">
            Describe your positioning scenario in any language
          </Text>
        </Stack>

        <Textarea
          autoFocus
          rows={4}
          placeholder="e.g., RTK kinematic positioning with GPS+GLONASS, base station within 5km..."
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          disabled={state === 'loading'}
        />

        <Stack gap={4}>
          <Text size="xs" c="dimmed">Example prompts:</Text>
          {EXAMPLE_PROMPTS.map((ex) => (
            <UnstyledButton
              key={ex}
              onClick={() => setPrompt(ex)}
              style={{ fontSize: '12px', color: 'var(--mantine-color-dimmed)', textAlign: 'left' }}
            >
              &bull; &quot;{ex}&quot;
            </UnstyledButton>
          ))}
        </Stack>

        <Button
          leftSection={<IconSparkles size={14} />}
          onClick={handleGenerate}
          loading={state === 'loading'}
          disabled={!prompt.trim()}
        >
          Generate
        </Button>

        {state === 'error' && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} variant="light">
            {errorMsg}
          </Alert>
        )}

        {(state === 'result') && (
          <>
            <Text size="xs" fw={600} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Generated configuration
            </Text>

            <ScrollArea h={300} style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-sm)' }}>
              <Code
                block
                style={{
                  fontFamily: 'var(--mantine-font-family-monospace)',
                  fontSize: '12px',
                  whiteSpace: 'pre',
                  background: 'transparent',
                }}
              >
                {generatedToml}
              </Code>
            </ScrollArea>

            <Alert color="yellow" icon={<IconAlertTriangle size={16} />} variant="light" p="xs">
              <Text size="xs">
                Always review before applying. AI-generated configs may need manual adjustment.
              </Text>
            </Alert>

            <Group justify="flex-end" gap="xs">
              <Button variant="default" size="xs" onClick={handleClose}>
                Cancel
              </Button>
              <Button size="xs" onClick={handleApply}>
                Apply to form
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
