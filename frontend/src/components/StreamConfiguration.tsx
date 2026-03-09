import { useRef, useEffect } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import {
  Card,
  Stack,
  Tabs,
  Select,
  TextInput,
  NumberInput,
  Group,
  ActionIcon,
  Button,
  Text,
  Textarea,
  Code,
  Title,
  PasswordInput,
  Alert,
  SimpleGrid,
} from '@mantine/core';
import {
  IconPlus,
  IconTrash,
  IconDownload,
  IconUpload,
  IconInfoCircle,
} from '@tabler/icons-react';
import { FileNamingHelper } from './FileNamingHelper';
import type {
  BuilderConfig,
  InputStream,
  OutputStream,
  StreamType,
  SerialParams,
  TcpClientParams,
  TcpServerParams,
  NtripClientParams,
  FileParams,
  ProfileConfig,
} from '../types/streamConfig';
import { generateStr2StrArgs, generateCommandString } from '../utils/streamArgs';

interface StreamConfigurationProps {
  onArgsChange: (args: string[]) => void;
}

const DEFAULT_INPUT: InputStream = {
  id: 'input-1',
  type: 'serial',
  params: {
    port: '/dev/ttyUSB0',
    baudrate: 115200,
    bytesize: 8,
    parity: 'N',
    stopbits: 1,
  } as SerialParams,
};

const DEFAULT_OUTPUT: OutputStream = {
  id: 'output-1',
  type: 'file',
  params: {
    path: '/workspace/output_%Y%m%d_%h%M%S.ubx',
  } as FileParams,
};

const DEFAULT_CONFIG: BuilderConfig = {
  input: DEFAULT_INPUT,
  outputs: [DEFAULT_OUTPUT],
};

