import { useRef, useEffect } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import {
  Card,
  Stack,
  Tabs,
  Select,
  Group,
  ActionIcon,
  Button,
  Text,
  Textarea,
  Code,
  Title,
  Alert,
} from '@mantine/core';
import {
  IconPlus,
  IconTrash,
  IconDownload,
  IconUpload,
  IconInfoCircle,
} from '@tabler/icons-react';
import { FileNamingHelper } from './FileNamingHelper';
import { MaskedPathInput } from './common/MaskedPathInput';
import { StreamPathHelp } from './StreamPathHelp';
import type {
  BuilderConfig,
  InputStream,
  OutputStream,
  StreamType,
  ProfileConfig,
} from '../types/streamConfig';
import { generateRelayArgs, generateCommandString } from '../utils/streamArgs';

interface StreamConfigurationProps {
  onArgsChange: (args: string[]) => void;
}

const STREAM_TYPES: { value: StreamType; label: string }[] = [
  { value: 'serial', label: 'Serial' },
  { value: 'tcpcli', label: 'TCP Client' },
  { value: 'tcpsvr', label: 'TCP Server' },
  { value: 'ntripcli', label: 'NTRIP' },
  { value: 'file', label: 'File' },
];

const PATH_PLACEHOLDERS: Record<StreamType, string> = {
  serial: 'ttyUSB0:115200',
  tcpcli: '192.168.1.100:2101',
  tcpsvr: ':2101',
  ntripcli: 'user:pass@rtk2go.com:2101/MOUNT',
  file: '/workspace/output.ubx',
};

const DEFAULT_PATHS: Record<StreamType, string> = {
  serial: 'ttyUSB0:115200',
  tcpcli: '192.168.1.100:2101',
  tcpsvr: ':2101',
  ntripcli: 'rtk2go.com:2101/MOUNT',
  file: '/workspace/output.ubx',
};

const DEFAULT_INPUT: InputStream = {
  id: 'input-1',
  type: 'serial',
  path: 'ttyUSB0:115200',
};

const DEFAULT_OUTPUT: OutputStream = {
  id: 'output-1',
  type: 'file',
  path: '/workspace/output_%Y%m%d_%h%M%S.ubx',
};

const DEFAULT_CONFIG: BuilderConfig = {
  input: DEFAULT_INPUT,
  outputs: [DEFAULT_OUTPUT],
};

