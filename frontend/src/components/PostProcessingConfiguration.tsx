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
} from '@mantine/core';
import {
  IconAdjustments,
  IconAdjustmentsHorizontal,
  IconChartLine,
  IconClock,
  IconDatabaseExport,
  IconDots,
  IconFolderOpen,
  IconMapPin,
  IconInfoCircle,
} from '@tabler/icons-react';
import type {
  Rnx2RtkpConfig,
  PositioningMode,
  Frequency,
  FilterType,
  IonosphereCorrection,
  TroposphereCorrection,
  EphemerisOption,
  EarthTidesCorrection,
  ReceiverDynamics,
  GpsArMode,
  GloArMode,
  BdsArMode,
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
} from '../types/rnx2rtkpConfig';
import { DEFAULT_RNX2RTKP_CONFIG } from '../types/rnx2rtkpConfig';
import { SnrMaskModal } from './SnrMaskModal';
import { FileBrowserModal } from './FileBrowserModal';

interface PostProcessingConfigurationProps {
  onConfigChange: (config: Rnx2RtkpConfig) => void;
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
              onChange({ ...value, values: [Number(val), value.values[1], value.values[2]] })
            }
            disabled={coordsDisabled || !isManualInput}
            step={value.mode === 'xyz' ? 0.0001 : 0.000000001}
            decimalScale={value.mode === 'xyz' ? 4 : 9}
            hideControls
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label={coordinateLabels[1]}
            value={value.values[1]}
            onChange={(val: any) =>
              onChange({ ...value, values: [value.values[0], Number(val), value.values[2]] })
            }
            disabled={coordsDisabled || !isManualInput}
            step={value.mode === 'xyz' ? 0.0001 : 0.000000001}
            decimalScale={value.mode === 'xyz' ? 4 : 9}
            hideControls
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label={coordinateLabels[2]}
            value={value.values[2]}
            onChange={(val: any) =>
              onChange({ ...value, values: [value.values[0], value.values[1], Number(val)] })
            }
            disabled={coordsDisabled || !isManualInput}
            step={0.0001}
            decimalScale={4}
            hideControls
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>

        <Checkbox
          size="xs"
          label="Antenna Type"
          checked={value.antennaTypeEnabled}
          onChange={(e: any) => onChange({ ...value, antennaTypeEnabled: e.currentTarget.checked })}
          disabled={antennaDisabled}
          styles={{ label: { fontSize: '10px' } }}
        />

        {value.antennaTypeEnabled && (
          <TextInput
            size="xs"
            placeholder="Antenna type identifier"
            value={value.antennaType}
            onChange={(e: any) => onChange({ ...value, antennaType: e.currentTarget.value })}
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
        )}

        <Text size="xs" style={{ fontSize: '10px', marginTop: '4px' }}>
          Antenna Delta (m)
        </Text>
        <SimpleGrid cols={3} spacing="xs">
          <NumberInput
            size="xs"
            label="E"
            value={value.antennaDelta[0]}
            onChange={(val: any) =>
              onChange({
                ...value,
                antennaDelta: [Number(val), value.antennaDelta[1], value.antennaDelta[2]],
              })
            }
            step={0.001}
            decimalScale={3}
            hideControls
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="N"
            value={value.antennaDelta[1]}
            onChange={(val: any) =>
              onChange({
                ...value,
                antennaDelta: [value.antennaDelta[0], Number(val), value.antennaDelta[2]],
              })
            }
            step={0.001}
            decimalScale={3}
            hideControls
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
          <NumberInput
            size="xs"
            label="U"
            value={value.antennaDelta[2]}
            onChange={(val: any) =>
              onChange({
                ...value,
                antennaDelta: [value.antennaDelta[0], value.antennaDelta[1], Number(val)],
              })
            }
            step={0.001}
            decimalScale={3}
            hideControls
            disabled={antennaDisabled}
            styles={{ label: { fontSize: '10px' } }}
          />
        </SimpleGrid>
      </Stack>
    </Fieldset>
  );
}

