import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Stack,
  Select,
  NumberInput,
  Text,
  Switch,
  Group,
  TextInput,
  Checkbox,
  Button,
  ActionIcon,
  Drawer,
  ScrollArea,
  UnstyledButton,
  Indicator,
  Divider,
  Loader,
  Notification,
} from '@mantine/core';
import {
  IconFolderOpen,
  IconX,
  IconFile,
  IconPlus,
  IconChartBar,
  IconWifi,
  IconPlayerPlay,
  IconSatellite,
  IconRadar,
  IconFileExport,
  IconQuestionMark,
  IconCalendar,
  IconCheck,
  IconArrowRight,
} from '@tabler/icons-react';
import { DateTimePicker } from '@mantine/dates';
import dayjs from 'dayjs';
import type {
  MrtkPostConfig,
  PositioningMode,
  Frequency,
  FilterType,
  IonosphereCorrection,
  TroposphereCorrection,
  EphemerisOption,
  TidalCorrection,
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
import { SnrMaskModal } from './SnrMaskModal';
import { SignalSelectModal } from './SignalSelectModal';
import { FileBrowserModal } from './FileBrowserModal';
import { OptionLabel } from './common/OptionLabel';
import { useModeDependentDisable } from '../hooks/useModeDependentDisable';
import { DOCS_BASE as OPTION_DOCS_BASE } from '../config/optionMeta';

// ─── Sub-components ────────────────────────────────────────────────────────

interface StationPositionInputProps {
  value: StationPosition;
  onChange: (value: StationPosition) => void;
  disabled?: boolean;
  disableCoordinates?: boolean;
  disableAntenna?: boolean;
}

function StationPositionInput({
  value,
  onChange,
  disabled = false,
  disableCoordinates = false,
  disableAntenna = false,
}: StationPositionInputProps) {
  const isManualInput = value.mode === 'llh' || value.mode === 'xyz';
  const coordLabels = value.mode === 'xyz'
    ? ['X-ECEF (m)', 'Y-ECEF (m)', 'Z-ECEF (m)']
    : ['Lat (deg)', 'Lon (deg)', 'Height (m)'];

  const coordsDisabled = disabled || disableCoordinates;
  const antennaDisabled = disabled || disableAntenna;
  const L = { width: 130, flexShrink: 0, fontSize: '11px' } as const;

  return (
    <Stack gap={6}>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>Position Type</Text>
        <Select
          size="xs"
          value={value.mode}
          onChange={(val: any) => onChange({ ...value, mode: val as PositionType })}
          data={[
            { value: 'llh', label: 'Lat/Lon/Height' },
            { value: 'xyz', label: 'XYZ-ECEF' },
            { value: 'rtcm', label: 'RTCM Antenna Pos' },
            { value: 'rinexhead', label: 'RINEX Header Pos' },
          ]}
          disabled={coordsDisabled}
          style={{ flex: 1 }}
        />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>{coordLabels[0]}</Text>
        <NumberInput
          size="xs"
          value={value.values[0]}
          onChange={(val: any) => onChange({ ...value, values: [Number(val), value.values[1], value.values[2]] })}
          decimalScale={9} hideControls disabled={coordsDisabled || !isManualInput} style={{ flex: 1 }}
        />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>{coordLabels[1]}</Text>
        <NumberInput
          size="xs"
          value={value.values[1]}
          onChange={(val: any) => onChange({ ...value, values: [value.values[0], Number(val), value.values[2]] })}
          decimalScale={9} hideControls disabled={coordsDisabled || !isManualInput} style={{ flex: 1 }}
        />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>{coordLabels[2]}</Text>
        <NumberInput
          size="xs"
          value={value.values[2]}
          onChange={(val: any) => onChange({ ...value, values: [value.values[0], value.values[1], Number(val)] })}
          decimalScale={4} hideControls disabled={coordsDisabled || !isManualInput} style={{ flex: 1 }}
        />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>Antenna Type</Text>
        <Checkbox
          size="xs"
          checked={value.antennaTypeEnabled}
          onChange={(e: any) => onChange({ ...value, antennaTypeEnabled: e.currentTarget.checked })}
          disabled={antennaDisabled}
        />
      </Group>
      {value.antennaTypeEnabled && (
        <Group wrap="nowrap" align="center" gap="xs">
          <Text size="xs" c="dimmed" style={L}>Antenna Name</Text>
          <TextInput
            size="xs"
            value={value.antennaType}
            onChange={(e: any) => onChange({ ...value, antennaType: e.currentTarget.value })}
            placeholder="e.g., AOAD/M_T"
            disabled={antennaDisabled}
            style={{ flex: 1 }}
          />
        </Group>
      )}
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>Delta-E (m)</Text>
        <NumberInput
          size="xs"
          value={value.antennaDelta[0]}
          onChange={(val: any) => onChange({ ...value, antennaDelta: [Number(val), value.antennaDelta[1], value.antennaDelta[2]] })}
          decimalScale={4} hideControls disabled={antennaDisabled} style={{ flex: 1 }}
        />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>Delta-N (m)</Text>
        <NumberInput
          size="xs"
          value={value.antennaDelta[1]}
          onChange={(val: any) => onChange({ ...value, antennaDelta: [value.antennaDelta[0], Number(val), value.antennaDelta[2]] })}
          decimalScale={4} hideControls disabled={antennaDisabled} style={{ flex: 1 }}
        />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={L}>Delta-U (m)</Text>
        <NumberInput
          size="xs"
          value={value.antennaDelta[2]}
          onChange={(val: any) => onChange({ ...value, antennaDelta: [value.antennaDelta[0], value.antennaDelta[1], Number(val)] })}
          decimalScale={4} hideControls disabled={antennaDisabled} style={{ flex: 1 }}
        />
      </Group>
    </Stack>
  );
}

interface FileInputRowProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onBrowse?: () => void;
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

// ─── Sidebar helper components ─────────────────────────────────────────────

function SidebarGroup({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <Group
        gap={4}
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: '10px',
          padding: '12px 8px 4px',
          userSelect: 'none',
          color: 'var(--mantine-color-dimmed)',
        }}
      >
        {icon}
        <Text size="xs" fw={600} c="dimmed" style={{ fontSize: '10px' }}>{label}</Text>
      </Group>
      {children}
    </>
  );
}

function SidebarItem({
  label,
  section,
  active,
  onClick,
  showBadge,
}: {
  label: string;
  section: string;
  active: string;
  onClick: (s: string) => void;
  showBadge?: boolean;
}) {
  const isActive = active === section;
  return (
    <Indicator color="red" size={6} disabled={!showBadge} offset={4} position="middle-end">
      <UnstyledButton
        onClick={() => onClick(section)}
        style={{
          display: 'block',
          width: '100%',
          padding: '6px 8px',
          fontSize: '11px',
          borderLeft: isActive ? '2px solid var(--mantine-primary-color-filled)' : '2px solid transparent',
          backgroundColor: isActive ? 'var(--mantine-color-default-hover)' : undefined,
          color: isActive ? 'var(--mantine-color-text)' : 'var(--mantine-color-dimmed)',
          fontWeight: isActive ? 500 : 400,
        }}
      >
        {label}
      </UnstyledButton>
    </Indicator>
  );
}

// ─── Section header with docs link ────────────────────────────────────────

const DOCS_BASE = OPTION_DOCS_BASE;

const SECTION_ANCHORS: Record<string, string> = {
  'positioning':        '#positioning',
  'basic-strategy':     '#positioning',
  'masks':              '#positioning',
  'atmosphere':         '#positioning-atmosphere',
  'corrections':        '#positioning-corrections',
  'satellites':         '#positioning',
  'advanced':           '#positioning-corrections',
  'clas-ppk':           '#positioning-clas',
  'ar-mode':            '#ambiguity-resolution',
  'ar-thresholds':      '#ambiguity-resolution-thresholds',
  'ar-counters':        '#ambiguity-resolution-counters',
  'partial-ar':         '#ambiguity-resolution-partial-ar',
  'ar-hold':            '#ambiguity-resolution-hold',
  'rejection':          '#rejection-criteria',
  'ar-cycleslip':       '#slip-detection',
  'kf':                 '#kalman-filter',
  'kf-measurement':     '#kalman-filter-measurement-error',
  'kf-initial-std':     '#kalman-filter-initial-std-deviation',
  'kf-process':         '#kalman-filter-process-noise',
  'adaptive-filter':    '#adaptive-filter',
  'signals':            '#signal-selection',
  'receiver':           '#receiver',
  'ppp-bias':           '#receiver',
  'sat-mode':           '#receiver',
  'antenna-rover':      '#antenna-rover',
  'antenna-base':       '#antenna-base',
  'output-solution':    '#output',
  'files-aux':          '#files',
  'files-logging':      '#files',
  'files-cmd':          '#files',
  'server-options':     '#server-rtkrcv',
  'server-timing':      '#server-rtkrcv',
  'server-buf':         '#server-rtkrcv',
  'server-cmd':         '#server-rtkrcv',
};

