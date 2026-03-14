import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import {
  Card,
  Stack,
  Tabs,
  Select,
  NumberInput,
  SimpleGrid,
  Text,
  Switch,
  Title,
  Group,
  Accordion,
  Fieldset,
  TextInput,
  Checkbox,
  Button,
  ActionIcon,
  HoverCard,
  Table,
  Tooltip,
} from '@mantine/core';
import {
  IconAdjustments,
  IconAdjustmentsHorizontal,
  IconChartLine,
  IconDatabaseExport,
  IconDots,
  IconFolderOpen,
  IconMapPin,
  IconInfoCircle,
  IconPlayerPlay,
  IconPlayerStop,
  IconDownload,
  IconFile,
  IconPlus,
  IconX,
  IconChartBar,
} from '@tabler/icons-react';
import type {
  MrtkPostConfig,
  PositioningMode,
  Frequency,
  FilterType,
  IonosphereCorrection,
  TroposphereCorrection,
  EphemerisOption,
  EarthTidesCorrection,
  ReceiverDynamics,
  ARMode,
  SolutionFormat,
  TimeFormat,
  LatLonFormat,
  Datum,
  HeightType,
  GeoidModel,
  StaticSolutionMode,
  DebugTraceLevel,
  SnrMaskConfig,
  PositionType,
  StationPosition,
} from '../types/mrtkPostConfig';
import { DEFAULT_MRTK_POST_CONFIG } from '../types/mrtkPostConfig';
import { SnrMaskModal } from './SnrMaskModal';
import { FileBrowserModal } from './FileBrowserModal';

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

interface StationPositionInputProps {
  label: string;
  value: StationPosition;
  onChange: (value: StationPosition) => void;
  disabled?: boolean;
  disableCoordinates?: boolean;
  disableAntenna?: boolean;
}

interface FileInputRowProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onBrowse?: () => void;
}

function StationPositionInput({
  label,
  value,
  onChange,
  disabled = false,
  disableCoordinates = false,
  disableAntenna = false,
}: StationPositionInputProps) {
  const isManualInput = value.mode === 'llh' || value.mode === 'xyz';
  const coordinateLabels = value.mode === 'xyz'
    ? ['X-ECEF (m)', 'Y-ECEF (m)', 'Z-ECEF (m)']
    : ['Latitude (deg)', 'Longitude (deg)', 'Height (m)'];

  // Determine effective disable states
  const coordsDisabled = disabled || disableCoordinates;
  const antennaDisabled = disabled || disableAntenna;

  return (
    <Fieldset legend={label} style={{ fontSize: '10px' }}>
      <Stack gap="xs">
        <Select
          size="xs"
          label="Position Type"
          value={value.mode}
          onChange={(val: any) => onChange({ ...value, mode: val as PositionType })}
          data={[
            { value: 'llh', label: 'Lat/Lon/Height' },
            { value: 'xyz', label: 'XYZ-ECEF' },
            { value: 'rtcm', label: 'RTCM Antenna Pos' },
            { value: 'rinex', label: 'RINEX Header Pos' },
            { value: 'average', label: 'Average of Single Pos' },
          ]}
          disabled={coordsDisabled}
          styles={{ label: { fontSize: '10px' } }}
        />

        <SimpleGrid cols={3} spacing="xs">
          <NumberInput
            size="xs"
            label={coordinateLabels[0]}
            value={value.values[0]}
            onChange={(val: any) =>
              onChange({
                ...value,
                values: [Number(val), value.values[1], value.values[2]],
              })
            }
            decimalScale={9}
            hideControls
            disabled={coordsDisabled || !isManualInput}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label={coordinateLabels[1]}
            value={value.values[1]}
            onChange={(val: any) =>
              onChange({
                ...value,
                values: [value.values[0], Number(val), value.values[2]],
              })
            }
            decimalScale={9}
            hideControls
            disabled={coordsDisabled || !isManualInput}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label={coordinateLabels[2]}
            value={value.values[2]}
            onChange={(val: any) =>
              onChange({
                ...value,
                values: [value.values[0], value.values[1], Number(val)],
              })
            }
            decimalScale={4}
            hideControls
            disabled={coordsDisabled || !isManualInput}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>

        <Checkbox
          size="xs"
          label="Antenna Type"
          checked={value.antennaTypeEnabled}
          onChange={(e: any) =>
            onChange({
              ...value,
              antennaTypeEnabled: e.currentTarget.checked,
            })
          }
          disabled={antennaDisabled}
          styles={{ label: { fontSize: '10px' } }}
        />

        {value.antennaTypeEnabled && (
          <TextInput
            size="xs"
            label="Antenna Type Name"
            value={value.antennaType}
            onChange={(e: any) =>
              onChange({
                ...value,
                antennaType: e.currentTarget.value,
              })
            }
            placeholder="e.g., AOAD/M_T"
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
        )}

        <Text size="xs" style={{ fontSize: '10px' }}>
          Antenna Delta E/N/U (m)
        </Text>
        <SimpleGrid cols={3} spacing="xs">
          <NumberInput
            size="xs"
            label="Delta-E"
            value={value.antennaDelta[0]}
            onChange={(val: any) =>
              onChange({
                ...value,
                antennaDelta: [Number(val), value.antennaDelta[1], value.antennaDelta[2]],
              })
            }
            decimalScale={4}
            hideControls
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Delta-N"
            value={value.antennaDelta[1]}
            onChange={(val: any) =>
              onChange({
                ...value,
                antennaDelta: [value.antennaDelta[0], Number(val), value.antennaDelta[2]],
              })
            }
            decimalScale={4}
            hideControls
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="Delta-U"
            value={value.antennaDelta[2]}
            onChange={(val: any) =>
              onChange({
                ...value,
                antennaDelta: [value.antennaDelta[0], value.antennaDelta[1], Number(val)],
              })
            }
            decimalScale={4}
            hideControls
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      </Stack>
    </Fieldset>
  );
}