function FileInputRow({ label, value, onChange, placeholder, onBrowse }: FileInputRowProps) {
  return (
    <div>
      {label && (
        <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>
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
}: PostProcessingConfigurationProps) {
  const [config, setConfig] = useLocalStorage<Rnx2RtkpConfig>({
    key: 'rtklib-web-ui-rnx2rtkp-config-v13', // v13: Added Time tab (start/end time, interval)
    defaultValue: DEFAULT_RNX2RTKP_CONFIG,
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
  const isSingle = config.setting1.positioningMode === 'single';
  const isDGPS = config.setting1.positioningMode === 'dgps';
  const isPPP = ['ppp-kinematic', 'ppp-static', 'ppp-fixed'].includes(config.setting1.positioningMode);
  const isGpsFixAndHold = config.setting2.gpsArMode === 'fix-and-hold';
  const isPppAr = config.setting2.gpsArMode === 'ppp-ar';
  const isReceiverDynamicsEnabled =
    config.setting1.positioningMode === 'kinematic' ||
    config.setting1.positioningMode === 'ppp-kinematic';

  // Output tab conditional logic
  const isStaticMode = ['static', 'ppp-static'].includes(config.setting1.positioningMode);
  const isSolLLH = config.output.solutionFormat === 'llh';
  const isSolNMEA = config.output.solutionFormat === 'nmea';

  // Positions tab conditional logic
  const isFixedMode = ['fixed', 'ppp-fixed'].includes(config.setting1.positioningMode);

  // Sync config to parent whenever it changes, including initial localStorage load.
  // Without this, the parent keeps the default config (kinematic) even if the user
  // previously saved a different mode (e.g., single) in localStorage.
  useEffect(() => {
    onConfigChange(config);
  }, [config, onConfigChange]);

  const handleConfigChange = (newConfig: Rnx2RtkpConfig) => {
    setConfig(newConfig);
  };

  return (
    <>
    <Card withBorder p="xs">
      <Stack gap="xs">
        <Title order={6} size="xs">
          Processing Configuration
        </Title>

        <Tabs defaultValue="setting1">
          <Tabs.List>
            <Tabs.Tab value="setting1" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconAdjustments size={14} />}>
              Setting 1
            </Tabs.Tab>
            <Tabs.Tab value="setting2" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconAdjustmentsHorizontal size={14} />}>
              Setting 2
            </Tabs.Tab>
            <Tabs.Tab value="output" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconDatabaseExport size={14} />}>
              Output
            </Tabs.Tab>
            <Tabs.Tab value="stats" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconChartLine size={14} />}>
              Stats
            </Tabs.Tab>
            <Tabs.Tab value="positions" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconMapPin size={14} />}>
              Positions
            </Tabs.Tab>
            <Tabs.Tab value="files" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconFolderOpen size={14} />}>
              Files
            </Tabs.Tab>
            <Tabs.Tab value="misc" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconDots size={14} />}>
              Misc
            </Tabs.Tab>
            <Tabs.Tab value="time" style={{ fontSize: '11px', padding: '6px 12px' }} leftSection={<IconClock size={14} />}>
              Time
            </Tabs.Tab>
          </Tabs.List>

          {/* Tab 1: Setting 1 */}
          <Tabs.Panel value="setting1" pt="xs">
            <Stack gap="xs">
              {/* Group A: Basic Strategy */}
              <Fieldset legend="Basic Strategy" style={{ fontSize: '10px' }}>
                <SimpleGrid cols={3} spacing="xs">
                  <Select
                    size="xs"
                    label="Positioning Mode"
                    value={config.setting1.positioningMode}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        setting1: {
                          ...config.setting1,
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
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <div>
                    <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>
                      Frequencies
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                      <Select
                        size="xs"
                        value={config.setting1.frequency}
                        onChange={(value: any) =>
                          handleConfigChange({
                            ...config,
                            setting1: { ...config.setting1, frequency: value as Frequency },
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
                                <Table.Th style={{ fontSize: '9px', padding: '4px' }}></Table.Th>
                                <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L1</Table.Th>
                                <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L2</Table.Th>
                                <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L3</Table.Th>
                                <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L4</Table.Th>
                                <Table.Th style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L5</Table.Th>
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
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>G1/a</Table.Td>
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>G2/a</Table.Td>
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
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>E5a+b</Table.Td>
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
                              <Table.Tr>
                                <Table.Td style={{ fontSize: '9px', padding: '4px' }}>SBAS</Table.Td>
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L1</Table.Td>
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>L5</Table.Td>
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                                <Table.Td style={{ fontSize: '9px', padding: '4px', textAlign: 'center' }}>-</Table.Td>
                              </Table.Tr>
                            </Table.Tbody>
                          </Table>
                        </HoverCard.Dropdown>
                      </HoverCard>
                    </Group>
                  </div>

                  <Select
                    size="xs"
                    label="Filter Type"
                    value={config.setting1.filterType}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        setting1: { ...config.setting1, filterType: value as FilterType },
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
                    value={config.setting1.elevationMask}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        setting1: {
                          ...config.setting1,
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
                    value={config.setting1.ionosphereCorrection}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        setting1: {
                          ...config.setting1,
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
                      { value: 'qzs-brdc', label: 'QZSS Broadcast' },
                    ]}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <Select
                    size="xs"
                    label="Troposphere Correction"
                    value={config.setting1.troposphereCorrection}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        setting1: {
                          ...config.setting1,
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

                  <Select
                    size="xs"
                    label="Satellite Ephemeris/Clock"
                    value={config.setting1.ephemerisOption}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        setting1: {
                          ...config.setting1,
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
                      checked={config.setting1.constellations.gps}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          setting1: {
                            ...config.setting1,
                            constellations: {
                              ...config.setting1.constellations,
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
                      checked={config.setting1.constellations.glonass}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          setting1: {
                            ...config.setting1,
                            constellations: {
                              ...config.setting1.constellations,
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
                      checked={config.setting1.constellations.galileo}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          setting1: {
                            ...config.setting1,
                            constellations: {
                              ...config.setting1.constellations,
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
                      checked={config.setting1.constellations.qzss}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          setting1: {
                            ...config.setting1,
                            constellations: {
                              ...config.setting1.constellations,
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
                      checked={config.setting1.constellations.sbas}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          setting1: {
                            ...config.setting1,
                            constellations: {
                              ...config.setting1.constellations,
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
                      checked={config.setting1.constellations.beidou}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          setting1: {
                            ...config.setting1,
                            constellations: {
                              ...config.setting1.constellations,
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
                      checked={config.setting1.constellations.irnss}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          setting1: {
                            ...config.setting1,
                            constellations: {
                              ...config.setting1.constellations,
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
                    value={config.setting1.excludedSatellites}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        setting1: {
                          ...config.setting1,
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
                          value={config.setting1.earthTidesCorrection}
                          onChange={(value: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
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
                          disabled={isSingle}
                          styles={{ label: { fontSize: '10px' } }}
                        />

                        <Select
                          size="xs"
                          label="Receiver Dynamics"
                          value={config.setting1.receiverDynamics}
                          onChange={(value: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
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
                          checked={config.setting1.satellitePcv}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
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
                          checked={config.setting1.receiverPcv}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
                                receiverPcv: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={!isPPP}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="PhWU"
                          checked={config.setting1.phaseWindup}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
                                phaseWindup: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={!isPPP}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="Rej Ecl"
                          checked={config.setting1.rejectEclipse}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
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
                          checked={config.setting1.raimFde}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
                                raimFde: e.currentTarget.checked,
                              },
                            })
                          }
                          styles={{ label: { fontSize: '10px' } }}
                        />
                        <Switch
                          size="xs"
                          label="DBCorr"
                          checked={config.setting1.dbCorr}
                          onChange={(e: any) =>
                            handleConfigChange({
                              ...config,
                              setting1: {
                                ...config.setting1,
                                dbCorr: e.currentTarget.checked,
                              },
                            })
                          }
                          disabled={!isPPP}
                          styles={{ label: { fontSize: '10px' } }}
                        />
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          </Tabs.Panel>

          {/* Tab 2: Setting 2 */}
          <Tabs.Panel value="setting2" pt="xs">
            <Stack gap="xs">
              {/* Section A: Ambiguity Resolution Strategy */}
              <Fieldset legend="Ambiguity Resolution Strategy" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <Text size="xs" style={{ fontSize: '10px' }}>
                    Integer Ambiguity Res (GPS/GLO/BDS)
                  </Text>
                  <SimpleGrid cols={3} spacing="xs">
                    <Select
                      size="xs"
                      label="GPS"
                      value={config.setting2.gpsArMode}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, gpsArMode: value as GpsArMode },
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

                    <Select
                      size="xs"
                      label="GLO"
                      value={config.setting2.gloArMode}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, gloArMode: value as GloArMode },
                        })
                      }
                      data={[
                        { value: 'off', label: 'OFF' },
                        { value: 'on', label: 'ON' },
                        { value: 'autocal', label: 'Autocal' },
                      ]}
                      disabled={isSingle || isDGPS || !config.setting1.constellations.glonass}
                      styles={{ label: { fontSize: '10px' } }}
                    />

                    <Select
                      size="xs"
                      label="BDS"
                      value={config.setting2.bdsArMode}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, bdsArMode: value as BdsArMode },
                        })
                      }
                      data={[
                        { value: 'off', label: 'OFF' },
                        { value: 'on', label: 'ON' },
                      ]}
                      disabled={isSingle || isDGPS || !config.setting1.constellations.beidou}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <NumberInput
                    size="xs"
                    label="Min Ratio to Fix Ambiguity"
                    value={config.setting2.minRatioToFix}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        setting2: { ...config.setting2, minRatioToFix: Number(value) },
                      })
                    }
                    min={1}
                    max={10}
                    step={0.1}
                    decimalScale={1}
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>

              {/* Section B: Thresholds & Validation */}
              <Fieldset legend="Thresholds & Validation" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Min Confidence"
                      value={config.setting2.minConfidence}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, minConfidence: Number(value) },
                        })
                      }
                      min={0}
                      max={1}
                      step={0.0001}
                      decimalScale={4}
                      hideControls
                      disabled={isSingle || isDGPS || isPppAr}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="Max FCB"
                      value={config.setting2.maxFcb}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, maxFcb: Number(value) },
                        })
                      }
                      min={0}
                      step={0.01}
                      decimalScale={2}
                      hideControls
                      disabled={isSingle || isDGPS || !isPppAr}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Min Lock to Fix Amb"
                      value={config.setting2.minLockToFix}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, minLockToFix: Number(value) },
                        })
                      }
                      min={0}
                      hideControls
                      disabled={isSingle || isDGPS}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="Elevation (°) to Fix Amb"
                      value={config.setting2.minElevationToFix}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, minElevationToFix: Number(value) },
                        })
                      }
                      min={0}
                      max={90}
                      hideControls
                      disabled={isSingle || isDGPS}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Min Fix to Hold Amb"
                      value={config.setting2.minFixToHold}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, minFixToHold: Number(value) },
                        })
                      }
                      min={0}
                      hideControls
                      disabled={isSingle || isDGPS || !isGpsFixAndHold}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="Elevation (°) to Hold Amb"
                      value={config.setting2.minElevationToHold}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, minElevationToHold: Number(value) },
                        })
                      }
                      min={0}
                      max={90}
                      hideControls
                      disabled={isSingle || isDGPS || !isGpsFixAndHold}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Outage to Reset Amb"
                      value={config.setting2.outageToReset}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, outageToReset: Number(value) },
                        })
                      }
                      min={0}
                      step={1}
                      hideControls
                      disabled={isSingle || isDGPS}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="Slip Threshold (m)"
                      value={config.setting2.slipThreshold}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, slipThreshold: Number(value) },
                        })
                      }
                      min={0}
                      step={0.001}
                      decimalScale={3}
                      hideControls
                      disabled={isSingle || isDGPS}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Max Age of Diff (s)"
                      value={config.setting2.maxAgeDiff}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, maxAgeDiff: Number(value) },
                        })
                      }
                      min={0}
                      step={1}
                      hideControls
                      disabled={isSingle || isDGPS}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <Checkbox
                      size="xs"
                      label="Sync Solution"
                      checked={config.setting2.syncSolution}
                      onChange={(e: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, syncSolution: e.currentTarget.checked },
                        })
                      }
                      disabled={!isPPP}
                      styles={{ label: { fontSize: '10px' }, root: { marginTop: '20px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Reject Threshold of GDOP"
                      value={config.setting2.rejectThresholdGdop}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, rejectThresholdGdop: Number(value) },
                        })
                      }
                      min={0}
                      step={1}
                      hideControls
                      styles={{ label: { fontSize: '10px' } }}
                    />
                    <NumberInput
                      size="xs"
                      label="Innov (m)"
                      value={config.setting2.rejectThresholdInnovation}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, rejectThresholdInnovation: Number(value) },
                        })
                      }
                      min={0}
                      step={1}
                      hideControls
                      disabled={isSingle}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Max # AR Iter"
                      value={config.setting2.maxArIter}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, maxArIter: Number(value) },
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
                      label="Filter Iter"
                      value={config.setting2.numFilterIterations}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          setting2: { ...config.setting2, numFilterIterations: Number(value) },
                        })
                      }
                      min={1}
                      max={10}
                      hideControls
                      disabled={isSingle}
                      styles={{ label: { fontSize: '10px' } }}
                    />
                  </SimpleGrid>
                </Stack>
              </Fieldset>

              {/* Section C: Advanced Filter */}
              <Fieldset legend="Advanced Filter" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <Checkbox
                    size="xs"
                    label="Baseline Length Constraint"
                    checked={config.setting2.baselineLengthConstraint.enabled}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        setting2: {
                          ...config.setting2,
                          baselineLengthConstraint: {
                            ...config.setting2.baselineLengthConstraint,
                            enabled: e.currentTarget.checked,
                          },
                        },
                      })
                    }
                    disabled={isSingle || isDGPS}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  {config.setting2.baselineLengthConstraint.enabled && (
                    <SimpleGrid cols={2} spacing="xs">
                      <NumberInput
                        size="xs"
                        label="Length (m)"
                        value={config.setting2.baselineLengthConstraint.length}
                        onChange={(value: any) =>
                          handleConfigChange({
                            ...config,
                            setting2: {
                              ...config.setting2,
                              baselineLengthConstraint: {
                                ...config.setting2.baselineLengthConstraint,
                                length: Number(value),
                              },
                            },
                          })
                        }
                        min={0}
                        step={0.001}
                        decimalScale={3}
                        disabled={isSingle || isDGPS}
                        styles={{ label: { fontSize: '10px' } }}
                      />
                      <NumberInput
                        size="xs"
                        label="Sigma (m)"
                        value={config.setting2.baselineLengthConstraint.sigma}
                        onChange={(value: any) =>
                          handleConfigChange({
                            ...config,
                            setting2: {
                              ...config.setting2,
                              baselineLengthConstraint: {
                                ...config.setting2.baselineLengthConstraint,
                                sigma: Number(value),
                              },
                            },
                          })
                        }
                        min={0}
                        step={0.001}
                        decimalScale={3}
                        disabled={isSingle || isDGPS}
                        styles={{ label: { fontSize: '10px' } }}
                      />
                    </SimpleGrid>
                  )}
                </Stack>
              </Fieldset>
            </Stack>
          </Tabs.Panel>

          {/* Tab 3: Output */}
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

          {/* Tab 4: Stats */}
          <Tabs.Panel value="stats" pt="xs">
            <Stack gap="xs">
              {/* Group A: Measurement Errors (1-sigma) */}
              <Fieldset legend="Measurement Errors (1-sigma)" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Code/Phase Ratio L1"
                      value={config.stats.codePhaseRatioL1}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          stats: { ...config.stats, codePhaseRatioL1: Number(value) },
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
                      value={config.stats.codePhaseRatioL2}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          stats: { ...config.stats, codePhaseRatioL2: Number(value) },
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
                      value={config.stats.phaseErrorA}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          stats: { ...config.stats, phaseErrorA: Number(value) },
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
                      value={config.stats.phaseErrorB}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          stats: { ...config.stats, phaseErrorB: Number(value) },
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
                    value={config.stats.phaseErrorBaseline}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        stats: { ...config.stats, phaseErrorBaseline: Number(value) },
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
                    value={config.stats.dopplerFrequency}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        stats: { ...config.stats, dopplerFrequency: Number(value) },
                      })
                    }
                    min={0}
                    step={0.1}
                    decimalScale={1}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Stack>
              </Fieldset>

              {/* Group B: Process Noises (1-sigma/sqrt(s)) */}
              <Fieldset legend="Process Noises (1-sigma/sqrt(s))" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <SimpleGrid cols={2} spacing="xs">
                    <NumberInput
                      size="xs"
                      label="Receiver Accel Horiz (m/s²)"
                      value={config.stats.receiverAccelHoriz}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          stats: { ...config.stats, receiverAccelHoriz: Number(value) },
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
                      label="Vertical (m/s²)"
                      value={config.stats.receiverAccelVert}
                      onChange={(value: any) =>
                        handleConfigChange({
                          ...config,
                          stats: { ...config.stats, receiverAccelVert: Number(value) },
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
                    value={config.stats.carrierPhaseBias}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        stats: { ...config.stats, carrierPhaseBias: Number(value) },
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
                    value={config.stats.ionosphericDelay}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        stats: { ...config.stats, ionosphericDelay: Number(value) },
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
                    value={config.stats.troposphericDelay}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        stats: { ...config.stats, troposphericDelay: Number(value) },
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
                    value={config.stats.satelliteClockStability}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        stats: { ...config.stats, satelliteClockStability: Number(value) },
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

          {/* Tab 5: Positions */}
          <Tabs.Panel value="positions" pt="xs">
            <Stack gap="xs">
              <StationPositionInput
                label="Rover Station"
                value={config.positions.rover}
                onChange={(newRover) =>
                  handleConfigChange({
                    ...config,
                    positions: { ...config.positions, rover: newRover },
                  })
                }
                disableCoordinates={!isFixedMode}
                disableAntenna={isSingle}
              />

              <StationPositionInput
                label="Base Station"
                value={config.positions.base}
                onChange={(newBase) =>
                  handleConfigChange({
                    ...config,
                    positions: { ...config.positions, base: newBase },
                  })
                }
                disabled={isSingle}
              />

              <FileInputRow
                label="Station Position File"
                placeholder="Path to station position file"
                value={config.positions.stationPositionFile}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    positions: { ...config.positions, stationPositionFile: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({
                    ...config,
                    positions: { ...config.positions, stationPositionFile: path },
                  })
                )}
              />
            </Stack>
          </Tabs.Panel>

          {/* Tab 6: Files */}
          <Tabs.Panel value="files" pt="xs">
            <Stack gap="xs">
              {/* Satellite/Receiver Antenna PCV File (ANTEX) */}
              <div>
                <Text size="xs" fw={500} mb="xs" style={{ fontSize: '10px' }}>
                  Satellite/Receiver Antenna PCV File (ANTEX)
                </Text>
                <Stack gap="xs">
                  <FileInputRow
                    value={config.files.antex1}
                    onChange={(val) =>
                      handleConfigChange({
                        ...config,
                        files: { ...config.files, antex1: val },
                      })
                    }
                    onBrowse={() => openFileBrowser((path) =>
                      handleConfigChange({ ...config, files: { ...config.files, antex1: path } })
                    )}
                  />
                  <FileInputRow
                    value={config.files.antex2}
                    onChange={(val) =>
                      handleConfigChange({
                        ...config,
                        files: { ...config.files, antex2: val },
                      })
                    }
                    onBrowse={() => openFileBrowser((path) =>
                      handleConfigChange({ ...config, files: { ...config.files, antex2: path } })
                    )}
                  />
                </Stack>
              </div>

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

              {/* OTL BLQ File */}
              <FileInputRow
                label="OTL BLQ File"
                value={config.files.blq}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, blq: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, blq: path } })
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

          {/* Tab 7: Misc */}
          <Tabs.Panel value="misc" pt="xs">
            <Stack gap="xs">
              {/* Group A: Processing Options */}
              <Fieldset legend="Processing Options" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <Select
                    size="xs"
                    label="Time Interpolation of Base Station Data"
                    value={config.misc.timeInterpolation ? 'on' : 'off'}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        misc: {
                          ...config.misc,
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

                  <Select
                    size="xs"
                    label="DGPS/DGNSS Corrections"
                    value={config.misc.dgpsCorrections}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        misc: {
                          ...config.misc,
                          dgpsCorrections: value,
                        },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'sbas', label: 'SBAS' },
                      { value: 'rtcm-dgps', label: 'RTCM DGPS' },
                      { value: 'rtcm-dgnss', label: 'RTCM DGNSS' },
                    ]}
                    disabled={isSingle}
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <NumberInput
                    size="xs"
                    label="SBAS Satellite Selection (0: All)"
                    value={config.misc.sbasSatSelection}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        misc: {
                          ...config.misc,
                          sbasSatSelection: Number(value),
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

              {/* Group B: RINEX Reading Options */}
              <Fieldset legend="RINEX Reading Options" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <TextInput
                    size="xs"
                    label="RINEX Opt (Rover)"
                    placeholder="-E -GL ..."
                    value={config.misc.rinexOptRover}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        misc: {
                          ...config.misc,
                          rinexOptRover: e.currentTarget.value,
                        },
                      })
                    }
                    styles={{ label: { fontSize: '10px' } }}
                  />

                  <TextInput
                    size="xs"
                    label="RINEX Opt (Base)"
                    placeholder="-E -GL ..."
                    value={config.misc.rinexOptBase}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        misc: {
                          ...config.misc,
                          rinexOptBase: e.currentTarget.value,
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
          <Tabs.Panel value="time" pt="xs">
            <Stack gap="xs">
              <Fieldset legend="Processing Time (GPST)" style={{ fontSize: '10px' }}>
                <Stack gap="xs">
                  <Group gap="xs" align="end">
                    <Checkbox
                      size="xs"
                      label="Time Start"
                      checked={config.time.startEnabled}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          time: { ...config.time, startEnabled: e.currentTarget.checked },
                        })
                      }
                      styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                    />
                    <TextInput
                      size="xs"
                      label="Date"
                      placeholder="YYYY/MM/DD"
                      value={config.time.startDate}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          time: { ...config.time, startDate: e.currentTarget.value },
                        })
                      }
                      disabled={!config.time.startEnabled}
                      style={{ width: 110 }}
                      styles={{ label: { fontSize: '10px' }, input: { fontSize: '11px', textAlign: 'center' } }}
                    />
                    <TextInput
                      size="xs"
                      label="Time"
                      placeholder="HH:MM:SS"
                      value={config.time.startTime}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          time: { ...config.time, startTime: e.currentTarget.value },
                        })
                      }
                      disabled={!config.time.startEnabled}
                      style={{ width: 90 }}
                      styles={{ label: { fontSize: '10px' }, input: { fontSize: '11px', textAlign: 'center' } }}
                    />
                  </Group>

                  <Group gap="xs" align="end">
                    <Checkbox
                      size="xs"
                      label="Time End"
                      checked={config.time.endEnabled}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          time: { ...config.time, endEnabled: e.currentTarget.checked },
                        })
                      }
                      styles={{ label: { fontSize: '10px', paddingLeft: 4, width: 68 } }}
                    />
                    <TextInput
                      size="xs"
                      label="Date"
                      placeholder="YYYY/MM/DD"
                      value={config.time.endDate}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          time: { ...config.time, endDate: e.currentTarget.value },
                        })
                      }
                      disabled={!config.time.endEnabled}
                      style={{ width: 110 }}
                      styles={{ label: { fontSize: '10px' }, input: { fontSize: '11px', textAlign: 'center' } }}
                    />
                    <TextInput
                      size="xs"
                      label="Time"
                      placeholder="HH:MM:SS"
                      value={config.time.endTime}
                      onChange={(e) =>
                        handleConfigChange({
                          ...config,
                          time: { ...config.time, endTime: e.currentTarget.value },
                        })
                      }
                      disabled={!config.time.endEnabled}
                      style={{ width: 90 }}
                      styles={{ label: { fontSize: '10px' }, input: { fontSize: '11px', textAlign: 'center' } }}
                    />
                  </Group>
                </Stack>
              </Fieldset>

              <Fieldset legend="Interval" style={{ fontSize: '10px' }}>
                <NumberInput
                  size="xs"
                  label="Processing Interval (s)"
                  description="0 = use all epochs"
                  value={config.time.interval}
                  onChange={(v) =>
                    handleConfigChange({
                      ...config,
                      time: { ...config.time, interval: Number(v) || 0 },
                    })
                  }
                  min={0}
                  step={1}
                  decimalScale={2}
                  suffix=" s"
                  hideControls
                  style={{ maxWidth: 200 }}
                  styles={{ label: { fontSize: '10px' }, description: { fontSize: '9px' } }}
                />
              </Fieldset>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Card>

      <SnrMaskModal
        opened={snrMaskModalOpened}
        onClose={() => setSnrMaskModalOpened(false)}
        value={config.setting1.snrMask}
        onChange={(newSnrMask: SnrMaskConfig) =>
          handleConfigChange({
            ...config,
            setting1: { ...config.setting1, snrMask: newSnrMask },
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
