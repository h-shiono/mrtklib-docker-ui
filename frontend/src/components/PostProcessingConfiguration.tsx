import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import {
  Card,
  Stack,
  Tabs,
  NumberInput,
  SimpleGrid,
  Text,
  Title,
  Group,
  Fieldset,
  TextInput,
  Checkbox,
  Button,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import {
  IconFolderOpen,
  IconPlayerPlay,
  IconPlayerStop,
  IconDownload,
  IconFile,
  IconPlus,
  IconX,
  IconChartBar,
} from '@tabler/icons-react';
import type { MrtkPostConfig } from '../types/mrtkPostConfig';
import { DEFAULT_MRTK_POST_CONFIG } from '../types/mrtkPostConfig';
import { FileBrowserModal } from './FileBrowserModal';
import { ProcessingTabHeaders, ProcessingTabPanels } from './ProcessingConfigTabs';

interface PostProcessingConfigurationProps {
  onConfigChange: (config: MrtkPostConfig) => void;
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
    key: 'mrtklib-web-ui-mrtk-post-config-v18',
    defaultValue: DEFAULT_MRTK_POST_CONFIG,
  });

  // File browser for Execution tab only
  const [fileBrowserOpened, setFileBrowserOpened] = useState(false);
  const fileBrowserCallbackRef = useRef<((path: string) => void) | null>(null);

  const openFileBrowser = useCallback((onSelect: (path: string) => void) => {
    fileBrowserCallbackRef.current = onSelect;
    setFileBrowserOpened(true);
  }, []);

  const handleFileBrowserSelect = useCallback((path: string) => {
    if (fileBrowserCallbackRef.current) {
      fileBrowserCallbackRef.current(path);
      fileBrowserCallbackRef.current = null;
    }
  }, []);

  // Sync config to parent whenever it changes, including initial localStorage load.
  useEffect(() => {
    onConfigChange(config);
  }, [config, onConfigChange]);

  const handleConfigChange = (newConfig: MrtkPostConfig) => {
    setConfig(newConfig);
  };

  return (
    <>
    <Card withBorder p="xs">
      <Stack gap="xs">
        <Title order={6} size="xs">
          Processing Configuration
        </Title>

        <Tabs defaultValue="execution">
          <Tabs.List>
            <Tooltip label="Execution" openDelay={500}>
              <Tabs.Tab value="execution" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconPlayerPlay size={14} />}>
                Exec.
              </Tabs.Tab>
            </Tooltip>
            <ProcessingTabHeaders />
          </Tabs.List>

          {/* Tab: Execution */}
          <Tabs.Panel value="execution" pt="xs">
            <Stack gap="xs">
              {/* Time Range */}
              <Fieldset legend="Time Range" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={3} spacing="xs">
                  {/* Start */}
                  <div>
                    <Checkbox
                      size="xs"
                      label="Time Start (GPST)"
                      checked={config.time.startEnabled}
                      onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, startEnabled: e.currentTarget.checked } })}
                      styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                    />
                    <Group gap={4} mt={4}>
                      <TextInput
                        size="xs"
                        placeholder="YYYY/MM/DD"
                        value={config.time.startDate}
                        onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, startDate: e.currentTarget.value } })}
                        disabled={!config.time.startEnabled}
                        style={{ flex: 1 }}
                        styles={{ input: { fontSize: '11px', textAlign: 'center' } }}
                      />
                      <TextInput
                        size="xs"
                        placeholder="HH:MM:SS"
                        value={config.time.startTime}
                        onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, startTime: e.currentTarget.value } })}
                        disabled={!config.time.startEnabled}
                        style={{ flex: 1 }}
                        styles={{ input: { fontSize: '11px', textAlign: 'center' } }}
                      />
                    </Group>
                  </div>

                  {/* End */}
                  <div>
                    <Checkbox
                      size="xs"
                      label="Time End (GPST)"
                      checked={config.time.endEnabled}
                      onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, endEnabled: e.currentTarget.checked } })}
                      styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                    />
                    <Group gap={4} mt={4}>
                      <TextInput
                        size="xs"
                        placeholder="YYYY/MM/DD"
                        value={config.time.endDate}
                        onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, endDate: e.currentTarget.value } })}
                        disabled={!config.time.endEnabled}
                        style={{ flex: 1 }}
                        styles={{ input: { fontSize: '11px', textAlign: 'center' } }}
                      />
                      <TextInput
                        size="xs"
                        placeholder="HH:MM:SS"
                        value={config.time.endTime}
                        onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, endTime: e.currentTarget.value } })}
                        disabled={!config.time.endEnabled}
                        style={{ flex: 1 }}
                        styles={{ input: { fontSize: '11px', textAlign: 'center' } }}
                      />
                    </Group>
                  </div>

                  {/* Interval */}
                  <div>
                    <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Interval (0=all)</Text>
                    <NumberInput
                      size="xs"
                      value={config.time.interval}
                      onChange={(v) => handleConfigChange({ ...config, time: { ...config.time, interval: Number(v) || 0 } })}
                      min={0}
                      step={1}
                      decimalScale={2}
                      suffix=" s"
                      hideControls
                      styles={{ input: { fontSize: '11px' } }}
                    />
                  </div>
                </SimpleGrid>
              </Fieldset>

              {/* Input Files */}
              <Fieldset legend="Input Files" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <div>
                      <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Rover OBS *</Text>
                      <Group gap="xs" wrap="nowrap">
                        <TextInput
                          size="xs"
                          placeholder="/workspace/rover.obs"
                          value={roverFile}
                          onChange={(e) => onRoverFileChange(e.currentTarget.value)}
                          leftSection={<IconFile size={12} />}
                          style={{ flex: 1 }}
                        />
                        <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(onRoverFileChange)}>
                          <IconFolderOpen size={16} />
                        </ActionIcon>
                      </Group>
                    </div>

                    <div>
                      <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Navigation *</Text>
                      <Group gap="xs" wrap="nowrap">
                        <TextInput
                          size="xs"
                          placeholder="/workspace/nav.nav"
                          value={navFile}
                          onChange={(e) => onNavFileChange(e.currentTarget.value)}
                          leftSection={<IconFile size={12} />}
                          style={{ flex: 1 }}
                        />
                        <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(onNavFileChange)}>
                          <IconFolderOpen size={16} />
                        </ActionIcon>
                      </Group>
                    </div>
                  </SimpleGrid>

                  <div>
                    <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }} c={!needsBase ? 'dimmed' : undefined}>Base OBS</Text>
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        size="xs"
                        placeholder="/workspace/base.obs"
                        value={baseFile}
                        onChange={(e) => onBaseFileChange(e.currentTarget.value)}
                        leftSection={<IconFile size={12} />}
                        style={{ flex: 1 }}
                        disabled={!needsBase}
                      />
                      <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(onBaseFileChange)} disabled={!needsBase}>
                        <IconFolderOpen size={16} />
                      </ActionIcon>
                    </Group>
                  </div>

                  {/* Correction Files */}
                  <div>
                    <Group gap="xs" mb={4} justify="space-between">
                      <Text size="xs" style={{ fontSize: '10px' }}>
                        Corrections (CLK, SP3, FCB, IONEX, L6, etc.)
                      </Text>
                      <ActionIcon
                        variant="light"
                        size="xs"
                        onClick={() => onCorrectionFilesChange([...correctionFiles, ''])}
                      >
                        <IconPlus size={12} />
                      </ActionIcon>
                    </Group>
                    <Stack gap={4}>
                      {correctionFiles.map((cf, idx) => (
                        <Group key={idx} gap="xs" wrap="nowrap">
                          <TextInput
                            size="xs"
                            placeholder={`/workspace/correction${idx + 1}`}
                            value={cf}
                            onChange={(e) => {
                              const next = [...correctionFiles];
                              next[idx] = e.currentTarget.value;
                              onCorrectionFilesChange(next);
                            }}
                            leftSection={<IconFile size={12} />}
                            style={{ flex: 1 }}
                          />
                          <ActionIcon
                            variant="filled"
                            color="blue"
                            size="lg"
                            onClick={() => openFileBrowser((path) => {
                              const next = [...correctionFiles];
                              next[idx] = path;
                              onCorrectionFilesChange(next);
                            })}
                          >
                            <IconFolderOpen size={16} />
                          </ActionIcon>
                          {correctionFiles.length > 1 && (
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="lg"
                              onClick={() => onCorrectionFilesChange(correctionFiles.filter((_, i) => i !== idx))}
                            >
                              <IconX size={14} />
                            </ActionIcon>
                          )}
                        </Group>
                      ))}
                    </Stack>
                  </div>

                  <div>
                    <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Output *</Text>
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        size="xs"
                        placeholder="/workspace/output.pos"
                        value={outputFile}
                        onChange={(e) => onOutputFileChange(e.currentTarget.value)}
                        leftSection={<IconFile size={12} />}
                        style={{ flex: 1 }}
                      />
                      <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(onOutputFileChange)}>
                        <IconFolderOpen size={16} />
                      </ActionIcon>
                    </Group>
                  </div>

                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconChartBar size={14} />}
                    onClick={onQcPreview}
                    disabled={!roverFileValid}
                  >
                    QC Preview
                  </Button>
                </Stack>
              </Fieldset>

              {/* Execute / Export */}
              <Group mt="xs">
                <Group grow style={{ flex: 1 }}>
                  {processStatus === 'running' ? (
                    <Button size="xs" color="red" leftSection={<IconPlayerStop size={12} />} onClick={onStop} loading={isLoading}>
                      Stop
                    </Button>
                  ) : (
                    <Button size="xs" color="green" leftSection={<IconPlayerPlay size={12} />} onClick={onExecute} loading={isLoading}>
                      Execute
                    </Button>
                  )}
                </Group>
                <Tooltip label="Download TOML config">
                  <ActionIcon variant="light" color="blue" size="lg" onClick={onExportConf} disabled={processStatus === 'running'}>
                    <IconDownload size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Stack>
          </Tabs.Panel>

          <ProcessingTabPanels config={config} onConfigChange={handleConfigChange} />

        </Tabs>
      </Stack>
    </Card>

      <FileBrowserModal
        opened={fileBrowserOpened}
        onClose={() => setFileBrowserOpened(false)}
        onSelect={handleFileBrowserSelect}
        title="Select File"
      />
    </>
  );
}
