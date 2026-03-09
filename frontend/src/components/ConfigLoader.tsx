import { useState } from 'react';
import {
  Card,
  Stack,
  Title,
  Group,
  Select,
  Button,
  FileButton,
  Text,
} from '@mantine/core';
import { IconUpload, IconDownload, IconFile } from '@tabler/icons-react';

interface ConfigLoaderProps {
  onConfigLoad?: (config: Record<string, unknown>) => void;
  onConfigExport?: () => void;
}

// Sample preset configurations
const presetConfigs = [
  { value: 'default', label: 'Default Settings' },
  { value: 'kinematic', label: 'Kinematic (High Rate)' },
  { value: 'static', label: 'Static Survey' },
  { value: 'ppp', label: 'PPP Mode' },
];

export function ConfigLoader({ onConfigLoad, onConfigExport }: ConfigLoaderProps) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [loadedFile, setLoadedFile] = useState<File | null>(null);

  const handleFileLoad = (file: File | null) => {
    if (!file) return;
    setLoadedFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      // Parse config file (simple key=value format)
      const config: Record<string, unknown> = {};
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            config[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
      onConfigLoad?.(config);
    };
    reader.readAsText(file);
  };

  const handlePresetChange = (value: string | null) => {
    setSelectedPreset(value);
    setLoadedFile(null);
    // In a real app, this would load the preset configuration
    if (value) {
      onConfigLoad?.({ preset: value });
    }
  };

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Title order={6}>Configuration</Title>

        <Select
          label="Load Preset"
          placeholder="Select a preset..."
          data={presetConfigs}
          value={selectedPreset}
          onChange={handlePresetChange}
          clearable
        />

        <Group grow>
          <FileButton onChange={handleFileLoad} accept=".conf,.txt">
            {(props) => (
              <Button
                variant="light"
                leftSection={<IconUpload size={16} />}
                {...props}
              >
                Import
              </Button>
            )}
          </FileButton>

          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={onConfigExport}
          >
            Export
          </Button>
        </Group>

        {loadedFile && (
          <Group gap="xs">
            <IconFile size={14} />
            <Text size="xs" c="dimmed" truncate>
              {loadedFile.name}
            </Text>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