export function StreamConfiguration({ onArgsChange }: StreamConfigurationProps) {
  const [mode, setMode] = useLocalStorage<'builder' | 'raw'>({
    key: 'mrtklib-web-ui-relay-mode',
    defaultValue: 'builder',
  });

  const [builderConfig, setBuilderConfig] = useLocalStorage<BuilderConfig>({
    key: 'mrtklib-web-ui-relay-config-v2',
    defaultValue: DEFAULT_CONFIG,
  });

  const [rawCommand, setRawCommand] = useLocalStorage<string>({
    key: 'mrtklib-web-ui-relay-raw',
    defaultValue: '',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update args when config changes
  useEffect(() => {
    if (mode === 'builder') {
      const args = generateRelayArgs(builderConfig);
      onArgsChange(args);
    } else {
      const args = rawCommand.trim().replace(/^str2str\s+/, '').split(/\s+/).filter(Boolean);
      onArgsChange(args);
    }
  }, [mode, builderConfig, rawCommand, onArgsChange]);

  const handleInputTypeChange = (type: StreamType) => {
    setBuilderConfig((prev) => ({
      ...prev,
      input: { ...prev.input, type, path: DEFAULT_PATHS[type] },
    }));
  };

  const handleInputPathChange = (path: string) => {
    setBuilderConfig((prev) => ({
      ...prev,
      input: { ...prev.input, path },
    }));
  };

  const handleOutputAdd = () => {
    const newOutput: OutputStream = {
      id: `output-${Date.now()}`,
      type: 'file',
      path: '/workspace/output.ubx',
    };
    setBuilderConfig((prev) => ({
      ...prev,
      outputs: [...prev.outputs, newOutput],
    }));
  };

  const handleOutputRemove = (id: string) => {
    setBuilderConfig((prev) => ({
      ...prev,
      outputs: prev.outputs.filter((o) => o.id !== id),
    }));
  };

  const handleOutputTypeChange = (id: string, type: StreamType) => {
    setBuilderConfig((prev) => ({
      ...prev,
      outputs: prev.outputs.map((o) =>
        o.id === id ? { ...o, type, path: DEFAULT_PATHS[type] } : o
      ),
    }));
  };

  const handleOutputPathChange = (id: string, path: string) => {
    setBuilderConfig((prev) => ({
      ...prev,
      outputs: prev.outputs.map((o) =>
        o.id === id ? { ...o, path } : o
      ),
    }));
  };

  const handleExportProfile = () => {
    const profile: ProfileConfig = {
      name: 'Stream Configuration',
      description: 'Exported configuration profile',
      builder: builderConfig,
      raw: rawCommand,
      mode,
    };

    const blob = new Blob([JSON.stringify(profile, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-profile-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportProfile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const profile: ProfileConfig = JSON.parse(text);

      if (profile.builder) {
        setBuilderConfig(profile.builder);
      }
      if (profile.raw) {
        setRawCommand(profile.raw);
      }
      if (profile.mode) {
        setMode(profile.mode);
      }
    } catch {
      alert('Failed to import profile: Invalid file format');
    }

    event.target.value = '';
  };

  const commandPreview = generateCommandString(builderConfig);

  return (
    <Card withBorder p="xs">
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={6} size="xs">Stream Configuration</Title>
          <Group gap={4}>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<IconUpload size={12} />}
              onClick={handleImportProfile}
            >
              Import
            </Button>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<IconDownload size={12} />}
              onClick={handleExportProfile}
            >
              Export
            </Button>
          </Group>
        </Group>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".json"
          onChange={handleFileSelect}
        />

        <Tabs value={mode} onChange={(value) => setMode(value as 'builder' | 'raw')}>
          <Tabs.List>
            <Tabs.Tab value="builder" style={{ fontSize: '11px', padding: '6px 12px' }}>
              Form Builder
            </Tabs.Tab>
            <Tabs.Tab value="raw" style={{ fontSize: '11px', padding: '6px 12px' }}>
              Raw Command
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="builder" pt="xs">
            <Stack gap="xs">
              {/* Input Stream */}
              <Card withBorder p="xs">
                <Stack gap="xs">
                  <Group gap={4}>
                    <Text size="xs" fw={600}>Input Stream</Text>
                    <StreamPathHelp />
                  </Group>

                  <Select
                    size="xs"
                    label="Type"
                    value={builderConfig.input.type}
                    onChange={(value) => handleInputTypeChange(value as StreamType)}
                    data={STREAM_TYPES}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <MaskedPathInput
                    size="xs"
                    label="Path"
                    placeholder={PATH_PLACEHOLDERS[builderConfig.input.type]}
                    value={builderConfig.input.path}
                    onChange={(v) => handleInputPathChange(v)}
                    rightSection={
                      builderConfig.input.type === 'file' ? (
                        <FileNamingHelper
                          onKeywordClick={(keyword) => {
                            const path = builderConfig.input.path;
                            handleInputPathChange(path + keyword);
                          }}
                        />
                      ) : undefined
                    }
                    styles={{
                      label: { fontSize: '10px' },
                      input: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' },
                    }}
                  />
                </Stack>
              </Card>

              {/* Output Streams */}
              <Card withBorder p="xs">
                <Stack gap="xs">
                  <Group gap="xs" justify="space-between">
                    <Group gap={4}>
                      <Text size="xs" fw={600}>Output Streams</Text>
                      <StreamPathHelp />
                    </Group>
                    <ActionIcon
                      variant="light"
                      color="blue"
                      size="xs"
                      onClick={handleOutputAdd}
                    >
                      <IconPlus size={12} />
                    </ActionIcon>
                  </Group>

                  {builderConfig.outputs.length === 0 && (
                    <Alert color="blue" icon={<IconInfoCircle size={14} />} p="xs">
                      <Text size="xs">No output streams configured</Text>
                    </Alert>
                  )}

                  <Stack gap="xs">
                    {builderConfig.outputs.map((output, index) => (
                      <Card key={output.id} withBorder p="xs">
                        <Stack gap="xs">
                          <Group justify="space-between">
                            <Text size="xs" fw={500}>
                              Output #{index + 1}
                            </Text>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="xs"
                              onClick={() => handleOutputRemove(output.id)}
                            >
                              <IconTrash size={12} />
                            </ActionIcon>
                          </Group>

                          <Select
                            size="xs"
                            label="Type"
                            value={output.type}
                            onChange={(value) =>
                              handleOutputTypeChange(output.id, value as StreamType)
                            }
                            data={STREAM_TYPES}
                            styles={{ label: { fontSize: '10px' } }}
                          />

                          <MaskedPathInput
                            size="xs"
                            label="Path"
                            placeholder={PATH_PLACEHOLDERS[output.type]}
                            value={output.path}
                            onChange={(v) =>
                              handleOutputPathChange(output.id, v)
                            }
                            rightSection={
                              output.type === 'file' ? (
                                <FileNamingHelper
                                  onKeywordClick={(keyword) => {
                                    handleOutputPathChange(output.id, output.path + keyword);
                                  }}
                                />
                              ) : undefined
                            }
                            styles={{
                              label: { fontSize: '10px' },
                              input: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' },
                            }}
                          />
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                </Stack>
              </Card>

              {/* Command Preview */}
              <div>
                <Text size="xs" fw={600} mb={4}>Command Preview</Text>
                <Code block style={{ fontSize: '10px', whiteSpace: 'pre-wrap', padding: '6px' }}>
                  {commandPreview}
                </Code>
              </div>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="raw" pt="xs">
            <Stack gap="xs">
              <Textarea
                size="xs"
                label="Raw Command Arguments"
                description="Enter mrtk relay command line arguments directly"
                placeholder="-in serial://ttyUSB0:115200 -out file:///workspace/output.ubx"
                value={rawCommand}
                onChange={(e) => setRawCommand(e.currentTarget.value)}
                minRows={5}
                autosize
                styles={{
                  input: {
                    fontFamily: 'monospace',
                    fontSize: '11px',
                  },
                  label: { fontSize: '10px' },
                  description: { fontSize: '10px' },
                }}
              />

              <Alert color="blue" icon={<IconInfoCircle size={14} />} p="xs">
                <Text size="xs">
                  When in Raw mode, this command string takes precedence over the Form Builder
                  configuration.
                </Text>
              </Alert>

              <div>
                <Text size="xs" c="dimmed" mb={4}>Examples:</Text>
                <Code block style={{ fontSize: '10px', padding: '6px' }}>
                  {`# Serial to file
-in serial://ttyUSB0:115200 -out file:///workspace/out_%Y%m%d.ubx

# TCP client to file
-in tcpcli://192.168.1.100:2101 -out file:///workspace/out.ubx

# NTRIP to file and TCP server
-in ntrip://user:pass@rtk2go.com:2101/MOUNT -out file:///workspace/out.rtcm -out tcpsvr://:5000`}
                </Code>
              </div>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Card>
  );
}
