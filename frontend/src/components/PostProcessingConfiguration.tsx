import { useEffect, useRef, useCallback } from 'react';
import { useLocalStorage, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  Card,
  Stack,
  Title,
  Group,
  Button,
  ActionIcon,
  Tooltip,
  Badge,
} from '@mantine/core';
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconDownload,
  IconCode,
  IconUpload,
  IconBookmark,
  IconSparkles,
} from '@tabler/icons-react';
import type { MrtkPostConfig } from '../types/mrtkPostConfig';
import { DEFAULT_MRTK_POST_CONFIG } from '../types/mrtkPostConfig';
import { ProcessingConfigPanel, TomlDrawer } from './ProcessingConfigTabs';
import { PresetPanel } from './PresetPanel';
import { ConfigAssistantModal } from './ConfigAssistantModal';
import { tomlToConfig } from '../utils/tomlImport';

interface PostProcessingConfigurationProps {
  onConfigChange: (config: MrtkPostConfig) => void;
  onNavigateToAiSettings?: () => void;
  aiConfigured?: boolean;
  // Execution tab props
  roverFile: string;
  onRoverFileChange: (v: string) => void;
  baseFile: string;
  onBaseFileChange: (v: string) => void;
  navFile: string;
  onNavFileChange: (v: string) => void;
  correctionFiles: string[];
  onCorrectionFilesChange: (v: string[]) => void;
  outputFile: string;
  onOutputFileChange: (v: string) => void;
  needsBase: boolean;
  processStatus: string;
  isLoading: boolean;
  onExecute: () => void;
  onStop: () => void;
  onExportConf: () => void;
  onQcPreview: () => void;
  roverFileValid: boolean;
}

export function PostProcessingConfiguration({
  onConfigChange,
  onNavigateToAiSettings,
  aiConfigured,
  roverFile,
  onRoverFileChange,
  baseFile,
  onBaseFileChange,
  navFile,
  onNavFileChange,
  correctionFiles,
  onCorrectionFilesChange,
  outputFile,
  onOutputFileChange,
  needsBase,
  processStatus,
  isLoading,
  onExecute,
  onStop,
  onExportConf,
  onQcPreview,
  roverFileValid,
}: PostProcessingConfigurationProps) {
  const [config, setConfig] = useLocalStorage<MrtkPostConfig>({
    key: 'mrtklib-web-ui-mrtk-post-config-v19',
    defaultValue: DEFAULT_MRTK_POST_CONFIG,
  });

  // Sync config to parent whenever it changes, including initial localStorage load.
  useEffect(() => {
    onConfigChange(config);
  }, [config, onConfigChange]);

  const handleConfigChange = (newConfig: MrtkPostConfig) => {
    setConfig(newConfig);
  };

  const [tomlOpened, { open: openToml, close: closeToml }] = useDisclosure(false);
  const [presetsOpened, { open: openPresets, close: closePresets }] = useDisclosure(false);
  const [assistantOpened, { open: openAssistant, close: closeAssistant }] = useDisclosure(false);

  // Ref to allow auto-focusing sidebar section on validation error
  const activeSectionRef = useRef<((section: string) => void) | null>(null);

  // TOML import
  const importFileRef = useRef<HTMLInputElement>(null);
  const handleImportToml = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const res = await fetch('/api/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toml_content: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Import failed' }));
        throw new Error(err.detail || 'Import failed');
      }
      const { config: parsed } = await res.json();
      const mapped = tomlToConfig(parsed);
      setConfig((prev) => ({ ...prev, ...mapped } as MrtkPostConfig));
      notifications.show({ title: 'Import successful', message: `Loaded ${file.name}`, color: 'green' });
    } catch (e) {
      notifications.show({ title: 'Import failed', message: e instanceof Error ? e.message : 'Unknown error', color: 'red' });
    }
  }, [setConfig]);

  const handleExecute = useCallback(() => {
    if (!roverFile || !navFile || !outputFile) {
      activeSectionRef.current?.('input-files');
      notifications.show({
        title: 'Missing required files',
        message: 'Please fill in required input files (Rover OBS, Navigation, Output).',
        color: 'red',
      });
      return;
    }
    onExecute();
  }, [roverFile, navFile, outputFile, onExecute]);

  return (
    <>
    <Card withBorder p="xs">
      <Stack gap={4}>
        {/* Header: title + status + buttons */}
        <Group justify="space-between">
          <Title order={6} size="xs">Processing Configuration</Title>
          <Group gap="xs">
            {processStatus !== 'idle' && (
              <Badge color={processStatus === 'running' ? 'green' : processStatus === 'success' ? 'blue' : 'red'} variant="dot" size="sm">
                {processStatus}
              </Badge>
            )}
            {processStatus === 'running' ? (
              <Button size="xs" color="red" leftSection={<IconPlayerStop size={12} />} onClick={onStop} loading={isLoading}>
                Stop
              </Button>
            ) : (
              <Button size="xs" color="green" leftSection={<IconPlayerPlay size={12} />} onClick={handleExecute} loading={isLoading}>
                Execute
              </Button>
            )}
            <Tooltip label="Presets">
              <ActionIcon variant="light" color="gray" size="lg" onClick={openPresets}>
                <IconBookmark size={16} />
              </ActionIcon>
            </Tooltip>
            {aiConfigured ? (
              <Tooltip label="Config Assistant">
                <ActionIcon variant="light" color="yellow" size="lg" onClick={openAssistant}>
                  <IconSparkles size={16} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label="Configure API key in Tools → AI Settings">
                <ActionIcon variant="light" color="gray" size="lg" onClick={onNavigateToAiSettings}>
                  <IconSparkles size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Import TOML">
              <ActionIcon variant="light" color="gray" size="lg" onClick={() => importFileRef.current?.click()}>
                <IconUpload size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="TOML Preview">
              <ActionIcon variant="light" color="gray" size="lg" onClick={openToml}>
                <IconCode size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Download TOML">
              <ActionIcon variant="light" color="blue" size="lg" onClick={onExportConf} disabled={processStatus === 'running'}>
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
            <input
              ref={importFileRef}
              type="file"
              accept=".toml"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportToml(f);
                e.target.value = '';
              }}
            />
          </Group>
        </Group>

        {/* Sidebar + form panel */}
        <ProcessingConfigPanel
          config={config}
          onConfigChange={handleConfigChange}
          activeSectionRef={activeSectionRef}
          execution={{
            roverFile,
            onRoverFileChange,
            baseFile,
            onBaseFileChange,
            navFile,
            onNavFileChange,
            correctionFiles,
            onCorrectionFilesChange,
            outputFile,
            onOutputFileChange,
            needsBase,
            onQcPreview,
            roverFileValid,
          }}
        />
      </Stack>
    </Card>

    <TomlDrawer config={config} opened={tomlOpened} onClose={closeToml} />
    <PresetPanel
      opened={presetsOpened}
      onClose={closePresets}
      mode="post"
      currentConfig={config}
      onLoad={(c) => setConfig(c)}
    />
    <ConfigAssistantModal
      opened={assistantOpened}
      onClose={closeAssistant}
      mode="post"
      onApply={(mapped) => setConfig((prev) => ({ ...prev, ...mapped } as MrtkPostConfig))}
    />
    </>
  );
}