function FileInputRow({
  label,
  value,
  onChange,
  placeholder,
  onBrowse,
}: FileInputRowProps) {
  return (
    <div>
      {label && (
        <Text size="xs" fw={500} mb={4} style={{ fontSize: '10px' }}>
          {label}
        </Text>
      )}
      <Group gap="xs" wrap="nowrap">
        <TextInput
          size="xs"
          value={value}
          onChange={(e: any) => onChange(e.currentTarget.value)}
          placeholder={placeholder || 'Path to file'}
          styles={{
            label: { fontSize: '10px' },
            root: { flex: 1 }
          }}
          style={{ flex: 1 }}
        />
        <ActionIcon
          variant="filled"
          color="blue"
          size="lg"
          onClick={onBrowse}
        >
          <IconFolderOpen size={16} />
        </ActionIcon>
      </Group>
    </div>
  );
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
    key: 'mrtklib-web-ui-mrtk-post-config-v15',
    defaultValue: DEFAULT_MRTK_POST_CONFIG,
  });

  const [snrMaskModalOpened, setSnrMaskModalOpened] = useState(false);
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

  // Conditional logic based on positioning mode
  const isSingle = config.positioning.positioningMode === 'single';
  const isDGPS = config.positioning.positioningMode === 'dgps';
  const isMadocaPPP = ['ppp-kinematic', 'ppp-static', 'ppp-fixed'].includes(config.positioning.positioningMode);
  const isPPP = isMadocaPPP || config.positioning.positioningMode === 'ppp-rtk';
  const isPppRtk = config.positioning.positioningMode === 'ppp-rtk';
  const isStaticMode = ['static', 'ppp-static'].includes(config.positioning.positioningMode);
  const isSolLLH = config.output.solutionFormat === 'llh';
  const isSolNMEA = config.output.solutionFormat === 'nmea';
  const isFixedMode = ['fixed', 'ppp-fixed'].includes(config.positioning.positioningMode);
  const canUseSignals = !isMadocaPPP;
  const useSignals = canUseSignals && config.positioning.signalMode === 'signals';

  const isReceiverDynamicsEnabled =
    config.positioning.positioningMode === 'kinematic' ||
    config.positioning.positioningMode === 'ppp-kinematic';

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
            <Tabs.Tab value="execution" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconPlayerPlay size={14} />}>
              Execution
            </Tabs.Tab>
            <Tabs.Tab value="positioning" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconAdjustments size={14} />}>
              Positioning
            </Tabs.Tab>
            <Tooltip label="Ambiguity Resolution" openDelay={500}>
              <Tabs.Tab value="ambiguity" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconAdjustmentsHorizontal size={14} />}>
                AR
              </Tabs.Tab>
            </Tooltip>
            <Tooltip label="Kalman Filter" openDelay={500}>
              <Tabs.Tab value="kalman" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconChartLine size={14} />}>
                KF
              </Tabs.Tab>
            </Tooltip>
            <Tabs.Tab value="antenna" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconMapPin size={14} />}>
              Antenna
            </Tabs.Tab>
            <Tabs.Tab value="output" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconDatabaseExport size={14} />}>
              Output
            </Tabs.Tab>
            <Tabs.Tab value="files" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconFolderOpen size={14} />}>
              Files
            </Tabs.Tab>
            <Tabs.Tab value="clas" style={{ fontSize: '11px', padding: '6px 12px' }} disabled={!isPppRtk}>
              CLAS
            </Tabs.Tab>
            <Tabs.Tab value="server" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconDots size={14} />}>
              Server
            </Tabs.Tab>
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

          {/* Tab: Positioning */}
          <Tabs.Panel value="positioning" pt="xs">
            <Stack gap="xs">
              {/* Group A: Basic Strategy */}
              <Fieldset legend="Basic Strategy" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={3} spacing="xs">
                  <Select
                    size="xs"
                    label="Positioning Mode"
                    value={config.positioning.positioningMode}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          positioningMode: value as PositioningMode,
                        },
                      })
                    }
                    data={[
                      { value: 'single', label: 'Single' },
                      { value: 'dgps', label: 'DGPS/DGNSS' },
                      { value: 'kinematic', label: 'Kinematic' },
                      { value: 'static', label: 'Static' },
                      { value: 'moving-base', label: 'Moving-Base' },
                      { value: 'fixed', label: 'Fixed' },
                      { value: 'ppp-kinematic', label: 'PPP-Kinematic' },
                      { value: 'ppp-static', label: 'PPP-Static' },
                      { value: 'ppp-fixed', label: 'PPP-Fixed' },
                      { value: 'ppp-rtk', label: 'PPP-RTK' },
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <div>
                    <Group gap="xs" mb={4}>
                      <Text size="xs" style={{ fontSize: '10px' }}>
                        {useSignals ? 'Signals' : 'Frequencies'}
                      </Text>
                      {canUseSignals && (
                        <Select
                          size="xs"
                          value={config.positioning.signalMode}
                          onChange={(value: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: { ...config.positioning, signalMode: value },
                            })
                          }
                          data={[
                            { value: 'frequency', label: 'Freq' },
                            { value: 'signals', label: 'Signals' },
                          ]}
                          w={80}
                          styles={{ input: { fontSize: '9px', minHeight: '20px', height: '20px' } }}
                        />
                      )}
                    </Group>
                    {useSignals ? (
                      <TextInput
                        size="xs"
                        value={config.positioning.signals}
                        onChange={(e) =>
                          handleConfigChange({
                            ...config,
                            positioning: { ...config.positioning, signals: e.currentTarget.value },
                          })
                        }
                        placeholder="G1C,G2W,E1C,E5Q,E7Q,J1C,J5Q,J2X"
                        styles={{ label: { fontSize: '10px' } }}
                      />
                    ) : (
                      <Group gap="xs" wrap="nowrap">
                        <Select
                          size="xs"
                          value={config.positioning.frequency}
                          onChange={(value: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: { ...config.positioning, frequency: value as Frequency },
                            })
                          }
                          data={[
                            { value: 'l1', label: 'L1' },
                            { value: 'l1+l2', label: 'L1+2' },
                            { value: 'l1+l2+l5', label: 'L1+2+3' },
                            { value: 'l1+l2+l5+l6', label: 'L1+2+3+4' },
                            { value: 'l1+l2+l5+l6+l7', label: 'L1+2+3+4+5' },
                          ]}
                          disabled={isSingle}
                          styles={{ label: { fontSize: '10px' }, root: { flex: 1 } }}
                          style={{ flex: 1 }}
                        />
                        <HoverCard width={400} shadow="md" withinPortal>
                          <HoverCard.Target>
                            <ActionIcon variant="subtle" size="sm" color="gray">
                              <IconInfoCircle size={14} />
                            </ActionIcon>
                          </HoverCard.Target>
                          <HoverCard.Dropdown p="xs">
                            <Text size="xs" fw={500} mb="xs" style={{ fontSize: '10px' }}>
                              GNSS Frequency Mapping
                            </Text>
                            <Table style={{ fontSize: '9px' }}>
                              <Table.Thead style={{ borderBottom: '1px solid #dee2e6' }}>
                                <Table.Tr>
                                  <Table.Th style={{ fontSize: '9px', padding: '4px' }}>System</Table.Th>
                                  <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>F1</Table.Th>
                                  <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>F2</Table.Th>
                                  <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>F3</Table.Th>
                                  <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>F4</Table.Th>
                                  <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>F5</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                <Table.Tr>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px' }}>GPS</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L1</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L2</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L5</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                </Table.Tr>
                                <Table.Tr>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px' }}>GLONASS</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>G1</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>G2</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>G3</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                </Table.Tr>
                                <Table.Tr>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px' }}>Galileo</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>E1</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>E5b</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>E5a</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>E6</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                </Table.Tr>
                                <Table.Tr>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px' }}>QZSS</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L1</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L2</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L5</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L6</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                </Table.Tr>
                                <Table.Tr>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px' }}>BDS</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>B1I/C</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>B2I/b</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>B2a</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>B3</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>B2a+b</Table.Td>
                                </Table.Tr>
                                <Table.Tr>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px' }}>IRNSS</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L5</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>S</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                  <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                </Table.Tr>
                              </Table.Tbody>
                            </Table>
                          </HoverCard.Dropdown>
                        </HoverCard>
                      </Group>
                    )}
                  </div>

                  <Select
                    size="xs"
                    label="Filter Type"
                    value={config.positioning.filterType}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: { ...config.positioning, filterType: value as FilterType },
                      })
                    }
                    data={[
                      { value: 'forward', label: 'Forward' },
                      { value: 'backward', label: 'Backward' },
                      { value: 'combined', label: 'Combined' },
                    ]}
                    disabled={isSingle}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </SimpleGrid>
              </Fieldset>

              {/* Group B: Masks & Environment */}
              <Fieldset legend="Masks & Environment" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={2} spacing="xs">
                  <NumberInput
                    size="xs"
                    label="Elevation Mask (deg)"
                    value={config.positioning.elevationMask}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          elevationMask: Number(value),
                        },
                      })
                    }
                    min={0}
                    max={90}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <div>
                    <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      SNR Mask
                    </Text>
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => setSnrMaskModalOpened(true)}
                      fullWidth
                    >
                      Edit SNR Mask...
                    </Button>
                  </div>

                  <Select
                    size="xs"
                    label="Ionosphere Correction"
                    value={config.positioning.ionosphereCorrection}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          ionosphereCorrection: value as IonosphereCorrection,
                        },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'broadcast', label: 'Broadcast' },
                      { value: 'sbas', label: 'SBAS' },
                      { value: 'dual-freq', label: 'Iono-Free LC' },
                      { value: 'est-stec', label: 'Estimate STEC' },
                      { value: 'ionex-tec', label: 'IONEX TEC' },
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <Select
                    size="xs"
                    label="Troposphere Correction"
                    value={config.positioning.troposphereCorrection}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          troposphereCorrection: value as TroposphereCorrection,
                        },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'saastamoinen', label: 'Saastamoinen' },
                      { value: 'sbas', label: 'SBAS' },
                      { value: 'est-ztd', label: 'Estimate ZTD' },
                      { value: 'est-ztd-grad', label: 'Estimate ZTD+Grad' },
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <Checkbox
                    size="xs"
                    label="Receiver Iono Correction"
                    checked={config.receiver.ionoCorrection}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: {
                          ...config.receiver,
                          ionoCorrection: e.currentTarget.checked,
                        },
                      })
                    }
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <Select
                    size="xs"
                    label="Satellite Ephemeris/Clock"
                    value={config.positioning.ephemerisOption}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          ephemerisOption: value as EphemerisOption,
                        },
                      })
                    }
                    data={[
                      { value: 'broadcast', label: 'Broadcast' },
                      { value: 'precise', label: 'Precise' },
                      { value: 'broadcast+sbas', label: 'Broadcast+SBAS' },
                      { value: 'broadcast+ssrapc', label: 'Broadcast+SSR APC' },
                      { value: 'broadcast+ssrcom', label: 'Broadcast+SSR CoM' },
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </SimpleGrid>
              </Fieldset>

              {/* Group C: Satellite Selection */}
              <Fieldset legend="Satellite Selection" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <Text size="xs" style={{ fontSize: '10px' }}>
                    Constellations
                  </Text>
                  <Group gap="xs">
                    <Checkbox
                      size="xs"
                      label="GPS"
                      checked={config.positioning.constellations.gps}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          positioning: {
                            ...config.positioning,
                            constellations: {
                              ...config.positioning.constellations,
                              gps: e.currentTarget.checked,
                            },
                          },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Checkbox
                      size="xs"
                      label="GLONASS"
                      checked={config.positioning.constellations.glonass}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          positioning: {
                            ...config.positioning,
                            constellations: {
                              ...config.positioning.constellations,
                              glonass: e.currentTarget.checked,
                            },
                          },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Checkbox
                      size="xs"
                      label="Galileo"
                      checked={config.positioning.constellations.galileo}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          positioning: {
                            ...config.positioning,
                            constellations: {
                              ...config.positioning.constellations,
                              galileo: e.currentTarget.checked,
                            },
                          },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Checkbox
                      size="xs"
                      label="QZSS"
                      checked={config.positioning.constellations.qzss}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          positioning: {
                            ...config.positioning,
                            constellations: {
                              ...config.positioning.constellations,
                              qzss: e.currentTarget.checked,
                            },
                          },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Checkbox
                      size="xs"
                      label="SBAS"
                      checked={config.positioning.constellations.sbas}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          positioning: {
                            ...config.positioning,
                            constellations: {
                              ...config.positioning.constellations,
                              sbas: e.currentTarget.checked,
                            },
                          },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Checkbox
                      size="xs"
                      label="BeiDou"
                      checked={config.positioning.constellations.beidou}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          positioning: {
                            ...config.positioning,
                            constellations: {
                              ...config.positioning.constellations,
                              beidou: e.currentTarget.checked,
                            },
                          },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Checkbox
                      size="xs"
                      label="IRNSS"
                      checked={config.positioning.constellations.irnss}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          positioning: {
                            ...config.positioning,
                            constellations: {
                              ...config.positioning.constellations,
                              irnss: e.currentTarget.checked,
                            },
                          },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </Group>

                  <TextInput
                    size="xs"
                    label="Excluded Satellites"
                    placeholder="e.g., G04 G05 R09"
                    value={config.positioning.excludedSatellites}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          excludedSatellites: e.currentTarget.value,
                        },
                      })
                    }
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>

              {/* Group D: Advanced Options */}
              <Accordion variant="contained">
                <Accordion.Item value="advanced">
                  <Accordion.Control style={{ fontSize: '10px', padding: '6px 12px' }}>
                    Advanced Settings & Corrections
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <SimpleGrid cols={2} spacing="xs">
                        <Select
                          size="xs"
                          label="Earth Tides Correction"
                          value={config.positioning.earthTidesCorrection}
                          onChange={(value: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: {
                                ...config.positioning,
                                earthTidesCorrection: value as EarthTidesCorrection,
                              },
                            })
                          }
                          data={[
                            { value: 'off', label: 'OFF' },
                            { value: 'solid', label: 'Solid' },
                            { value: 'solid+otl', label: 'Solid+OTL' },
                            { value: 'solid+otl+pole', label: 'Solid+OTL+Pole' },
                          ]}
                          styles={{ label: { fontSize: '10px' } }}
                        />

                        <Select
                          size="xs"
                          label="Receiver Dynamics"
                          value={config.positioning.receiverDynamics}
                          onChange={(value: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: {
                                ...config.positioning,
                                receiverDynamics: value as ReceiverDynamics,
                              },
                            })
                          }
                          data={[
                            { value: 'off', label: 'OFF' },
                            { value: 'on', label: 'ON' },
                          ]}
                          disabled={!isReceiverDynamicsEnabled}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                      </SimpleGrid>

                      <Text size="xs" style={{ fontSize: '10px' }}>
                        Corrections & Options
                      </Text>
                      <Group gap="xs">
                        <Switch
                          size="xs"
                          label="Sat PCV"
                          checked={config.positioning.satellitePcv}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: {
                                ...config.positioning,
                                satellitePcv: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={!isPPP}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="Rec PCV"
                          checked={config.positioning.receiverPcv}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: {
                                ...config.positioning,
                                receiverPcv: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={!isPPP}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="Phase Windup"
                          checked={config.positioning.phaseWindup}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: {
                                ...config.positioning,
                                phaseWindup: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={!isPPP}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="Reject Eclipse"
                          checked={config.positioning.rejectEclipse}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: {
                                ...config.positioning,
                                rejectEclipse: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={!isPPP}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="RAIM FDE"
                          checked={config.positioning.raimFde}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              positioning: {
                                ...config.positioning,
                                raimFde: e.currentTarget.checked,
                              },
                            })
                          }
                          styles={{ label: { fontSize: '10px' } }}
                        />
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>

            </Stack>
          </Tabs.Panel>

          {/* Tab: Ambiguity */}
          <Tabs.Panel value="ambiguity" pt="xs">
            <Stack gap="xs">
              {/* Ambiguity Resolution */}
              <Fieldset legend="Ambiguity Resolution" style={{ fontSize: '10px' }}>
                <Select
                  size="xs"
                  label="AR Mode"
                  value={config.ambiguityResolution.mode}
                  onChange={(value: any) =>
                    handleConfigChange({
                      ...config,
                      ambiguityResolution: { ...config.ambiguityResolution, mode: value as ARMode },
                    })
                  }
                  data={[
                    { value: 'off', label: 'OFF' },
                    { value: 'continuous', label: 'Continuous' },
                    { value: 'instantaneous', label: 'Instantaneous' },
                    { value: 'fix-and-hold', label: 'Fix and Hold' },
                    { value: 'ppp-ar', label: 'PPP-AR' },
                  ]}
                  disabled={isSingle || isDGPS}
                  styles={{ label: { fontSize: '10px' } }}
                />
              </Fieldset>

              {/* AR Thresholds */}
              <Fieldset legend="AR Thresholds" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={3} spacing="xs">
                  <NumberInput
                    size="xs"
                    label="Ratio"
                    value={config.ambiguityResolution.ratio}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, ratio: Number(value) },
                      })
                    }
                    min={1}
                    max={10}
                    step={0.1}
                    decimalScale={1}
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="Elevation Mask (deg)"
                    value={config.ambiguityResolution.elevationMask}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, elevationMask: Number(value) },
                      })
                    }
                    min={0}
                    max={90}
                    hideControls
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="Hold Elevation (deg)"
                    value={config.ambiguityResolution.holdElevation}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, holdElevation: Number(value) },
                      })
                    }
                    min={0}
                    max={90}
                    hideControls
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </SimpleGrid>
              </Fieldset>

              {/* AR Counters */}
              <Fieldset legend="AR Counters" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={2} spacing="xs">
                  <NumberInput
                    size="xs"
                    label="Lock Count"
                    value={config.ambiguityResolution.lockCount}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, lockCount: Number(value) },
                      })
                    }
                    min={0}
                    hideControls
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="Min Fix"
                    value={config.ambiguityResolution.minFix}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, minFix: Number(value) },
                      })
                    }
                    min={0}
                    hideControls
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="Max Iterations"
                    value={config.ambiguityResolution.maxIterations}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, maxIterations: Number(value) },
                      })
                    }
                    min={1}
                    max={10}
                    hideControls
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="Out Count"
                    value={config.ambiguityResolution.outCount}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, outCount: Number(value) },
                      })
                    }
                    min={0}
                    step={1}
                    hideControls
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </SimpleGrid>
              </Fieldset>

              {/* Rejection */}
              <Fieldset legend="Rejection" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={2} spacing="xs">
                  <NumberInput
                    size="xs"
                    label="Innovation (m)"
                    value={config.rejection.innovation}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        rejection: { ...config.rejection, innovation: Number(value) },
                      })
                    }
                    min={0}
                    step={1}
                    hideControls
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="GDOP"
                    value={config.rejection.gdop}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        rejection: { ...config.rejection, gdop: Number(value) },
                      })
                    }
                    min={0}
                    step={1}
                    hideControls
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </SimpleGrid>
              </Fieldset>

              {/* Slip Detection */}
              <Fieldset legend="Slip Detection" style={{ fontSize: '10px' }}>
                <NumberInput
                  size="xs"
                  label="Threshold (m)"
                  value={config.slipDetection.threshold}
                  onChange={(value: any) =>
                    handleConfigChange({
                      ...config,
                      slipDetection: { ...config.slipDetection, threshold: Number(value) },
                    })
                  }
                  min={0}
                  step={0.001}
                  decimalScale={3}
                  hideControls
                  styles={{ label: { fontSize: '10px' } }}
                />
              </Fieldset>
            </Stack>
          </Tabs.Panel>

          {/* Tab: Output */}
          <Tabs.Panel value="output" pt="xs">
            <Stack gap="xs">
              {/* Group A: Format Configuration */}
              <Fieldset legend="Format Configuration" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <Select
                      size="xs"
                      label="Solution Format"
                      value={config.output.solutionFormat}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: {
                            ...config.output,
                            solutionFormat: value as SolutionFormat,
                          },
                        })
                      }
                      data={[
                        { value: 'llh', label: 'Lat/Lon/Height' },
                        { value: 'xyz', label: 'X/Y/Z-ECEF' },
                        { value: 'enu', label: 'E/N/U-Baseline' },
                        { value: 'nmea', label: 'NMEA-0183' },
                      ]}
                      styles={{ label: { fontSize: '10px' } }}
                    />

                    <div>
                      <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>
                        Header / Options / Velocity
                      </Text>
                      <Group gap="xs">
                        <Switch
                          size="xs"
                          label="Header"
                          checked={config.output.outputHeader}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              output: {
                                ...config.output,
                                outputHeader: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={isSolNMEA}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="Options"
                          checked={config.output.outputProcessingOptions}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              output: {
                                ...config.output,
                                outputProcessingOptions: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={isSolNMEA}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="Velocity"
                          checked={config.output.outputVelocity}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              output: {
                                ...config.output,
                                outputVelocity: e.currentTarget.checked,
                              },
                            })
                          }
                          styles={{ label: { fontSize: '10px' } }}
                        />
                      </Group>
                    </div>
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <Select
                      size="xs"
                      label="Time Format"
                      value={config.output.timeFormat}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, timeFormat: value as TimeFormat },
                        })
                      }
                      data={[
                        { value: 'gpst', label: 'ww ssss GPST' },
                        { value: 'gpst-hms', label: 'hh:mm:ss GPST' },
                        { value: 'utc', label: 'hh:mm:ss UTC' },
                        { value: 'jst', label: 'hh:mm:ss JST' },
                      ]}
                      disabled={isSolNMEA}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="# of Decimals"
                      value={config.output.numDecimals}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, numDecimals: Number(value) },
                        })
                      }
                      min={0}
                      max={12}
                      hideControls
                      disabled={isSolNMEA}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <Select
                      size="xs"
                      label="Latitude / Longitude Format"
                      value={config.output.latLonFormat}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, latLonFormat: value as LatLonFormat },
                        })
                      }
                      data={[
                        { value: 'ddd.ddddddd', label: 'ddd.ddddddd' },
                        { value: 'ddd-mm-ss.sss', label: 'ddd mm ss.sss' },
                      ]}
                      disabled={!isSolLLH}
                      styles={{ label: { fontSize: '10px' } }}
                    />

                    <TextInput
                      size="xs"
                      label="Field Separator"
                      placeholder="Space (default)"
                      value={config.output.fieldSeparator}
                      onChange={(e: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, fieldSeparator: e.currentTarget.value },
                        })
                      }
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>
                </Stack>
              </Fieldset>

              {/* Group B: Datum & Geoid */}
              <Fieldset legend="Datum & Geoid" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <Select
                      size="xs"
                      label="Datum"
                      value={config.output.datum}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, datum: value as Datum },
                        })
                      }
                      data={[
                        { value: 'wgs84', label: 'WGS84' },
                        { value: 'tokyo', label: 'Tokyo' },
                        { value: 'pz90.11', label: 'PZ-90.11' },
                      ]}
                      disabled={!isSolLLH}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Select
                      size="xs"
                      label="Height"
                      value={config.output.height}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, height: value as HeightType },
                        })
                      }
                      data={[
                        { value: 'ellipsoidal', label: 'Ellipsoidal' },
                        { value: 'geodetic', label: 'Geodetic' },
                      ]}
                      disabled={!isSolLLH}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <Select
                    size="xs"
                    label="Geoid Model"
                    value={config.output.geoidModel}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, geoidModel: value as GeoidModel },
                      })
                    }
                    data={[
                      { value: 'internal', label: 'Internal' },
                      { value: 'egm96', label: 'EGM96' },
                      { value: 'egm08', label: 'Earth Grav Model 2008' },
                      { value: 'gsi2000', label: 'GSI2000 (Japan)' },
                    ]}
                    disabled={isSingle}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>

              {/* Group C: Output Control */}
              <Fieldset legend="Output Control" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <Select
                    size="xs"
                    label="Solution for Static Mode"
                    value={config.output.staticSolutionMode}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, staticSolutionMode: value as StaticSolutionMode },
                      })
                    }
                    data={[
                      { value: 'all', label: 'All' },
                      { value: 'single', label: 'Single' },
                      { value: 'fixed', label: 'Fixed' },
                    ]}
                    disabled={!isStaticMode}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <Checkbox
                    size="xs"
                    label="Output Single if Sol Outage"
                    checked={config.output.outputSingleOnOutage}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        output: {
                          ...config.output,
                          outputSingleOnOutage: e.currentTarget.checked,
                        },
                      })
                    }
                    disabled={isSingle}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="NMEA Interval (s) - RMC/GGA"
                      value={config.output.nmeaIntervalRmcGga}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, nmeaIntervalRmcGga: Number(value) },
                        })
                      }
                      min={0}
                      step={1}
                      hideControls
                      disabled={!isSolNMEA}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="GSA/GSV"
                      value={config.output.nmeaIntervalGsaGsv}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, nmeaIntervalGsaGsv: Number(value) },
                        })
                      }
                      min={0}
                      step={1}
                      hideControls
                      disabled={!isSolNMEA}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <Select
                      size="xs"
                      label="Output Sol Status"
                      value={config.output.outputSolutionStatus}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, outputSolutionStatus: value as DebugTraceLevel },
                        })
                      }
                      data={[
                        { value: 'off', label: 'OFF' },
                        { value: 'level1', label: 'State' },
                        { value: 'level2', label: 'Residual' },
                      ]}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Select
                      size="xs"
                      label="Debug Trace"
                      value={config.output.debugTrace}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          output: { ...config.output, debugTrace: value as DebugTraceLevel },
                        })
                      }
                      data={[
                        { value: 'off', label: 'OFF' },
                        { value: 'level1', label: 'Level 1' },
                        { value: 'level2', label: 'Level 2' },
                        { value: 'level3', label: 'Level 3' },
                        { value: 'level4', label: 'Level 4' },
                        { value: 'level5', label: 'Level 5' },
                      ]}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>
                </Stack>
              </Fieldset>
            </Stack>
          </Tabs.Panel>

          {/* Tab: Kalman Filter */}
          <Tabs.Panel value="kalman" pt="xs">
            <Stack gap="xs">
              {/* Filter Settings */}
              <Fieldset legend="Filter Settings" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={2} spacing="xs">
                  <NumberInput
                    size="xs"
                    label="Iterations"
                    value={config.kalmanFilter.iterations}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: { ...config.kalmanFilter, iterations: Number(value) },
                      })
                    }
                    min={1}
                    max={10}
                    hideControls
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <Checkbox
                    size="xs"
                    label="Sync Solution"
                    checked={config.kalmanFilter.syncSolution}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: { ...config.kalmanFilter, syncSolution: e.currentTarget.checked },
                      })
                    }
                    styles={{ label: { fontSize: '10px' }, root: { marginTop: '20px' } }}
                  />
                </SimpleGrid>
              </Fieldset>

              {/* Measurement Error */}
              <Fieldset legend="Measurement Errors (1-sigma)" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Code/Phase Ratio L1"
                      value={config.kalmanFilter.measurementError.codePhaseRatioL1}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          kalmanFilter: {
                            ...config.kalmanFilter,
                            measurementError: {
                              ...config.kalmanFilter.measurementError,
                              codePhaseRatioL1: Number(value),
                            },
                          },
                        })
                      }
                      min={0}
                      step={1}
                      decimalScale={1}
                      hideControls
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="L2"
                      value={config.kalmanFilter.measurementError.codePhaseRatioL2}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          kalmanFilter: {
                            ...config.kalmanFilter,
                            measurementError: {
                              ...config.kalmanFilter.measurementError,
                              codePhaseRatioL2: Number(value),
                            },
                          },
                        })
                      }
                      min={0}
                      step={1}
                      decimalScale={1}
                      hideControls
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Phase Error a (m)"
                      value={config.kalmanFilter.measurementError.phase}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          kalmanFilter: {
                            ...config.kalmanFilter,
                            measurementError: {
                              ...config.kalmanFilter.measurementError,
                              phase: Number(value),
                            },
                          },
                        })
                      }
                      min={0}
                      step={0.001}
                      decimalScale={3}
                      hideControls
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="b/sinEl (m)"
                      value={config.kalmanFilter.measurementError.phaseElevation}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          kalmanFilter: {
                            ...config.kalmanFilter,
                            measurementError: {
                              ...config.kalmanFilter.measurementError,
                              phaseElevation: Number(value),
                            },
                          },
                        })
                      }
                      min={0}
                      step={0.001}
                      decimalScale={3}
                      hideControls
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <NumberInput
                    size="xs"
                    label="Phase Error/Baseline (m/10km)"
                    value={config.kalmanFilter.measurementError.phaseBaseline}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: {
                          ...config.kalmanFilter,
                          measurementError: {
                            ...config.kalmanFilter.measurementError,
                            phaseBaseline: Number(value),
                          },
                        },
                      })
                    }
                    min={0}
                    step={0.001}
                    decimalScale={3}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <NumberInput
                    size="xs"
                    label="Doppler Frequency (Hz)"
                    value={config.kalmanFilter.measurementError.doppler}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: {
                          ...config.kalmanFilter,
                          measurementError: {
                            ...config.kalmanFilter.measurementError,
                            doppler: Number(value),
                          },
                        },
                      })
                    }
                    min={0}
                    step={0.1}
                    decimalScale={1}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>

              {/* Process Noise */}
              <Fieldset legend="Process Noises (1-sigma/sqrt(s))" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Receiver Accel Horiz (m/s\u00B2)"
                      value={config.kalmanFilter.processNoise.accelH}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          kalmanFilter: {
                            ...config.kalmanFilter,
                            processNoise: {
                              ...config.kalmanFilter.processNoise,
                              accelH: Number(value),
                            },
                          },
                        })
                      }
                      min={0}
                      step={0.1}
                      decimalScale={1}
                      hideControls
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="Vertical (m/s\u00B2)"
                      value={config.kalmanFilter.processNoise.accelV}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          kalmanFilter: {
                            ...config.kalmanFilter,
                            processNoise: {
                              ...config.kalmanFilter.processNoise,
                              accelV: Number(value),
                            },
                          },
                        })
                      }
                      min={0}
                      step={0.01}
                      decimalScale={2}
                      hideControls
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <NumberInput
                    size="xs"
                    label="Carrier-Phase Bias (cycle)"
                    value={config.kalmanFilter.processNoise.bias}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: {
                          ...config.kalmanFilter,
                          processNoise: {
                            ...config.kalmanFilter.processNoise,
                            bias: Number(value),
                          },
                        },
                      })
                    }
                    min={0}
                    step={0.0001}
                    decimalScale={4}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <NumberInput
                    size="xs"
                    label="Vertical Ionospheric Delay (m/10km)"
                    value={config.kalmanFilter.processNoise.ionosphere}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: {
                          ...config.kalmanFilter,
                          processNoise: {
                            ...config.kalmanFilter.processNoise,
                            ionosphere: Number(value),
                          },
                        },
                      })
                    }
                    min={0}
                    step={0.001}
                    decimalScale={3}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <NumberInput
                    size="xs"
                    label="Zenith Tropospheric Delay (m)"
                    value={config.kalmanFilter.processNoise.troposphere}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: {
                          ...config.kalmanFilter,
                          processNoise: {
                            ...config.kalmanFilter.processNoise,
                            troposphere: Number(value),
                          },
                        },
                      })
                    }
                    min={0}
                    step={0.0001}
                    decimalScale={4}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <NumberInput
                    size="xs"
                    label="Satellite Clock Stability (s/s)"
                    value={config.kalmanFilter.processNoise.clockStability}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: {
                          ...config.kalmanFilter,
                          processNoise: {
                            ...config.kalmanFilter.processNoise,
                            clockStability: Number(value),
                          },
                        },
                      })
                    }
                    min={0}
                    step={1e-12}
                    decimalScale={12}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>
            </Stack>
          </Tabs.Panel>

          {/* Tab: Antenna */}
          <Tabs.Panel value="antenna" pt="xs">
            <Stack gap="xs">
              <StationPositionInput
                label="Rover Station"
                value={config.antenna.rover}
                onChange={(newRover) =>
                  handleConfigChange({
                    ...config,
                    antenna: { ...config.antenna, rover: newRover },
                  })
                }
                disableCoordinates={!isFixedMode}
                disableAntenna={isSingle}
              />

              <StationPositionInput
                label="Base Station"
                value={config.antenna.base}
                onChange={(newBase) =>
                  handleConfigChange({
                    ...config,
                    antenna: { ...config.antenna, base: newBase },
                  })
                }
                disabled={isSingle}
              />

              <FileInputRow
                label="Station Position File"
                placeholder="Path to station position file"
                value={config.files.stationPos}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, stationPos: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, stationPos: path },
                  })
                )}
              />
            </Stack>
          </Tabs.Panel>

          {/* Tab: Files */}
          <Tabs.Panel value="files" pt="xs">
            <Stack gap="xs">
              {/* Satellite Antenna PCV File (ANTEX) */}
              <FileInputRow
                label="Satellite Antenna PCV File (ANTEX)"
                value={config.files.satelliteAtx}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, satelliteAtx: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, satelliteAtx: path } })
                )}
              />

              {/* Receiver Antenna PCV File (ANTEX) */}
              <FileInputRow
                label="Receiver Antenna PCV File (ANTEX)"
                value={config.files.receiverAtx}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, receiverAtx: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, receiverAtx: path } })
                )}
              />

              {/* Geoid Data File */}
              <FileInputRow
                label="Geoid Data File"
                value={config.files.geoid}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, geoid: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, geoid: path } })
                )}
              />

              {/* DCB Data File */}
              <FileInputRow
                label="DCB Data File"
                value={config.files.dcb}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, dcb: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, dcb: path } })
                )}
              />

              {/* EOP Data File */}
              <FileInputRow
                label="EOP Data File"
                value={config.files.eop}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, eop: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, eop: path } })
                )}
              />

              {/* Ocean Loading (BLQ) File */}
              <FileInputRow
                label="Ocean Loading (BLQ) File"
                value={config.files.oceanLoading}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, oceanLoading: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, oceanLoading: path } })
                )}
              />

              {/* Ionosphere Data File */}
              <FileInputRow
                label="Ionosphere Data File"
                value={config.files.ionosphere}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, ionosphere: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, ionosphere: path } })
                )}
              />

            </Stack>
          </Tabs.Panel>

          {/* Tab: CLAS */}
          <Tabs.Panel value="clas" pt="xs">
            <Stack gap="xs">
              <Fieldset legend="CLAS PPP-RTK" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={3} spacing="xs">
                  <NumberInput
                    size="xs"
                    label="Grid Selection Radius (m)"
                    value={config.positioning.clas.gridSelectionRadius}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          clas: { ...config.positioning.clas, gridSelectionRadius: Number(value) || 0 },
                        },
                      })
                    }
                    min={0}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <TextInput
                    size="xs"
                    label="Receiver Type"
                    value={config.positioning.clas.receiverType}
                    onChange={(e) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          clas: { ...config.positioning.clas, receiverType: e.currentTarget.value },
                        },
                      })
                    }
                    placeholder="e.g. Trimble NetR9"
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </SimpleGrid>
                <SimpleGrid cols={3} spacing="xs" mt="xs">
                  <NumberInput
                    size="xs"
                    label="Position Uncertainty X (m)"
                    value={config.positioning.clas.positionUncertaintyX}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          clas: { ...config.positioning.clas, positionUncertaintyX: Number(value) || 0 },
                        },
                      })
                    }
                    min={0}
                    decimalScale={1}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="Position Uncertainty Y (m)"
                    value={config.positioning.clas.positionUncertaintyY}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          clas: { ...config.positioning.clas, positionUncertaintyY: Number(value) || 0 },
                        },
                      })
                    }
                    min={0}
                    decimalScale={1}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <NumberInput
                    size="xs"
                    label="Position Uncertainty Z (m)"
                    value={config.positioning.clas.positionUncertaintyZ}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          clas: { ...config.positioning.clas, positionUncertaintyZ: Number(value) || 0 },
                        },
                      })
                    }
                    min={0}
                    decimalScale={1}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </SimpleGrid>
              </Fieldset>
              <Fieldset legend="CLAS Files" style={{ fontSize: '10px' }}>
                <FileInputRow
                  label="CSSR Grid Definition File"
                  value={config.files.cssrGrid}
                  onChange={(val) =>
                    handleConfigChange({
                      ...config,
                      files: { ...config.files, cssrGrid: val },
                    })
                  }
                  onBrowse={() => openFileBrowser((path) =>
                    handleConfigChange({ ...config, files: { ...config.files, cssrGrid: path } })
                  )}
                />
              </Fieldset>
            </Stack>
          </Tabs.Panel>

          {/* Tab: Server */}
          <Tabs.Panel value="server" pt="xs">
            <Stack gap="xs">
              {/* Server Options */}
              <Fieldset legend="Server Options" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <Select
                    size="xs"
                    label="Time Interpolation of Base Station Data"
                    value={config.server.timeInterpolation ? 'on' : 'off'}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          timeInterpolation: value === 'on',
                        },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'on', label: 'ON' },
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <NumberInput
                    size="xs"
                    label="SBAS Satellite Selection (0: All)"
                    value={config.server.sbasSatellite}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          sbasSatellite: Number(value),
                        },
                      })
                    }
                    min={0}
                    max={255}
                    step={1}
                    hideControls
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>

              {/* RINEX Reading Options */}
              <Fieldset legend="RINEX Reading Options" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <TextInput
                    size="xs"
                    label="RINEX Opt (Rover)"
                    placeholder="-E -GL ..."
                    value={config.server.rinexOption1}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          rinexOption1: e.currentTarget.value,
                        },
                      })
                    }
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <TextInput
                    size="xs"
                    label="RINEX Opt (Base)"
                    placeholder="-E -GL ..."
                    value={config.server.rinexOption2}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          rinexOption2: e.currentTarget.value,
                        },
                      })
                    }
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>
            </Stack>
          </Tabs.Panel>

          {/* Tab: Time */}
        </Tabs>
      </Stack>
    </Card>

      <SnrMaskModal
        opened={snrMaskModalOpened}
        onClose={() => setSnrMaskModalOpened(false)}
        value={config.positioning.snrMask}
        onChange={(newSnrMask: SnrMaskConfig) =>
          handleConfigChange({
            ...config,
            positioning: { ...config.positioning, snrMask: newSnrMask },
          })
        }
      />

      <FileBrowserModal
        opened={fileBrowserOpened}
        onClose={() => setFileBrowserOpened(false)}
        onSelect={handleFileBrowserSelect}
        title="Select File"
      />
    </>
  );
}