function SectionHeader({ title, anchor }: { title: string; anchor: string }) {
  return (
    <>
      <Group justify="space-between" align="center">
        <Text size="sm" fw={500}>{title}</Text>
        <ActionIcon
          variant="subtle"
          size="xs"
          component="a"
          href={`${DOCS_BASE}${SECTION_ANCHORS[anchor] || ''}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconQuestionMark size={13} />
        </ActionIcon>
      </Group>
      <Divider mb={4} />
    </>
  );
}

// ─── Horizontal field helper ──────────────────────────────────────────────

const LABEL_W = 130;
const LABEL_STYLE = { width: LABEL_W, flexShrink: 0, fontSize: '11px' } as const;
const OPT_LABEL_STYLE = { width: LABEL_W, flexShrink: 0 } as const;

// ─── Public interface ──────────────────────────────────────────────────────

export interface ExecutionProps {
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
  onQcPreview: () => void;
  roverFileValid: boolean;
}

export interface StreamPanelDef {
  key: string;
  label: string;
  content: React.ReactNode;
}

export interface ProcessingConfigTabsProps {
  config: MrtkPostConfig;
  onConfigChange: (config: MrtkPostConfig) => void;
  execution?: ExecutionProps;
  streamPanels?: StreamPanelDef[];
  activeSectionRef?: React.RefObject<((section: string) => void) | null>;
  defaultSection?: string;
}

/**
 * Sidebar + form panel layout for Processing Configuration.
 * Replaces the old ProcessingTabHeaders + ProcessingTabPanels components.
 */
export function ProcessingConfigPanel({ config, onConfigChange, execution, streamPanels, activeSectionRef, defaultSection }: ProcessingConfigTabsProps) {
  const initialSection = defaultSection ?? (execution ? 'input-files' : streamPanels?.length ? streamPanels[0].key : 'mode');
  const [activeSection, setActiveSection] = useState(initialSection);

  // Expose setActiveSection to parent for auto-focus on validation error
  useEffect(() => {
    if (activeSectionRef) {
      const ref = activeSectionRef as { current: ((section: string) => void) | null };
      ref.current = setActiveSection;
      return () => { ref.current = null; };
    }
  }, [activeSectionRef, setActiveSection]);

  // Modal state
  const [snrMaskModalOpened, setSnrMaskModalOpened] = useState(false);
  const [signalSelectOpened, setSignalSelectOpened] = useState(false);
  const [fileBrowserOpened, setFileBrowserOpened] = useState(false);
  const fileBrowserCallbackRef = useRef<((path: string) => void) | null>(null);
  const [fileBrowserRoot, setFileBrowserRoot] = useState<'workspace' | 'data' | 'system'>('workspace');

  const openFileBrowser = useCallback((onSelect: (path: string) => void, root: 'workspace' | 'data' | 'system' = 'workspace') => {
    fileBrowserCallbackRef.current = onSelect;
    setFileBrowserRoot(root);
    setFileBrowserOpened(true);
  }, []);

  const handleFileBrowserSelect = useCallback((path: string) => {
    if (fileBrowserCallbackRef.current) {
      fileBrowserCallbackRef.current(path);
      fileBrowserCallbackRef.current = null;
    }
  }, []);

  // Correction files state
  interface CorrectionFile { filename: string; path: string; size_bytes: number }
  const [corrections, setCorrections] = useState<Record<string, CorrectionFile[]>>({});
  const [correctionsLoading, setCorrectionsLoading] = useState(true);
  const [profileNotification, setProfileNotification] = useState<string | null>(null);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/files/corrections')
      .then((r) => r.json())
      .then((data: Record<string, CorrectionFile[]>) => {
        setCorrections(data);
        setCorrectionsLoading(false);
      })
      .catch(() => setCorrectionsLoading(false));
  }, []);

  // Clean up notification timer on unmount
  useEffect(() => {
    return () => {
      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    };
  }, []);

  const hasCorrections = Object.values(corrections).some((files) => files.length > 0);

  const CORRECTION_FILE_FIELD: Record<string, (keyof typeof config.files)[]> = {
    'clas_grid.def': ['cssrGrid'],
    'clas_grid.blq': ['oceanLoading'],
    'igu00p01.erp': ['eop'],
    'igs14_L5copy.atx': ['satelliteAtx', 'receiverAtx'],
    'isb.tbl': ['isbTable'],
    'l2csft.tbl': ['phaseCycle'],
    'igs20.atx': ['satelliteAtx', 'receiverAtx'],
  };

  const applyProfile = (profile: string) => {
    const files = corrections[profile];
    if (!files) return;
    const updates: Partial<typeof config.files> = {};
    for (const f of files) {
      const fields = CORRECTION_FILE_FIELD[f.filename];
      if (fields) for (const field of fields) (updates as Record<string, string>)[field] = f.path;
    }
    handleConfigChange({
      ...config,
      files: { ...config.files, ...updates },
    });
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    setProfileNotification(
      profile === 'clas'
        ? 'CLAS PPP-RTK correction files applied to Files settings.'
        : 'MADOCA PPP correction files applied to Files settings.'
    );
    notificationTimerRef.current = setTimeout(() => setProfileNotification(null), 3000);
  };

  const handleConfigChange = onConfigChange;

  // Conditional logic based on positioning mode
  const isSingle = config.positioning.positioningMode === 'single';
  const isMadocaPPP = ['ppp-kinematic', 'ppp-static', 'ppp-fixed'].includes(config.positioning.positioningMode);
  const isPPP = isMadocaPPP || config.positioning.positioningMode === 'ppp-rtk';
  const isStaticMode = ['static', 'ppp-static'].includes(config.positioning.positioningMode);
  const isSolLLH = config.output.solutionFormat === 'llh';
  const isSolNMEA = config.output.solutionFormat === 'nmea';
  const isFixedMode = ['fixed', 'ppp-fixed'].includes(config.positioning.positioningMode);
  const canUseSignals = !isMadocaPPP;
  const useSignals = canUseSignals && config.positioning.signals.trim() !== '';

  const isReceiverDynamicsEnabled =
    config.positioning.positioningMode === 'kinematic' ||
    config.positioning.positioningMode === 'ppp-kinematic';

  const modeDisabled = useModeDependentDisable(config.positioning.positioningMode);

  return (
    <>
      <Group gap={0} align="stretch" wrap="nowrap" style={{ minHeight: 400 }}>
        {/* Left sidebar - 130px fixed */}
        <ScrollArea style={{ width: 130, flexShrink: 0, borderRight: '1px solid var(--mantine-color-default-border)' }}>
          <Stack gap={0}>
            {streamPanels && streamPanels.length > 0 && (
              <SidebarGroup label="STREAMS" icon={<IconWifi size={12} />}>
                {streamPanels.map((sp) => (
                  <SidebarItem key={sp.key} label={sp.label} section={sp.key} active={activeSection} onClick={setActiveSection} />
                ))}
              </SidebarGroup>
            )}
            {execution && (
              <SidebarGroup label="EXECUTION" icon={<IconPlayerPlay size={12} />}>
                <SidebarItem label="Input Files" section="input-files" active={activeSection} onClick={setActiveSection}
                  showBadge={!execution.roverFile || !execution.navFile || !execution.outputFile} />
              </SidebarGroup>
            )}
            <SidebarGroup label="POSITIONING" icon={<IconSatellite size={12} />}>
              <SidebarItem label="Mode" section="mode" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="AR" section="ar" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="Kalman Filter" section="kf" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="Advanced" section="advanced" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="CLAS PPP-RTK" section="clas" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="Adaptive" section="adaptive-filter" active={activeSection} onClick={setActiveSection} />
            </SidebarGroup>
            <SidebarGroup label="ENVIRONMENT" icon={<IconRadar size={12} />}>
              <SidebarItem label="Receiver" section="receiver" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="Antenna" section="antenna" active={activeSection} onClick={setActiveSection} />
            </SidebarGroup>
            <SidebarGroup label="OUTPUT" icon={<IconFileExport size={12} />}>
              <SidebarItem label="Format" section="format" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="Files" section="files" active={activeSection} onClick={setActiveSection} />
              <SidebarItem label="Server" section="server" active={activeSection} onClick={setActiveSection} />
            </SidebarGroup>
          </Stack>
        </ScrollArea>

        {/* Right form panel */}
        <ScrollArea style={{ flex: 1 }} p="xs">
          {/* ── Stream panels (RT mode) ── */}
          {streamPanels?.map((sp) => (
            activeSection === sp.key ? <div key={sp.key}>{sp.content}</div> : null
          ))}

          {/* ── Input Files section (merged with Time Range) ── */}
          {activeSection === 'input-files' && execution && (
            <Stack gap={6}>
              {/* Time Range — DateTimePicker layout */}
              <SectionHeader title="Time Range" anchor="basic-strategy" />
              <Group wrap="nowrap" align="flex-start" gap="xs">
                <Text size="xs" c="dimmed" style={{ width: 130, flexShrink: 0, fontSize: '11px', paddingTop: 6 }}>Time Start</Text>
                <Checkbox
                  size="xs"
                  checked={config.time.startEnabled}
                  onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, startEnabled: e.currentTarget.checked } })}
                  style={{ flexShrink: 0, paddingTop: 6 }}
                />
                <DateTimePicker
                  size="xs"
                  valueFormat="YYYY/MM/DD HH:mm:ss"
                  placeholder="2026/03/28 00:00:00"
                  clearable
                  leftSection={<IconCalendar size={14} />}
                  disabled={!config.time.startEnabled}
                  value={config.time.startDate && config.time.startTime
                    ? dayjs(`${config.time.startDate} ${config.time.startTime}`, 'YYYY/MM/DD HH:mm:ss').toDate()
                    : null}
                  onChange={(date) => {
                    if (date) {
                      const d = dayjs(date);
                      handleConfigChange({ ...config, time: { ...config.time, startDate: d.format('YYYY/MM/DD'), startTime: d.format('HH:mm:ss') } });
                    } else {
                      handleConfigChange({ ...config, time: { ...config.time, startDate: '', startTime: '' } });
                    }
                  }}
                  style={{ flex: 1 }}
                  styles={{ input: { fontSize: '11px' } }}
                />
              </Group>
              <Group wrap="nowrap" align="flex-start" gap="xs">
                <Text size="xs" c="dimmed" style={{ width: 130, flexShrink: 0, fontSize: '11px', paddingTop: 6 }}>Time End</Text>
                <Checkbox
                  size="xs"
                  checked={config.time.endEnabled}
                  onChange={(e) => handleConfigChange({ ...config, time: { ...config.time, endEnabled: e.currentTarget.checked } })}
                  style={{ flexShrink: 0, paddingTop: 6 }}
                />
                <DateTimePicker
                  size="xs"
                  valueFormat="YYYY/MM/DD HH:mm:ss"
                  placeholder="2026/03/28 23:59:59"
                  clearable
                  leftSection={<IconCalendar size={14} />}
                  disabled={!config.time.endEnabled}
                  value={config.time.endDate && config.time.endTime
                    ? dayjs(`${config.time.endDate} ${config.time.endTime}`, 'YYYY/MM/DD HH:mm:ss').toDate()
                    : null}
                  onChange={(date) => {
                    if (date) {
                      const d = dayjs(date);
                      handleConfigChange({ ...config, time: { ...config.time, endDate: d.format('YYYY/MM/DD'), endTime: d.format('HH:mm:ss') } });
                    } else {
                      handleConfigChange({ ...config, time: { ...config.time, endDate: '', endTime: '' } });
                    }
                  }}
                  style={{ flex: 1 }}
                  styles={{ input: { fontSize: '11px' } }}
                />
              </Group>
              <Text size="xs" c="dimmed" style={{ fontSize: '10px', paddingLeft: 130 }}>Input in GPS Time (GPST = UTC + 18 s)</Text>
              <Group wrap="nowrap" align="center" gap="xs">
                <Text size="xs" c="dimmed" style={{ width: 130, flexShrink: 0, fontSize: '11px' }}>Interval (0=all)</Text>
                <NumberInput
                  size="xs"
                  value={config.time.interval}
                  onChange={(v) => handleConfigChange({ ...config, time: { ...config.time, interval: Number(v) || 0 } })}
                  min={0}
                  step={1}
                  decimalScale={2}
                  suffix=" s"
                  hideControls
                  style={{ flex: 1 }}
                  styles={{ input: { fontSize: '11px' } }}
                />
              </Group>

              {/* Input Files */}
              <SectionHeader title="Input Files" anchor="basic-strategy" />
              <div>
                <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Rover OBS *</Text>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    size="xs"
                    placeholder="/data/rover.obs"
                    value={execution.roverFile}
                    onChange={(e) => execution.onRoverFileChange(e.currentTarget.value)}
                    leftSection={<IconFile size={12} />}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(execution.onRoverFileChange, 'data')}>
                    <IconFolderOpen size={16} />
                  </ActionIcon>
                </Group>
              </div>
              <div>
                <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Navigation *</Text>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    size="xs"
                    placeholder="/data/nav.nav"
                    value={execution.navFile}
                    onChange={(e) => execution.onNavFileChange(e.currentTarget.value)}
                    leftSection={<IconFile size={12} />}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(execution.onNavFileChange, 'data')}>
                    <IconFolderOpen size={16} />
                  </ActionIcon>
                </Group>
              </div>
              <div>
                <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }} c={!execution.needsBase ? 'dimmed' : undefined}>Base OBS</Text>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    size="xs"
                    placeholder="/data/base.obs"
                    value={execution.baseFile}
                    onChange={(e) => execution.onBaseFileChange(e.currentTarget.value)}
                    leftSection={<IconFile size={12} />}
                    style={{ flex: 1 }}
                    disabled={!execution.needsBase}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(execution.onBaseFileChange, 'data')} disabled={!execution.needsBase}>
                    <IconFolderOpen size={16} />
                  </ActionIcon>
                </Group>
              </div>
              {/* Correction Files */}
              <div>
                <Group gap="xs" mb={4} justify="space-between">
                  <Text size="xs" style={{ fontSize: '10px' }}>Corrections (CLK, SP3, FCB, IONEX, L6, etc.)</Text>
                  <ActionIcon variant="light" size="xs" onClick={() => execution.onCorrectionFilesChange([...execution.correctionFiles, ''])}>
                    <IconPlus size={12} />
                  </ActionIcon>
                </Group>
                <Stack gap={4}>
                  {execution.correctionFiles.map((cf, idx) => (
                    <Group key={idx} gap="xs" wrap="nowrap">
                      <TextInput
                        size="xs"
                        placeholder={`/data/correction${idx + 1}`}
                        value={cf}
                        onChange={(e) => {
                          const next = [...execution.correctionFiles];
                          next[idx] = e.currentTarget.value;
                          execution.onCorrectionFilesChange(next);
                        }}
                        leftSection={<IconFile size={12} />}
                        style={{ flex: 1 }}
                      />
                      <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser((path) => {
                        const next = [...execution.correctionFiles];
                        next[idx] = path;
                        execution.onCorrectionFilesChange(next);
                      }, 'data')}>
                        <IconFolderOpen size={16} />
                      </ActionIcon>
                      {execution.correctionFiles.length > 1 && (
                        <ActionIcon variant="subtle" color="red" size="lg" onClick={() => execution.onCorrectionFilesChange(execution.correctionFiles.filter((_, i) => i !== idx))}>
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
                    value={execution.outputFile}
                    onChange={(e) => execution.onOutputFileChange(e.currentTarget.value)}
                    leftSection={<IconFile size={12} />}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(execution.onOutputFileChange)}>
                    <IconFolderOpen size={16} />
                  </ActionIcon>
                </Group>
              </div>
              <Button variant="light" size="xs" leftSection={<IconChartBar size={14} />} onClick={execution.onQcPreview} disabled={!execution.roverFileValid}>
                QC Preview
              </Button>
            </Stack>
          )}

          {/* ── Mode section ── */}
          {activeSection === 'mode' && (
            <Stack gap="xs">
              {/* Group A: Basic Strategy */}
              <SectionHeader title="Basic Strategy" anchor="basic-strategy" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.mode" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.solution_type" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.frequency" style={OPT_LABEL_STYLE} />
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
                    disabled={isSingle || useSignals}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>
                    Signals {isMadocaPPP && <Text span size="xs" c="dimmed">(N/A)</Text>}
                  </Text>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => setSignalSelectOpened(true)}
                    disabled={!canUseSignals}
                    style={{ flex: 1 }}
                  >
                    {config.positioning.signals
                      ? `${config.positioning.signals.split(',').filter(Boolean).length} signals`
                      : 'Select Signals...'}
                  </Button>
                  {canUseSignals && config.positioning.signals && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() =>
                        handleConfigChange({
                          ...config,
                          positioning: { ...config.positioning, signals: '' },
                        })
                      }
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  )}
                </Group>
              </Stack>

              {/* Group B: Masks & Environment */}
              <SectionHeader title="Masks & Environment" anchor="masks" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.elevation_mask" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>SNR Mask</Text>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => setSnrMaskModalOpened(true)}
                    style={{ flex: 1 }}
                  >
                    Edit SNR Mask...
                  </Button>
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="atmosphere.ionosphere" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
                    value={config.positioning.atmosphere.ionosphere}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          atmosphere: { ...config.positioning.atmosphere, ionosphere: value as IonosphereCorrection },
                        },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'broadcast', label: 'Broadcast' },
                      { value: 'sbas', label: 'SBAS' },
                      { value: 'dual-freq', label: 'Iono-Free LC' },
                      { value: 'est-stec', label: 'Estimate STEC' },
                      { value: 'est-adaptive', label: 'Estimate Adaptive' },
                      { value: 'ionex-tec', label: 'IONEX TEC' },
                    ]}
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="atmosphere.troposphere" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
                    value={config.positioning.atmosphere.troposphere}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          atmosphere: { ...config.positioning.atmosphere, troposphere: value as TroposphereCorrection },
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.satellite_ephemeris" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* Group C: Satellite Selection */}
              <SectionHeader title="Satellite Selection" anchor="satellites" />
              <Stack gap={6}>
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

            </Stack>
          )}

          {/* ── Advanced section ── */}
          {activeSection === 'advanced' && (
            <Stack gap="xs">
              <SectionHeader title="Advanced Settings" anchor="advanced" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Earth Tides</Text>
                  <Select
                    size="xs"
                    value={config.positioning.corrections.tidalCorrection}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          corrections: { ...config.positioning.corrections, tidalCorrection: value as TidalCorrection },
                        },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'on', label: 'Solid' },
                      { value: 'otl', label: 'Solid+OTL' },
                      { value: 'solid+otl-clasgrid+pole', label: 'Solid+OTL+Pole' },
                    ]}
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.dynamics" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Text size="xs" style={{ fontSize: '10px' }}>
                  Corrections & Options
                </Text>
                <Group gap="xs">
                  <Switch
                    size="xs"
                    label="Sat PCV"
                    checked={config.positioning.corrections.satelliteAntenna}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          corrections: { ...config.positioning.corrections, satelliteAntenna: e.currentTarget.checked },
                        },
                      })
                    }
                    disabled={!isPPP}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <Switch
                    size="xs"
                    label="Rec PCV"
                    checked={config.positioning.corrections.receiverAntenna}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          corrections: { ...config.positioning.corrections, receiverAntenna: e.currentTarget.checked },
                        },
                      })
                    }
                    disabled={!isPPP}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <Switch
                    size="xs"
                    label="Phase Windup"
                    checked={config.positioning.corrections.phaseWindup !== 'off'}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          corrections: { ...config.positioning.corrections, phaseWindup: e.currentTarget.checked ? "on" as const : "off" as const },
                        },
                      })
                    }
                    disabled={!isPPP}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <Switch
                    size="xs"
                    label="Reject Eclipse"
                    checked={config.positioning.corrections.excludeEclipse}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          corrections: { ...config.positioning.corrections, excludeEclipse: e.currentTarget.checked },
                        },
                      })
                    }
                    disabled={!isPPP}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  <Switch
                    size="xs"
                    label="RAIM FDE"
                    checked={config.positioning.corrections.raimFde}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          corrections: { ...config.positioning.corrections, raimFde: e.currentTarget.checked },
                        },
                      })
                    }
                    styles={{ label: { fontSize: '10px' } }}
                  />
                </Group>
              </Stack>

              {/* Rejection Criteria */}
              <SectionHeader title="Rejection Criteria" anchor="rejection" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="rejection.innovation" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.rejection.innovation}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, innovation: Number(v)}})}
                    disabled={modeDisabled('rejection.innovation')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="rejection.l1_l2_residual" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.rejection.l1L2Residual}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, l1L2Residual: Number(v)}})}
                    disabled={modeDisabled('rejection.l1_l2_residual')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="rejection.dispersive" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.rejection.dispersive}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, dispersive: Number(v)}})}
                    disabled={modeDisabled('rejection.dispersive')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="rejection.non_dispersive" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.rejection.nonDispersive}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, nonDispersive: Number(v)}})}
                    disabled={modeDisabled('rejection.non_dispersive')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Hold Chi-Square</Text>
                  <NumberInput size="xs" value={config.rejection.holdChiSquare}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, holdChiSquare: Number(v)}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Fix Chi-Square</Text>
                  <NumberInput size="xs" value={config.rejection.fixChiSquare}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, fixChiSquare: Number(v)}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="rejection.gdop" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.rejection.gdop}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, gdop: Number(v)}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Pseudorange Diff</Text>
                  <NumberInput size="xs" value={config.rejection.pseudorangeDiff}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, pseudorangeDiff: Number(v)}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Pos Error Count</Text>
                  <NumberInput size="xs" value={config.rejection.positionErrorCount}
                    onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, positionErrorCount: Number(v)}})}
                    decimalScale={0} hideControls style={{flex:1}} />
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── CLAS PPP-RTK section ── */}
          {activeSection === 'clas' && (
            <Stack gap={6}>
              <SectionHeader title="CLAS PPP-RTK" anchor="clas-ppk" />
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Grid Radius (m)</Text>
                  <NumberInput size="xs"
                    value={config.positioning.clas.gridSelectionRadius}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, gridSelectionRadius: Number(v) || 0 } } })}
                    min={0} style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Receiver Type</Text>
                  <TextInput size="xs"
                    value={config.positioning.clas.receiverType}
                    onChange={(e) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, receiverType: e.currentTarget.value } } })}
                    placeholder="e.g. Trimble NetR9" style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Uncertainty X (m)</Text>
                  <NumberInput size="xs"
                    value={config.positioning.clas.positionUncertaintyX}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, positionUncertaintyX: Number(v) || 0 } } })}
                    min={0} decimalScale={1} style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Uncertainty Y (m)</Text>
                  <NumberInput size="xs"
                    value={config.positioning.clas.positionUncertaintyY}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, positionUncertaintyY: Number(v) || 0 } } })}
                    min={0} decimalScale={1} style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Uncertainty Z (m)</Text>
                  <NumberInput size="xs"
                    value={config.positioning.clas.positionUncertaintyZ}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, positionUncertaintyZ: Number(v) || 0 } } })}
                    min={0} decimalScale={1} style={{ flex: 1 }} />
                </Group>
            </Stack>
          )}

          {/* ── Adaptive Filter section ── */}
          {activeSection === 'adaptive-filter' && (
            <Stack gap={6}>
              <SectionHeader title="Adaptive Filter" anchor="adaptive-filter" />
              <Group wrap="nowrap" align="center" gap="xs">
                <Text size="xs" c="dimmed" style={LABEL_STYLE}>Enabled</Text>
                <Switch size="xs" checked={config.adaptiveFilter.enabled}
                  onChange={(e) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, enabled: e.currentTarget.checked}})} />
              </Group>
              <Group wrap="nowrap" align="center" gap="xs">
                <OptionLabel metaKey="adaptive.iono_forgetting" style={OPT_LABEL_STYLE} />
                <NumberInput size="xs" value={config.adaptiveFilter.ionoForgetting}
                  onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, ionoForgetting: Number(v)}})}
                  disabled={modeDisabled('adaptive.iono_forgetting')}
                  decimalScale={4} hideControls style={{flex:1}} />
              </Group>
              <Group wrap="nowrap" align="center" gap="xs">
                <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iono Gain</Text>
                <NumberInput size="xs" value={config.adaptiveFilter.ionoGain}
                  onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, ionoGain: Number(v)}})}
                  decimalScale={4} hideControls style={{flex:1}} />
              </Group>
              <Group wrap="nowrap" align="center" gap="xs">
                <OptionLabel metaKey="adaptive.pva_forgetting" style={OPT_LABEL_STYLE} />
                <NumberInput size="xs" value={config.adaptiveFilter.pvaForgetting}
                  onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, pvaForgetting: Number(v)}})}
                  disabled={modeDisabled('adaptive.pva_forgetting')}
                  decimalScale={4} hideControls style={{flex:1}} />
              </Group>
              <Group wrap="nowrap" align="center" gap="xs">
                <Text size="xs" c="dimmed" style={LABEL_STYLE}>PVA Gain</Text>
                <NumberInput size="xs" value={config.adaptiveFilter.pvaGain}
                  onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, pvaGain: Number(v)}})}
                  decimalScale={4} hideControls style={{flex:1}} />
              </Group>
            </Stack>
          )}

          {/* ── AR section ── */}
          {activeSection === 'ar' && (
            <Stack gap="xs">
              {/* Ambiguity Resolution */}
              <SectionHeader title="AR Mode" anchor="ar-mode" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.mode" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
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
                    disabled={modeDisabled('ar.mode')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.glonass_ar" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
                    value={config.ambiguityResolution.glonassAr}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, glonassAr: value },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'on', label: 'ON' },
                      { value: 'autocal', label: 'AutoCal' },
                    ]}
                    disabled={modeDisabled('ar.glonass_ar')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.bds_ar" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
                    value={config.ambiguityResolution.bdsAr}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, bdsAr: value },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'on', label: 'ON' },
                    ]}
                    disabled={modeDisabled('ar.bds_ar')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.qzs_ar" style={OPT_LABEL_STYLE} />
                  <Select
                    size="xs"
                    value={config.ambiguityResolution.qzsAr}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, qzsAr: value },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'on', label: 'ON' },
                    ]}
                    disabled={modeDisabled('ar.qzs_ar')}
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* AR Thresholds */}
              <SectionHeader title="Thresholds" anchor="ar-thresholds" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.ambiguityResolution.thresholds.ratio}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, thresholds: { ...config.ambiguityResolution.thresholds, ratio: Number(value) } },
                      })
                    }
                    min={1}
                    max={10}
                    step={0.1}
                    decimalScale={1}
                    disabled={modeDisabled('ar.thresholds.ratio')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.elevation_mask" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.ambiguityResolution.thresholds.elevationMask}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, thresholds: { ...config.ambiguityResolution.thresholds, elevationMask: Number(value) } },
                      })
                    }
                    min={0}
                    max={90}
                    hideControls
                    disabled={modeDisabled('ar.thresholds.elevation_mask')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.hold_elevation" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.ambiguityResolution.thresholds.holdElevation}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, thresholds: { ...config.ambiguityResolution.thresholds, holdElevation: Number(value) } },
                      })
                    }
                    min={0}
                    max={90}
                    hideControls
                    disabled={modeDisabled('ar.thresholds.hold_elevation')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio1" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.thresholds.ratio1}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio1: Number(value)}}})}
                    decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio1')} style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio2" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.thresholds.ratio2}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio2: Number(value)}}})}
                    decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio2')} style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio3" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.thresholds.ratio3}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio3: Number(value)}}})}
                    decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio3')} style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio4" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.thresholds.ratio4}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio4: Number(value)}}})}
                    decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio4')} style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio5" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.thresholds.ratio5}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio5: Number(value)}}})}
                    decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio5')} style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio6" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.thresholds.ratio6}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio6: Number(value)}}})}
                    decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio6')} style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.alpha" style={OPT_LABEL_STYLE} />
                  <Select size="xs" value={config.ambiguityResolution.thresholds.alpha}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, alpha: value}}})}
                    data={['0.1%', '0.5%', '1%', '5%', '10%', '20%']}
                    disabled={modeDisabled('ar.thresholds.alpha')} style={{flex:1}} />
                </Group>
              </Stack>

              {/* AR Counters */}
              <Divider my={4} />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.counters.lock_count" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.ambiguityResolution.counters.lockCount}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, counters: { ...config.ambiguityResolution.counters, lockCount: Number(value) } },
                      })
                    }
                    min={0}
                    hideControls
                    disabled={modeDisabled('ar.counters.lock_count')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.counters.min_fix" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.ambiguityResolution.counters.minFix}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, counters: { ...config.ambiguityResolution.counters, minFix: Number(value) } },
                      })
                    }
                    min={0}
                    hideControls
                    disabled={modeDisabled('ar.counters.min_fix')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.counters.max_iterations" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.ambiguityResolution.counters.maxIterations}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, counters: { ...config.ambiguityResolution.counters, maxIterations: Number(value) } },
                      })
                    }
                    min={1}
                    max={10}
                    hideControls
                    disabled={modeDisabled('ar.counters.max_iterations')}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.counters.out_count" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.ambiguityResolution.counters.outCount}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, counters: { ...config.ambiguityResolution.counters, outCount: Number(value) } },
                      })
                    }
                    min={0}
                    step={1}
                    hideControls
                    disabled={modeDisabled('ar.counters.out_count')}
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* Rejection */}
              <Divider my={4} />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Innovation (m)</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>GDOP</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* Slip Detection */}
              <SectionHeader title="Cycle Slip Detection" anchor="ar-cycleslip" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="slip.threshold" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* Partial AR */}
              <SectionHeader title="Partial AR" anchor="partial-ar" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.partial_ar.min_ambiguities" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.partialAr.minAmbiguities}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minAmbiguities: Number(value)}}})}
                    disabled={modeDisabled('ar.partial_ar.min_ambiguities')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.partial_ar.max_excluded_sats" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.partialAr.maxExcludedSats}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, maxExcludedSats: Number(value)}}})}
                    disabled={modeDisabled('ar.partial_ar.max_excluded_sats')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.partial_ar.min_fix_sats" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.partialAr.minFixSats}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minFixSats: Number(value)}}})}
                    disabled={modeDisabled('ar.partial_ar.min_fix_sats')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.partial_ar.min_drop_sats" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.partialAr.minDropSats}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minDropSats: Number(value)}}})}
                    disabled={modeDisabled('ar.partial_ar.min_drop_sats')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.partial_ar.min_hold_sats" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.ambiguityResolution.partialAr.minHoldSats}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minHoldSats: Number(value)}}})}
                    disabled={modeDisabled('ar.partial_ar.min_hold_sats')}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.partial_ar.ar_filter" style={OPT_LABEL_STYLE} />
                  <Switch size="xs" checked={config.ambiguityResolution.partialAr.arFilter}
                    disabled={modeDisabled('ar.partial_ar.ar_filter')}
                    onChange={(e) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, arFilter: e.currentTarget.checked}}})} />
                </Group>
              </Stack>

              {/* Hold */}
              <SectionHeader title="Hold" anchor="ar-hold" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Variance</Text>
                  <NumberInput size="xs" value={config.ambiguityResolution.hold.variance}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, hold: {...config.ambiguityResolution.hold, variance: Number(value)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Gain</Text>
                  <NumberInput size="xs" value={config.ambiguityResolution.hold.gain}
                    onChange={(value: any) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, hold: {...config.ambiguityResolution.hold, gain: Number(value)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── Kalman Filter section ── */}
          {activeSection === 'kf' && (
            <Stack gap="xs">
              {/* Filter Settings */}
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iterations</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Sync Solution</Text>
                  <Checkbox
                    size="xs"
                    checked={config.kalmanFilter.syncSolution}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        kalmanFilter: { ...config.kalmanFilter, syncSolution: e.currentTarget.checked },
                      })
                    }
                  />
                </Group>
              </Stack>

              {/* Measurement Error */}
              <SectionHeader title="Measurement Error" anchor="kf-measurement" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.meas.code_phase_ratio_L1" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.meas.code_phase_ratio_L2" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.meas.phase" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.meas.phase_elevation" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.meas.phase_baseline" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
                    value={config.kalmanFilter.measurementError.phaseBaseline}
                    disabled={modeDisabled('kf.meas.phase_baseline')}
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Doppler (Hz)</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.meas.code_phase_ratio_L5" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.kalmanFilter.measurementError.codePhaseRatioL5}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, codePhaseRatioL5: Number(v)}}})}
                    min={0} decimalScale={1} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.meas.ura_ratio" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.kalmanFilter.measurementError.uraRatio}
                    disabled={modeDisabled('kf.meas.ura_ratio')}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, uraRatio: Number(v)}}})}
                    min={0} decimalScale={4} hideControls style={{flex:1}} />
                </Group>
              </Stack>

              {/* Process Noise */}
              <SectionHeader title="Process Noise" anchor="kf-process" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.pn.accel_h" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.pn.accel_v" style={OPT_LABEL_STYLE} />
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Phase Bias (cycle)</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iono (m/10km)</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>ZTD (m)</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.pn.clock_stability" style={OPT_LABEL_STYLE} />
                  <TextInput
                    size="xs"
                    value={config.kalmanFilter.processNoise.clockStability.toExponential()}
                    onChange={(e) => {
                      const parsed = parseFloat(e.currentTarget.value);
                      if (!isNaN(parsed)) {
                        handleConfigChange({
                          ...config,
                          kalmanFilter: {
                            ...config.kalmanFilter,
                            processNoise: {
                              ...config.kalmanFilter.processNoise,
                              clockStability: parsed,
                            },
                          },
                        });
                      }
                    }}
                    placeholder="5e-12"
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.pn.iono_max" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.kalmanFilter.processNoise.ionoMax}
                    disabled={modeDisabled('kf.pn.iono_max')}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, ionoMax: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Position H (m)</Text>
                  <NumberInput size="xs" value={config.kalmanFilter.processNoise.positionH}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, positionH: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Position V (m)</Text>
                  <NumberInput size="xs" value={config.kalmanFilter.processNoise.positionV}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, positionV: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Position (m)</Text>
                  <NumberInput size="xs" value={config.kalmanFilter.processNoise.position}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, position: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.pn.ifb" style={OPT_LABEL_STYLE} />
                  <NumberInput size="xs" value={config.kalmanFilter.processNoise.ifb}
                    disabled={modeDisabled('kf.pn.ifb')}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, ifb: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iono Time Const</Text>
                  <NumberInput size="xs" value={config.kalmanFilter.processNoise.ionoTimeConst}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, ionoTimeConst: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
              </Stack>

              {/* Initial Std. Deviation */}
              <SectionHeader title="Initial Std. Deviation" anchor="kf-initial-std" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Bias (cycle)</Text>
                  <NumberInput size="xs" value={config.kalmanFilter.initialStd.bias}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, initialStd: {...config.kalmanFilter.initialStd, bias: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Ionosphere (m)</Text>
                  <NumberInput size="xs" value={config.kalmanFilter.initialStd.ionosphere}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, initialStd: {...config.kalmanFilter.initialStd, ionosphere: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Troposphere (m)</Text>
                  <NumberInput size="xs" value={config.kalmanFilter.initialStd.troposphere}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, initialStd: {...config.kalmanFilter.initialStd, troposphere: Number(v)}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── Receiver section ── */}
          {activeSection === 'receiver' && (
            <Stack gap="xs">
              <SectionHeader title="Receiver Options" anchor="receiver" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iono Comp.</Text>
                  <Switch
                    size="xs"
                    checked={config.receiver.ionoCorrection}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, ionoCorrection: e.currentTarget.checked },
                      })
                    }
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>ISB</Text>
                  <Switch
                    size="xs"
                    checked={config.receiver.isb}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, isb: e.currentTarget.checked },
                      })
                    }
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Phase Shift</Text>
                  <Select
                    size="xs"
                    value={config.receiver.phaseShift}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, phaseShift: value },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'table', label: 'Table' },
                    ]}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Max Age (s)</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.maxAge}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, maxAge: Number(value) },
                      })
                    }
                    min={0}
                    decimalScale={1}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Baseline Len (m)</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.baselineLength}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, baselineLength: Number(value) },
                      })
                    }
                    min={0}
                    decimalScale={1}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Baseline Sigma (m)</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.baselineSigma}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, baselineSigma: Number(value) },
                      })
                    }
                    min={0}
                    decimalScale={4}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Ignore Chi Error</Text>
                  <Switch
                    size="xs"
                    checked={config.receiver.ignoreChiError}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, ignoreChiError: e.currentTarget.checked },
                      })
                    }
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>BDS-2 Bias</Text>
                  <Switch
                    size="xs"
                    checked={config.receiver.bds2Bias}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, bds2Bias: e.currentTarget.checked },
                      })
                    }
                  />
                </Group>
              </Stack>

              <SectionHeader title="PPP Bias" anchor="ppp-bias" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>PPP Sat Clock Bias</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.pppSatClockBias}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, pppSatClockBias: Number(value) || 0 },
                      })
                    }
                    hideControls
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>PPP Sat Phase Bias</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.pppSatPhaseBias}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, pppSatPhaseBias: Number(value) || 0 },
                      })
                    }
                    hideControls
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Uncorrected Bias</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.uncorrBias}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, uncorrBias: Number(value) || 0 },
                      })
                    }
                    hideControls
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Max Bias dt</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.maxBiasDt}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, maxBiasDt: Number(value) || 0 },
                      })
                    }
                    hideControls
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              <SectionHeader title="Satellite Mode" anchor="sat-mode" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Satellite Mode</Text>
                  <NumberInput
                    size="xs"
                    value={config.receiver.satelliteMode}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, satelliteMode: Number(value) || 0 },
                      })
                    }
                    min={0}
                    hideControls
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Reference Type</Text>
                  <TextInput
                    size="xs"
                    value={config.receiver.referenceType}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        receiver: { ...config.receiver, referenceType: e.currentTarget.value },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              <Divider my={4} />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>GPS</Text>
                  <Select
                    size="xs"
                    value={config.signalSelection.gps}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        signalSelection: { ...config.signalSelection, gps: value },
                      })
                    }
                    data={['L1/L2', 'L1/L5', 'L1/L2/L5']}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>QZSS</Text>
                  <Select
                    size="xs"
                    value={config.signalSelection.qzs}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        signalSelection: { ...config.signalSelection, qzs: value },
                      })
                    }
                    data={['L1/L5', 'L1/L2', 'L1/L5/L2']}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Galileo</Text>
                  <Select
                    size="xs"
                    value={config.signalSelection.galileo}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        signalSelection: { ...config.signalSelection, galileo: value },
                      })
                    }
                    data={['E1/E5a', 'E1/E5b', 'E1/E6', 'E1/E5a/E5b/E6', 'E1/E5a/E6/E5b']}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>BDS-2</Text>
                  <Select
                    size="xs"
                    value={config.signalSelection.bds2}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        signalSelection: { ...config.signalSelection, bds2: value },
                      })
                    }
                    data={['B1I/B3I', 'B1I/B2I', 'B1I/B3I/B2I']}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>BDS-3</Text>
                  <Select
                    size="xs"
                    value={config.signalSelection.bds3}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        signalSelection: { ...config.signalSelection, bds3: value },
                      })
                    }
                    data={['B1I/B3I', 'B1I/B2a', 'B1I/B3I/B2a']}
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── Antenna section ── */}
          {activeSection === 'antenna' && (
            <Stack gap="xs">
              <SectionHeader title="Rover Station" anchor="antenna-rover" />
              <StationPositionInput
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

              <SectionHeader title="Base Station" anchor="antenna-base" />
              <StationPositionInput
                value={config.antenna.base}
                onChange={(newBase) =>
                  handleConfigChange({
                    ...config,
                    antenna: { ...config.antenna, base: { ...config.antenna.base, ...newBase } },
                  })
                }
                disabled={isSingle}
              />
              <Group wrap="nowrap" align="center" gap="xs">
                <Text size="xs" c="dimmed" style={LABEL_STYLE}>Max Avg Epochs</Text>
                <NumberInput
                  size="xs"
                  value={config.antenna.base.maxAverageEpochs}
                  onChange={(v) =>
                    handleConfigChange({
                      ...config,
                      antenna: {
                        ...config.antenna,
                        base: { ...config.antenna.base, maxAverageEpochs: Number(v) || 0 },
                      },
                    })
                  }
                  min={0}
                  hideControls
                  style={{ flex: 1 }}
                />
              </Group>
              <Group wrap="nowrap" align="center" gap="xs">
                <Text size="xs" c="dimmed" style={LABEL_STYLE}>Init Reset</Text>
                <Switch
                  size="xs"
                  checked={config.antenna.base.initReset}
                  onChange={(e) =>
                    handleConfigChange({
                      ...config,
                      antenna: {
                        ...config.antenna,
                        base: { ...config.antenna.base, initReset: e.currentTarget.checked },
                      },
                    })
                  }
                />
              </Group>

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
          )}

          {/* ── Format section ── */}
          {activeSection === 'format' && (
            <Stack gap="xs">
              <SectionHeader title="Solution Output" anchor="output-solution" />
              {/* Group A: Format Configuration */}
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Solution Format</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

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

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Time Format</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}># of Decimals</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Lat/Lon Format</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Field Separator</Text>
                  <TextInput
                    size="xs"
                    placeholder="Space (default)"
                    value={config.output.fieldSeparator}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, fieldSeparator: e.currentTarget.value },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* Group B: Datum & Geoid */}
              <Divider my={4} />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Datum</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Height</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Geoid Model</Text>
                  <Select
                    size="xs"
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
                      { value: 'egm08_2.5', label: "EGM2008 (2.5' grid)" },
                      { value: 'egm08_1', label: "EGM2008 (1' grid)" },
                      { value: 'gsi2000', label: 'GSI2000 (Japan)' },
                    ]}
                    disabled={isSingle}
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* Group C: Output Control */}
              <Divider my={4} />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Static Sol Mode</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Single on Outage</Text>
                  <Checkbox
                    size="xs"
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
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>NMEA RMC/GGA (s)</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>NMEA GSA/GSV (s)</Text>
                  <NumberInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Sol Status</Text>
                  <Select
                    size="xs"
                    value={config.output.outputSolutionStatus}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, outputSolutionStatus: value as any },
                      })
                    }
                    data={[
                      { value: 'off', label: 'OFF' },
                      { value: 'state', label: 'State' },
                      { value: 'residual', label: 'Residual' },
                    ]}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Debug Trace</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── Files section ── */}
          {activeSection === 'files' && (
            <Stack gap="xs">
              {/* System Correction Files */}
              {!correctionsLoading && hasCorrections && (
                <>
                  <SectionHeader title="System Correction Files" anchor="files-aux" />
                  <Group gap="xs">
                    {(corrections.clas?.length ?? 0) > 0 && (
                      <Button size="xs" variant="light" onClick={() => applyProfile('clas')}>
                        Apply CLAS PPP-RTK profile
                      </Button>
                    )}
                    {(corrections.madoca?.length ?? 0) > 0 && (
                      <Button size="xs" variant="light" onClick={() => applyProfile('madoca')}>
                        Apply MADOCA PPP profile
                      </Button>
                    )}
                  </Group>
                  {(corrections.clas?.length ?? 0) > 0 && (
                    <>
                      <Text size="xs" fw={500} style={{ fontSize: '10px' }}>CLAS PPP-RTK</Text>
                      <Group gap={4} wrap="wrap">
                        {corrections.clas.map((f) => (
                          <Button
                            key={f.filename}
                            size="xs"
                            variant="light"
                            color="gray"
                            rightSection={<IconArrowRight size={10} />}
                            onClick={() => {
                              const fields = CORRECTION_FILE_FIELD[f.filename];
                              if (fields) {
                                const u: Record<string, string> = {};
                                for (const k of fields) u[k] = f.path;
                                handleConfigChange({
                                  ...config,
                                  files: { ...config.files, ...u },
                                });
                              }
                            }}
                          >
                            {f.filename}
                          </Button>
                        ))}
                      </Group>
                    </>
                  )}
                  {(corrections.madoca?.length ?? 0) > 0 && (
                    <>
                      <Text size="xs" fw={500} style={{ fontSize: '10px' }}>MADOCA PPP</Text>
                      <Group gap={4} wrap="wrap">
                        {corrections.madoca.map((f) => (
                          <Button
                            key={f.filename}
                            size="xs"
                            variant="light"
                            color="gray"
                            rightSection={<IconArrowRight size={10} />}
                            onClick={() => {
                              const fields = CORRECTION_FILE_FIELD[f.filename];
                              if (fields) {
                                const u: Record<string, string> = {};
                                for (const k of fields) u[k] = f.path;
                                handleConfigChange({
                                  ...config,
                                  files: { ...config.files, ...u },
                                });
                              }
                            }}
                          >
                            {f.filename}
                          </Button>
                        ))}
                      </Group>
                    </>
                  )}
                  {profileNotification && (
                    <Notification
                      icon={<IconCheck size={14} />}
                      color="green"
                      withCloseButton={false}
                      p="xs"
                    >
                      <Text size="xs">{profileNotification}</Text>
                    </Notification>
                  )}
                  <Divider my={4} />
                </>
              )}
              {correctionsLoading && (
                <Group justify="center" py="xs">
                  <Loader size="xs" />
                </Group>
              )}

              <SectionHeader title="Auxiliary Files" anchor="files-aux" />
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

              <FileInputRow
                label="Elevation Mask File"
                value={config.files.elevationMaskFile}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, elevationMaskFile: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, elevationMaskFile: path } })
                )}
              />

              <FileInputRow
                label="FCB File"
                value={config.files.fcb}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, fcb: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, fcb: path } })
                )}
              />

              <FileInputRow
                label="Bias SINEX File"
                value={config.files.biasSinex}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, biasSinex: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, biasSinex: path } })
                )}
              />

              <FileInputRow
                label="CSSR Grid File"
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

              <FileInputRow
                label="ISB Table File"
                value={config.files.isbTable}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, isbTable: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, isbTable: path } })
                )}
              />

              <FileInputRow
                label="Phase Cycle File"
                value={config.files.phaseCycle}
                onChange={(val) =>
                  handleConfigChange({
                    ...config,
                    files: { ...config.files, phaseCycle: val },
                  })
                }
                onBrowse={() => openFileBrowser((path) =>
                  handleConfigChange({ ...config, files: { ...config.files, phaseCycle: path } })
                )}
              />
            </Stack>
          )}

          {/* ── Server section ── */}
          {activeSection === 'server' && (
            <Stack gap="xs">
              <SectionHeader title="Server Options" anchor="server-options" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Base Interp.</Text>
                  <Select
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>SBAS Sat (0=All)</Text>
                  <NumberInput
                    size="xs"
                    value={Number(config.server.sbasSatellite)}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          sbasSatellite: String(value),
                        },
                      })
                    }
                    min={0}
                    max={255}
                    step={1}
                    hideControls
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              <Divider my={4} />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>RINEX (Rover)</Text>
                  <TextInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>RINEX (Base)</Text>
                  <TextInput
                    size="xs"
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
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>PPP Option</Text>
                  <TextInput
                    size="xs"
                    value={config.server.pppOption}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          pppOption: e.currentTarget.value,
                        },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>RTCM Option</Text>
                  <TextInput
                    size="xs"
                    value={config.server.rtcmOption}
                    onChange={(e: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          rtcmOption: e.currentTarget.value,
                        },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>L6 Margin</Text>
                  <NumberInput
                    size="xs"
                    value={config.server.l6Margin}
                    onChange={(value: any) =>
                      handleConfigChange({
                        ...config,
                        server: {
                          ...config.server,
                          l6Margin: Number(value) || 0,
                        },
                      })
                    }
                    min={0}
                    hideControls
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>
            </Stack>
          )}
        </ScrollArea>
      </Group>

      {/* Modals */}
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

      <SignalSelectModal
        opened={signalSelectOpened}
        onClose={() => setSignalSelectOpened(false)}
        value={config.positioning.signals}
        onChange={(signals) =>
          handleConfigChange({
            ...config,
            positioning: { ...config.positioning, signals, signalMode: signals ? 'signals' : 'frequency' },
          })
        }
      />

      <FileBrowserModal
        opened={fileBrowserOpened}
        onClose={() => setFileBrowserOpened(false)}
        onSelect={handleFileBrowserSelect}
        title="Select File"
        defaultRoot={fileBrowserRoot}
      />
    </>
  );
}

/**
 * TOML Configuration Preview as a right-side Drawer.
 */
export function TomlDrawer({ config, opened, onClose, streams }: { config: MrtkPostConfig; opened: boolean; onClose: () => void; streams?: Record<string, { type: string; path: string; format: string }> }) {
  const isPppRtk = config.positioning.positioningMode === 'ppp-rtk';

  const tomlPreview = useMemo(() => {
    const _s = (v: string) => `"${v}"`;
    const _b = (v: boolean) => v ? 'true' : 'false';
    const _f = (v: number) => v !== 0 && Math.abs(v) < 0.001 ? v.toExponential(2) : String(v);
    const p = config.positioning;
    const cor = p.corrections;
    const atm = p.atmosphere;
    const ar = config.ambiguityResolution;
    const kf = config.kalmanFilter;
    const rx = config.receiver;
    const ant = config.antenna;
    const out = config.output;
    const fl = config.files;
    const srv = config.server;
    const sig = config.signalSelection;

    // Value mappings: frontend values → MRTKLIB TOML values
    const FREQ: Record<string, string> = {
      'l1': 'l1', 'l1+l2': 'l1+2', 'l1+l2+l5': 'l1+2+3',
      'l1+l2+l5+l6': 'l1+2+3+4', 'l1+l2+l5+l6+l7': 'l1+2+3+4+5',
    };
    const EPHEM: Record<string, string> = {
      'broadcast': 'brdc', 'precise': 'precise', 'broadcast+sbas': 'brdc+sbas',
      'broadcast+ssrapc': 'brdc+ssrapc', 'broadcast+ssrcom': 'brdc+ssrcom',
    };
    const IONO: Record<string, string> = {
      'off': 'off', 'broadcast': 'brdc', 'sbas': 'sbas', 'dual-freq': 'dual-freq',
      'est-stec': 'est-stec', 'est-adaptive': 'est-adaptive', 'ionex-tec': 'ionex-tec', 'qzs-brdc': 'qzs-brdc',
    };
    const TROPO: Record<string, string> = {
      'off': 'off', 'saastamoinen': 'saas', 'sbas': 'sbas',
      'est-ztd': 'est-ztd', 'est-ztdgrad': 'est-ztdgrad',
    };

    const L: string[] = ['# MRTKLIB Configuration (TOML v1.0.0)', ''];

    L.push('[positioning]');
    L.push(`mode                = ${_s(p.positioningMode)}`);
    if (p.signals && p.signalMode === 'signals') {
      const sigs = p.signals.split(/[,\s]+/).filter(Boolean);
      L.push(`signals             = [${sigs.map(s => _s(s)).join(', ')}]`);
    } else {
      L.push(`frequency           = ${_s(FREQ[p.frequency] ?? p.frequency)}`);
    }
    L.push(`solution_type       = ${_s(p.filterType)}`);
    L.push(`elevation_mask      = ${p.elevationMask}`);
    L.push(`dynamics            = ${_b(p.receiverDynamics === 'on')}`);
    L.push(`satellite_ephemeris = ${_s(EPHEM[p.ephemerisOption] ?? p.ephemerisOption)}`);
    const systems: string[] = [];
    if (p.constellations.gps) systems.push('"GPS"');
    if (p.constellations.glonass) systems.push('"GLONASS"');
    if (p.constellations.galileo) systems.push('"Galileo"');
    if (p.constellations.qzss) systems.push('"QZSS"');
    if (p.constellations.sbas) systems.push('"SBAS"');
    if (p.constellations.beidou) systems.push('"BeiDou"');
    if (p.constellations.irnss) systems.push('"NavIC"');
    L.push(`systems             = [${systems.join(', ')}]`);
    L.push('');
    L.push('[positioning.corrections]');
    L.push(`satellite_antenna  = ${_b(cor.satelliteAntenna)}`);
    L.push(`receiver_antenna   = ${_b(cor.receiverAntenna)}`);
    L.push(`phase_windup       = ${_s(cor.phaseWindup)}`);
    L.push(`tidal_correction   = ${_s(cor.tidalCorrection)}`);
    L.push('');
    L.push('[positioning.atmosphere]');
    L.push(`ionosphere  = ${_s(IONO[atm.ionosphere] ?? atm.ionosphere)}`);
    L.push(`troposphere = ${_s(TROPO[atm.troposphere] ?? atm.troposphere)}`);
    L.push('');
    if (isPppRtk) {
      L.push('[positioning.clas]');
      L.push(`grid_selection_radius  = ${p.clas.gridSelectionRadius}`);
      L.push(`receiver_type          = ${_s(p.clas.receiverType)}`);
      L.push(`position_uncertainty_x = ${p.clas.positionUncertaintyX}`);
      L.push(`position_uncertainty_y = ${p.clas.positionUncertaintyY}`);
      L.push(`position_uncertainty_z = ${p.clas.positionUncertaintyZ}`);
      L.push('');
    }
    L.push('[ambiguity_resolution]');
    L.push(`mode       = ${_s(ar.mode)}`);
    L.push(`glonass_ar = ${_s(ar.glonassAr)}`);
    L.push(`bds_ar     = ${_s(ar.bdsAr)}`);
    L.push(`qzs_ar     = ${_s(ar.qzsAr)}`);
    L.push('');
    L.push('[ambiguity_resolution.thresholds]');
    L.push(`ratio          = ${ar.thresholds.ratio}`);
    L.push(`elevation_mask = ${ar.thresholds.elevationMask}`);
    L.push(`hold_elevation = ${ar.thresholds.holdElevation}`);
    L.push('');
    L.push('[ambiguity_resolution.counters]');
    L.push(`lock_count     = ${ar.counters.lockCount}`);
    L.push(`min_fix        = ${ar.counters.minFix}`);
    L.push(`max_iterations = ${ar.counters.maxIterations}`);
    L.push(`out_count      = ${ar.counters.outCount}`);
    L.push('');
    L.push('[rejection]');
    L.push(`innovation = ${config.rejection.innovation}`);
    L.push(`gdop       = ${config.rejection.gdop}`);
    L.push('');
    L.push('[slip_detection]');
    L.push(`threshold = ${config.slipDetection.threshold}`);
    L.push('');
    L.push('[kalman_filter]');
    L.push(`iterations    = ${kf.iterations}`);
    L.push(`sync_solution = ${_b(kf.syncSolution)}`);
    L.push('');
    L.push('[kalman_filter.measurement_error]');
    L.push(`code_phase_ratio_L1 = ${kf.measurementError.codePhaseRatioL1}`);
    L.push(`code_phase_ratio_L2 = ${kf.measurementError.codePhaseRatioL2}`);
    L.push(`phase               = ${kf.measurementError.phase}`);
    L.push(`doppler             = ${kf.measurementError.doppler}`);
    L.push('');
    L.push('[kalman_filter.process_noise]');
    L.push(`bias            = ${_f(kf.processNoise.bias)}`);
    L.push(`ionosphere      = ${kf.processNoise.ionosphere}`);
    L.push(`troposphere     = ${_f(kf.processNoise.troposphere)}`);
    L.push(`accel_h         = ${kf.processNoise.accelH}`);
    L.push(`accel_v         = ${kf.processNoise.accelV}`);
    L.push(`clock_stability = ${_f(kf.processNoise.clockStability)}`);
    L.push('');
    L.push('[signals]');
    L.push(`gps     = ${_s(sig.gps)}`);
    L.push(`qzs     = ${_s(sig.qzs)}`);
    L.push(`galileo = ${_s(sig.galileo)}`);
    L.push(`bds2    = ${_s(sig.bds2)}`);
    L.push(`bds3    = ${_s(sig.bds3)}`);
    L.push('');
    L.push('[receiver]');
    L.push(`iono_correction = ${_b(rx.ionoCorrection)}`);
    if (rx.maxAge !== 30) L.push(`max_age         = ${rx.maxAge}`);
    L.push('');
    L.push('[antenna.rover]');
    L.push(`position_type = ${_s(ant.rover.mode)}`);
    L.push(`position_1    = ${ant.rover.values[0]}`);
    L.push(`position_2    = ${ant.rover.values[1]}`);
    L.push(`position_3    = ${ant.rover.values[2]}`);
    L.push('');
    L.push('[antenna.base]');
    L.push(`position_type = ${_s(ant.base.mode)}`);
    L.push(`position_1    = ${ant.base.values[0]}`);
    L.push(`position_2    = ${ant.base.values[1]}`);
    L.push(`position_3    = ${ant.base.values[2]}`);
    L.push('');
    L.push('[output]');
    L.push(`format        = ${_s(out.solutionFormat)}`);
    L.push(`header        = ${_b(out.outputHeader)}`);
    L.push(`velocity      = ${_b(out.outputVelocity)}`);
    L.push('');
    L.push('[files]');
    if (fl.satelliteAtx) L.push(`satellite_atx = ${_s(fl.satelliteAtx)}`);
    if (fl.receiverAtx) L.push(`receiver_atx  = ${_s(fl.receiverAtx)}`);
    if (fl.cssrGrid) L.push(`cssr_grid     = ${_s(fl.cssrGrid)}`);
    L.push('');
    L.push('[server]');
    L.push(`cycle_ms           = ${srv.cycleMs ?? 10}`);
    L.push(`timeout_ms         = ${srv.timeoutMs ?? 10000}`);
    L.push(`reconnect_ms       = ${srv.reconnectMs ?? 10000}`);
    L.push(`nmea_cycle_ms      = ${srv.nmeaCycleMs ?? 5000}`);
    L.push(`buffer_size        = ${srv.bufferSize ?? 32768}`);
    L.push(`nav_msg_select     = ${_s(srv.navMsgSelect ?? 'all')}`);
    if (srv.proxy) L.push(`proxy              = ${_s(srv.proxy)}`);
    L.push(`swap_margin        = ${srv.swapMargin ?? 30}`);
    L.push(`time_interpolation = ${_b(srv.timeInterpolation ?? false)}`);
    L.push(`sbas_satellite     = ${_s(srv.sbasSatellite ?? '0')}`);
    if (srv.rinexOption1) L.push(`rinex_option_1     = ${_s(srv.rinexOption1)}`);
    if (srv.rinexOption2) L.push(`rinex_option_2     = ${_s(srv.rinexOption2)}`);
    if (srv.pppOption) L.push(`ppp_option         = ${_s(srv.pppOption)}`);
    if (srv.rtcmOption) L.push(`rtcm_option        = ${_s(srv.rtcmOption)}`);
    if (srv.l6Margin) L.push(`l6_margin          = ${srv.l6Margin}`);
    L.push('');

    // Streams section (RT mode only)
    if (streams) {
      for (const [key, s] of Object.entries(streams)) {
        L.push(`[streams.${key}]`);
        L.push(`type   = ${_s(s.type)}`);
        L.push(`path   = ${_s(s.path)}`);
        L.push(`format = ${_s(s.format)}`);
        L.push('');
      }
    }

    return L.join('\n');
  }, [config, isPppRtk, streams]);

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="md" title="TOML Configuration Preview">
      <ScrollArea h="calc(100vh - 80px)" style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: '4px',
        backgroundColor: 'var(--mantine-color-body)',
      }}>
        <pre style={{ margin: 0, padding: '8px', fontSize: '11px', lineHeight: 1.5 }}>
          {tomlPreview.split('\n').map((line, i) => {
            // Comment
            if (line.trimStart().startsWith('#')) {
              return <div key={i} style={{ color: 'var(--mantine-color-dimmed)' }}>{line}</div>;
            }
            // Section header [...]
            if (/^\s*\[/.test(line)) {
              return <div key={i} style={{ color: 'var(--mantine-color-blue-text)', fontWeight: 600 }}>{line}</div>;
            }
            // Key = value
            const eqIdx = line.indexOf('=');
            if (eqIdx > 0) {
              const key = line.slice(0, eqIdx);
              const val = line.slice(eqIdx);
              // Color strings, booleans, numbers differently
              let valColor = 'var(--mantine-color-text)';
              const trimVal = val.slice(1).trim();
              if (trimVal.startsWith('"')) valColor = 'var(--mantine-color-green-text)';
              else if (trimVal === 'true' || trimVal === 'false') valColor = 'var(--mantine-color-orange-text)';
              else if (trimVal.startsWith('[')) valColor = 'var(--mantine-color-violet-text)';
              else if (/^[\d.e+-]/.test(trimVal)) valColor = 'var(--mantine-color-cyan-text)';
              return (
                <div key={i}>
                  <span style={{ color: 'var(--mantine-color-red-text)' }}>{key}</span>
                  <span style={{ color: 'var(--mantine-color-dimmed)' }}>=</span>
                  <span style={{ color: valColor }}>{val.slice(1)}</span>
                </div>
              );
            }
            // Empty line
            return <div key={i}>{'\u00A0'}</div>;
          })}
        </pre>
      </ScrollArea>
    </Drawer>
  );
}