export function StreamConfiguration({ onArgsChange }: StreamConfigurationProps) {
  // Persistent state using localStorage
  const [mode, setMode] = useLocalStorage<'builder' | 'raw'>({
    key: 'rtklib-web-ui-str2str-mode',
    defaultValue: 'builder',
  });

  const [builderConfig, setBuilderConfig] = useLocalStorage<BuilderConfig>({
    key: 'rtklib-web-ui-str2str-config',
    defaultValue: DEFAULT_CONFIG,
  });

  const [rawCommand, setRawCommand] = useLocalStorage<string>({
    key: 'rtklib-web-ui-str2str-raw',
    defaultValue: '',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update args when config changes
  useEffect(() => {
    if (mode === 'builder') {
      const args = generateStr2StrArgs(builderConfig);
      onArgsChange(args);
    } else {
      // Parse raw command to args
      const args = rawCommand.trim().replace(/^str2str\s+/, '').split(/\s+/).filter(Boolean);
      onArgsChange(args);
    }
  }, [mode, builderConfig, rawCommand, onArgsChange]);

  const handleInputChange = (field: string, value: any) => {
    setBuilderConfig((prev) => ({
      ...prev,
      input: {
        ...prev.input,
        params: {
          ...prev.input.params,
          [field]: value,
        },
      },
    }));
  };

  const handleInputTypeChange = (type: StreamType) => {
    let params: any;
    switch (type) {
      case 'serial':
        params = { port: '/dev/ttyUSB0', baudrate: 115200, bytesize: 8, parity: 'N', stopbits: 1 };
        break;
      case 'tcpcli':
        params = { host: '192.168.1.100', port: 2101 };
        break;
      case 'tcpsvr':
        params = { port: 2101 };
        break;
      case 'ntripcli':
        params = { host: 'rtk2go.com', port: 2101, mountpoint: 'MOUNT', username: '', password: '' };
        break;
      case 'file':
        params = { path: '/workspace/input.ubx' };
        break;
    }
    setBuilderConfig((prev) => ({
      ...prev,
      input: { ...prev.input, type, params },
    }));
  };

  const handleOutputAdd = () => {
    const newOutput: OutputStream = {
      id: `output-${Date.now()}`,
      type: 'file',
      params: { path: '/workspace/output.ubx' } as FileParams,
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

  const handleOutputChange = (id: string, field: string, value: any) => {
    setBuilderConfig((prev) => ({
      ...prev,
      outputs: prev.outputs.map((output) =>
        output.id === id
          ? { ...output, params: { ...output.params, [field]: value } }
          : output
      ),
    }));
  };

  const handleOutputTypeChange = (id: string, type: StreamType) => {
    let params: any;
    switch (type) {
      case 'serial':
        params = { port: '/dev/ttyUSB0', baudrate: 115200 };
        break;
      case 'tcpcli':
        params = { host: '192.168.1.100', port: 2101 };
        break;
      case 'tcpsvr':
        params = { port: 2101 };
        break;
      case 'ntripcli':
        params = { host: 'rtk2go.com', port: 2101, mountpoint: 'MOUNT' };
        break;
      case 'file':
        params = { path: '/workspace/output.ubx' };
        break;
    }
    setBuilderConfig((prev) => ({
      ...prev,
      outputs: prev.outputs.map((output) =>
        output.id === id ? { ...output, type, params } : output
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
    a.download = `str2str-profile-${Date.now()}.json`;
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
    } catch (error) {
      alert('Failed to import profile: Invalid file format');
    }

    // Reset file input
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
                  <Group gap="xs" justify="space-between">
                    <Text size="xs" fw={600}>Input Stream</Text>
                  </Group>

                  <Select
                    size="xs"
                    label="Type"
                    value={builderConfig.input.type}
                    onChange={(value) => handleInputTypeChange(value as StreamType)}
                    data={[
                      { value: 'serial', label: 'Serial' },
                      { value: 'tcpcli', label: 'TCP Client' },
                      { value: 'tcpsvr', label: 'TCP Server' },
                      { value: 'ntripcli', label: 'NTRIP' },
                      { value: 'file', label: 'File' },
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  {renderInputFields(builderConfig.input, handleInputChange)}
                </Stack>
              </Card>

              {/* Output Streams */}
              <Card withBorder p="xs">
                <Stack gap="xs">
                  <Group gap="xs" justify="space-between">
                    <Text size="xs" fw={600}>Output Streams</Text>
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
                            data={[
                              { value: 'serial', label: 'Serial' },
                              { value: 'tcpcli', label: 'TCP Client' },
                              { value: 'tcpsvr', label: 'TCP Server' },
                              { value: 'ntripcli', label: 'NTRIP' },
                              { value: 'file', label: 'File' },
                            ]}
                            styles={{ label: { fontSize: '10px' } }}
                          />

                          {renderOutputFields(
                            output,
                            (field, value) => handleOutputChange(output.id, field, value)
                          )}
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
                description="Enter str2str command line arguments directly"
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

function renderInputFields(
  input: InputStream,
  onChange: (field: string, value: any) => void
) {
  const params = input.params;

  switch (input.type) {
    case 'serial': {
      const p = params as SerialParams;
      return (
        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            size="xs"
            label="Port"
            placeholder="/dev/ttyUSB0"
            value={p.port}
            onChange={(e) => onChange('port', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Baudrate"
            value={p.baudrate}
            onChange={(value) => onChange('baudrate', value)}
            min={1200}
            max={921600}
            styles={{ label: { fontSize: '10px' } }}
          />
          <Select
            size="xs"
            label="Byte Size"
            value={String(p.bytesize || 8)}
            onChange={(value) => onChange('bytesize', parseInt(value!))}
            data={[
              { value: '7', label: '7' },
              { value: '8', label: '8' },
            ]}
            styles={{ label: { fontSize: '10px' } }}
          />
          <Select
            size="xs"
            label="Parity"
            value={p.parity || 'N'}
            onChange={(value) => onChange('parity', value)}
            data={[
              { value: 'N', label: 'None' },
              { value: 'E', label: 'Even' },
              { value: 'O', label: 'Odd' },
            ]}
            styles={{ label: { fontSize: '10px' } }}
          />
          <Select
            size="xs"
            label="Stop Bits"
            value={String(p.stopbits || 1)}
            onChange={(value) => onChange('stopbits', parseInt(value!))}
            data={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
            ]}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      );
    }
    case 'tcpcli': {
      const p = params as TcpClientParams;
      return (
        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            size="xs"
            label="Host"
            placeholder="192.168.1.100"
            value={p.host}
            onChange={(e) => onChange('host', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Port"
            value={p.port}
            onChange={(value) => onChange('port', value)}
            min={1}
            max={65535}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      );
    }
    case 'tcpsvr': {
      const p = params as TcpServerParams;
      return (
        <NumberInput
          size="xs"
          label="Port"
          value={p.port}
          onChange={(value) => onChange('port', value)}
          min={1}
          max={65535}
          styles={{ label: { fontSize: '10px' } }}
        />
      );
    }
    case 'ntripcli': {
      const p = params as NtripClientParams;
      return (
        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            size="xs"
            label="Host"
            placeholder="rtk2go.com"
            value={p.host}
            onChange={(e) => onChange('host', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Port"
            value={p.port}
            onChange={(value) => onChange('port', value)}
            min={1}
            max={65535}
            styles={{ label: { fontSize: '10px' } }}
          />
          <TextInput
            size="xs"
            label="Mountpoint"
            placeholder="MOUNT"
            value={p.mountpoint}
            onChange={(e) => onChange('mountpoint', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <TextInput
            size="xs"
            label="Username"
            placeholder="username"
            value={p.username || ''}
            onChange={(e) => onChange('username', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <PasswordInput
            size="xs"
            label="Password"
            placeholder="password"
            value={p.password || ''}
            onChange={(e) => onChange('password', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      );
    }
    case 'file': {
      const p = params as FileParams;
      return (
        <TextInput
          size="xs"
          label="File Path"
          placeholder="/workspace/input.ubx"
          value={p.path}
          onChange={(e) => onChange('path', e.currentTarget.value)}
          rightSection={
            <FileNamingHelper
              onKeywordClick={(keyword) => {
                const input = document.activeElement as HTMLInputElement;
                if (input && input.type === 'text') {
                  const start = input.selectionStart || p.path.length;
                  const newValue =
                    p.path.slice(0, start) + keyword + p.path.slice(start);
                  onChange('path', newValue);
                }
              }}
            />
          }
          styles={{ label: { fontSize: '10px' } }}
        />
      );
    }
  }
}

function renderOutputFields(
  output: OutputStream,
  onChange: (field: string, value: any) => void
) {
  const params = output.params;

  switch (output.type) {
    case 'serial': {
      const p = params as SerialParams;
      return (
        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            size="xs"
            label="Port"
            placeholder="/dev/ttyUSB1"
            value={p.port}
            onChange={(e) => onChange('port', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Baudrate"
            value={p.baudrate}
            onChange={(value) => onChange('baudrate', value)}
            min={1200}
            max={921600}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      );
    }
    case 'tcpcli': {
      const p = params as TcpClientParams;
      return (
        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            size="xs"
            label="Host"
            placeholder="192.168.1.100"
            value={p.host}
            onChange={(e) => onChange('host', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Port"
            value={p.port}
            onChange={(value) => onChange('port', value)}
            min={1}
            max={65535}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      );
    }
    case 'tcpsvr': {
      const p = params as TcpServerParams;
      return (
        <NumberInput
          size="xs"
          label="Port"
          value={p.port}
          onChange={(value) => onChange('port', value)}
          min={1}
          max={65535}
          styles={{ label: { fontSize: '10px' } }}
        />
      );
    }
    case 'ntripcli': {
      const p = params as NtripClientParams;
      return (
        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            size="xs"
            label="Host"
            placeholder="rtk2go.com"
            value={p.host}
            onChange={(e) => onChange('host', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Port"
            value={p.port}
            onChange={(value) => onChange('port', value)}
            min={1}
            max={65535}
            styles={{ label: { fontSize: '10px' } }}
          />
          <TextInput
            size="xs"
            label="Mountpoint"
            placeholder="MOUNT"
            value={p.mountpoint}
            onChange={(e) => onChange('mountpoint', e.currentTarget.value)}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      );
    }
    case 'file': {
      const p = params as FileParams;
      return (
        <Stack gap="xs">
          <TextInput
            size="xs"
            label="File Path"
            placeholder="/workspace/output.ubx"
            value={p.path}
            onChange={(e) => onChange('path', e.currentTarget.value)}
            rightSection={
              <FileNamingHelper
                onKeywordClick={(keyword) => {
                  const input = document.activeElement as HTMLInputElement;
                  if (input && input.type === 'text') {
                    const start = input.selectionStart || p.path.length;
                    const newValue =
                      p.path.slice(0, start) + keyword + p.path.slice(start);
                    onChange('path', newValue);
                  }
                }}
              />
            }
            styles={{ label: { fontSize: '10px' } }}
          />
          <SimpleGrid cols={2} spacing="xs">
            <Select
              size="xs"
              label="Swap Interval"
              placeholder="None"
              value={p.swapInterval ? String(p.swapInterval) : ''}
              onChange={(value) => onChange('swapInterval', value ? parseFloat(value) : undefined)}
              data={[
                { value: '', label: 'None' },
                { value: '0.25', label: '0.25H (15min)' },
                { value: '0.5', label: '0.5H (30min)' },
                { value: '1', label: '1H' },
                { value: '2', label: '2H' },
                { value: '3', label: '3H' },
                { value: '6', label: '6H' },
                { value: '12', label: '12H' },
                { value: '24', label: '24H' },
              ]}
              styles={{ label: { fontSize: '10px' } }}
            />
            <Select
              size="xs"
              label="Timetag"
              value={p.timetag === undefined ? 'off' : p.timetag ? 'on' : 'off'}
              onChange={(value) => onChange('timetag', value === 'on')}
              data={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              styles={{ label: { fontSize: '10px' } }}
            />
          </SimpleGrid>
        </Stack>
      );
    }
  }
}
