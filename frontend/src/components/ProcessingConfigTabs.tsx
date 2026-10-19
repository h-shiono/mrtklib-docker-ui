import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Box,
  Stack,
  Text,
  Switch,
  Group,
  TextInput,
  Checkbox,
  Button,
  Tooltip,
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
  IconFolder,
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
  IconSearch,
} from '@tabler/icons-react';
import { DateTimePicker } from '@mantine/dates';
import dayjs from 'dayjs';
import type {
  MrtkPostConfig,
  CorrectionProvider,
  SnrMaskConfig,
  StationPosition,
} from '../types/mrtkPostConfig';
import { validCorrections } from '../types/mrtkPostConfig';
import { SnrMaskModal } from './SnrMaskModal';
import { SignalSelectModal } from './SignalSelectModal';
import { FileBrowserModal } from './FileBrowserModal';
import { OptionLabel, ComboLabel } from './common/OptionLabel';
import { ConfigNumberInput } from './common/ConfigNumberInput';
import { ConfigSelect } from './common/ConfigSelect';
import { useModeDependentDisable } from '../hooks/useModeDependentDisable';
import { DOCS_BASE as OPTION_DOCS_BASE } from '../config/optionMeta';
import { SECTION_SEARCH_TEXT } from '../config/sectionSearchIndex';

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
        <ConfigSelect
          size="xs"
          value={value.mode}
          onChange={(val) => onChange({ ...value, mode: val })}
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
        <ComboLabel label={value.mode === 'xyz' ? 'X / Y / Z (m)' : 'Lat / Lon / Hgt'} style={L}
          fields={[{ name: coordLabels[0] }, { name: coordLabels[1] }, { name: coordLabels[2] }]} />
        <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
          <ConfigNumberInput size="xs" title={coordLabels[0]} aria-label={coordLabels[0]} value={value.values[0]}
            onChange={(val) => onChange({ ...value, values: [val, value.values[1], value.values[2]] })}
            decimalScale={9} hideControls disabled={coordsDisabled || !isManualInput} style={{ flex: 1, minWidth: 0 }} />
          <ConfigNumberInput size="xs" title={coordLabels[1]} aria-label={coordLabels[1]} value={value.values[1]}
            onChange={(val) => onChange({ ...value, values: [value.values[0], val, value.values[2]] })}
            decimalScale={9} hideControls disabled={coordsDisabled || !isManualInput} style={{ flex: 1, minWidth: 0 }} />
          <ConfigNumberInput size="xs" title={coordLabels[2]} aria-label={coordLabels[2]} value={value.values[2]}
            onChange={(val) => onChange({ ...value, values: [value.values[0], value.values[1], val] })}
            decimalScale={4} hideControls disabled={coordsDisabled || !isManualInput} style={{ flex: 1, minWidth: 0 }} />
        </Group>
      </Group>
      <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
        <Text size="xs" c="dimmed" style={L}>Antenna Type</Text>
        <Checkbox
          size="xs"
          checked={value.antennaTypeEnabled}
          onChange={(e) => onChange({ ...value, antennaTypeEnabled: e.currentTarget.checked })}
          disabled={antennaDisabled}
        />
      </Group>
      {value.antennaTypeEnabled && (
        <Group wrap="nowrap" align="center" gap="xs">
          <Text size="xs" c="dimmed" style={L}>Antenna Name</Text>
          <TextInput
            size="xs"
            value={value.antennaType}
            onChange={(e) => onChange({ ...value, antennaType: e.currentTarget.value })}
            placeholder="e.g., AOAD/M_T"
            disabled={antennaDisabled}
            style={{ flex: 1 }}
          />
        </Group>
      )}
      <Group wrap="nowrap" align="center" gap="xs">
        <ComboLabel label="Delta E/N/U (m)" style={L}
          fields={[{ name: 'Delta-E (m)' }, { name: 'Delta-N (m)' }, { name: 'Delta-U (m)' }]} />
        <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
          <ConfigNumberInput size="xs" title="Delta-E (m)" aria-label="Delta-E" value={value.antennaDelta[0]}
            onChange={(val) => onChange({ ...value, antennaDelta: [val, value.antennaDelta[1], value.antennaDelta[2]] })}
            decimalScale={4} hideControls disabled={antennaDisabled} style={{ flex: 1, minWidth: 0 }} />
          <ConfigNumberInput size="xs" title="Delta-N (m)" aria-label="Delta-N" value={value.antennaDelta[1]}
            onChange={(val) => onChange({ ...value, antennaDelta: [value.antennaDelta[0], val, value.antennaDelta[2]] })}
            decimalScale={4} hideControls disabled={antennaDisabled} style={{ flex: 1, minWidth: 0 }} />
          <ConfigNumberInput size="xs" title="Delta-U (m)" aria-label="Delta-U" value={value.antennaDelta[2]}
            onChange={(val) => onChange({ ...value, antennaDelta: [value.antennaDelta[0], value.antennaDelta[1], val] })}
            decimalScale={4} hideControls disabled={antennaDisabled} style={{ flex: 1, minWidth: 0 }} />
        </Group>
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
          onChange={(e) => onChange(e.currentTarget.value)}
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
          <IconFolder size={16} />
        </ActionIcon>
      </Group>
    </div>
  );
}

// ─── Sidebar helper components ─────────────────────────────────────────────

// ─── Category rail row (console redesign Phase 3b re-skin) ───────────────────
// Rounded, accent-soft active highlight matching the Carbon/Azure prototype.
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
    <Indicator color="red" size={6} disabled={!showBadge} offset={8} position="middle-end">
      <UnstyledButton
        onClick={() => onClick(section)}
        style={{
          display: 'block',
          width: '100%',
          padding: '6px 9px',
          marginBottom: 2,
          borderRadius: 6,
          fontSize: '12px',
          backgroundColor: isActive ? 'var(--mantine-color-blue-light)' : 'transparent',
          color: isActive ? 'var(--mantine-color-blue-light-color)' : 'var(--mantine-color-dimmed)',
          fontWeight: isActive ? 600 : 400,
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
  'clas-amb':           '#positioning-clas-ambiguities',
  'clas-res':           '#positioning-clas-resilience',
  'spp':                '#positioning',
  'relative':           '#positioning-relative',
  'ppp':                '#positioning-ppp',
  'madoca':             '#positioning-madoca',
  'kf-iterations':      '#kalman-filter',
  'input-options':      '#input-rinex',
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
  'adaptive-filter':    '#positioning-clas-adaptive-filter',
  'signals':            '#positioning-signal-selection',
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

// [ambiguity_resolution].systems bits (MRTKLIB SYS_*); GLONASS has no PPP-AR.
const AR_SYSTEM_BITS = [
  { label: 'GPS', bit: 0x01 },
  { label: 'Galileo', bit: 0x08 },
  { label: 'QZSS', bit: 0x10 },
  { label: 'BeiDou', bit: 0x20 },
] as const;

// ─── Correction provider ([positioning] correction) ─────────────────────────
const CORRECTION_OPTIONS: { value: CorrectionProvider; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'igs', label: 'IGS (precise files)' },
  { value: 'igs-rts', label: 'IGS-RTS (RTCM-SSR)' },
  { value: 'qzs-madoca', label: 'MADOCA-PPP (QZSS L6E)' },
  { value: 'gal-has', label: 'Galileo HAS (E6B SSR)' },
  { value: 'bds-b2b', label: 'BeiDou PPP-B2b (reserved)' },
  { value: 'qzs-clas', label: 'CLAS (QZSS L6D)' },
];

// Correction-provider validity matrix lives in types/mrtkPostConfig
// (validCorrections / CORRECTION_BY_MODE) so import + UI share one source.

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
  const [sidebarFilter, setSidebarFilter] = useState('');

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
  const validCorr = validCorrections(config.positioning.positioningMode);
  // Adaptive Filter applies only to PPP-RTK / VRS-RTK.
  const isAdaptiveMode = ['ppp-rtk', 'vrs-rtk'].includes(config.positioning.positioningMode);
  // Relative (differential) positioning modes — those that use a base station.
  const isRelativeMode = ['dgps', 'kinematic', 'static', 'moving-base', 'fixed'].includes(
    config.positioning.positioningMode,
  );
  // CLAS group (grid/ambiguities/resilience/adaptive) applies to PPP-RTK / VRS-RTK.
  const isClasMode = isAdaptiveMode;

  // ── Category rail data (console redesign Phase 3b re-skin) ──
  // Same sections as before; only the presentation changes. The mode-specific
  // I/O category (Streams for RT / Input-Output Files for PP) is pinned to the top.
  interface RailItem { label: string; section: string; showBadge?: boolean }
  interface RailCategory { label: string; icon: React.ReactNode; topIO?: boolean; items: RailItem[] }
  const railCategories: RailCategory[] = [
    ...(streamPanels && streamPanels.length > 0
      ? [{ label: 'Streams', icon: <IconWifi size={12} />, topIO: true,
          items: streamPanels.map((sp) => ({ label: sp.label, section: sp.key })) }]
      : []),
    ...(execution
      ? [{ label: 'Input / Output Files', icon: <IconPlayerPlay size={12} />, topIO: true,
          items: [{ label: 'Input Files', section: 'input-files',
            showBadge: !execution.roverFile || !execution.navFile || !execution.outputFile }] }]
      : []),
    { label: 'Positioning', icon: <IconSatellite size={12} />, items: [
        { label: 'Mode', section: 'mode' },
        { label: 'Method', section: 'method' },
        { label: 'PPP / MADOCA', section: 'ppp' },
        { label: 'CLAS PPP-RTK/VRS', section: 'clas' },
        { label: 'AR', section: 'ar' },
        { label: 'Kalman Filter', section: 'kf' },
      ] },
    { label: 'Station', icon: <IconRadar size={12} />, items: [
        { label: 'Antenna', section: 'antenna' },
      ] },
    { label: 'Misc', icon: <IconFileExport size={12} />, items: [
        { label: 'Output Format', section: 'format' },
        { label: 'Input Options', section: 'input-options' },
        { label: 'Data Files', section: 'files' },
        { label: 'Server', section: 'server' },
      ] },
  ];
  // Filter matches the category label, the sub-item (section) label, AND that
  // section's field labels + TOML keys (SECTION_SEARCH_TEXT). Multi-word queries
  // use AND semantics so e.g. "ar ratio" or "elevation mask" both narrow well.
  const railTokens = sidebarFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleRail = railCategories
    .map((cat) => ({
      ...cat,
      items: railTokens.length === 0
        ? cat.items
        : cat.items.filter((it) => {
            const haystack = `${cat.label} ${it.label} ${SECTION_SEARCH_TEXT[it.section] ?? ''}`.toLowerCase();
            return railTokens.every((t) => haystack.includes(t));
          }),
    }))
    .filter((cat) => cat.items.length > 0);

  return (
    <>
      <Group gap={0} align="stretch" wrap="nowrap" style={{ minHeight: 400 }}>
        {/* Left category rail */}
        <Box
          style={{
            width: 168,
            flexShrink: 0,
            borderRight: '1px solid var(--app-border, var(--mantine-color-default-border))',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Box style={{ padding: '10px 9px 6px' }}>
            <TextInput
              size="xs"
              placeholder="Filter…"
              value={sidebarFilter}
              onChange={(e) => setSidebarFilter(e.currentTarget.value)}
              leftSection={<IconSearch size={12} />}
              styles={{ input: { fontSize: '11px' } }}
            />
          </Box>
          <ScrollArea style={{ flex: 1 }}>
            <Box px={8} pb={6}>
              {visibleRail.map((cat) => (
                <Box
                  key={cat.label}
                  mb={cat.topIO ? 6 : 2}
                  pb={cat.topIO ? 6 : 0}
                  style={cat.topIO ? { borderBottom: '1px solid var(--app-border, var(--mantine-color-default-border))' } : undefined}
                >
                  <Group gap={5} wrap="nowrap" style={{ padding: '9px 6px 5px', userSelect: 'none' }}>
                    {cat.icon}
                    <Text fw={600} c="dimmed" style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {cat.label}
                    </Text>
                  </Group>
                  {cat.items.map((it) => (
                    <SidebarItem
                      key={it.section}
                      label={it.label}
                      section={it.section}
                      active={activeSection}
                      onClick={setActiveSection}
                      showBadge={it.showBadge}
                    />
                  ))}
                </Box>
              ))}
            </Box>
          </ScrollArea>
        </Box>

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
                <ConfigNumberInput
                  size="xs"
                  value={config.time.interval}
                  onChange={(v) => handleConfigChange({ ...config, time: { ...config.time, interval: v } })}
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
                    <IconFolder size={16} />
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
                    <IconFolder size={16} />
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
                    <IconFolder size={16} />
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
                        <IconFolder size={16} />
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
                    <IconFolder size={16} />
                  </ActionIcon>
                </Group>
              </div>
              {/* Temporarily disabled until QC moves to MRTKLIB QC (backend returns
                  503). data-disabled, not disabled, so the tooltip still shows. */}
              <Tooltip label="Temporarily disabled — QC Preview will return with MRTKLIB QC integration">
                <Button variant="light" size="xs" leftSection={<IconChartBar size={14} />} data-disabled onClick={(e) => e.preventDefault()}>
                  QC Preview
                </Button>
              </Tooltip>
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
                  <ConfigSelect
                    size="xs"
                    value={config.positioning.positioningMode}
                    onChange={(newMode) => {
                      // Keep correction valid for the new mode (MRTKLIB rejects invalid combos)
                      const valid = validCorrections(newMode);
                      const correction = valid.includes(config.positioning.correction)
                        ? config.positioning.correction
                        : valid[0];
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          positioningMode: newMode,
                          correction,
                        },
                      });
                    }}
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
                      { value: 'vrs-rtk', label: 'VRS-RTK' },
                    ]}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.correction" style={OPT_LABEL_STYLE} />
                  <ConfigSelect
                    size="xs"
                    value={config.positioning.correction}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: { ...config.positioning, correction: value },
                      })
                    }
                    data={CORRECTION_OPTIONS.filter((o) => validCorr.includes(o.value))}
                    disabled={validCorr.length <= 1}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.solution_type" style={OPT_LABEL_STYLE} />
                  <ConfigSelect
                    size="xs"
                    value={config.positioning.filterType}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: { ...config.positioning, filterType: value },
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
                {/* Freq. / Signals — Frequency primary, Signals an advanced override */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Freq. / Signals</Text>
                  <Group wrap="nowrap" align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect
                      size="xs"
                      value={config.positioning.frequency}
                      onChange={(value) =>
                        handleConfigChange({
                          ...config,
                          positioning: { ...config.positioning, frequency: value },
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
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    {useSignals && (
                      <Text c="dimmed" fs="italic" style={{ fontSize: '9px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        overridden
                      </Text>
                    )}
                    <Button
                      size="xs"
                      variant={useSignals ? 'filled' : 'light'}
                      onClick={() => setSignalSelectOpened(true)}
                      disabled={!canUseSignals}
                      style={{ flexShrink: 0 }}
                    >
                      {isMadocaPPP
                        ? 'N/A'
                        : useSignals
                          ? `${config.positioning.signals.split(',').filter(Boolean).length} signals`
                          : 'Signals…'}
                    </Button>
                    {useSignals && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        style={{ flexShrink: 0 }}
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
                </Group>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <OptionLabel metaKey="positioning.dynamics" style={OPT_LABEL_STYLE} />
                  <Switch
                    size="xs"
                    checked={config.positioning.receiverDynamics === 'on'}
                    onChange={(e) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          receiverDynamics: e.currentTarget.checked ? 'on' : 'off',
                        },
                      })
                    }
                    disabled={!isReceiverDynamicsEnabled}
                  />
                </Group>
              </Stack>

              {/* Group B: Masks & Environment */}
              <SectionHeader title="Masks & Environment" anchor="masks" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="positioning.elevation_mask" style={OPT_LABEL_STYLE} />
                  <ConfigNumberInput
                    size="xs"
                    value={config.positioning.elevationMask}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          elevationMask: value,
                        },
                      })
                    }
                    min={0}
                    max={90}
                    hideControls
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
                  <ConfigSelect
                    size="xs"
                    value={config.positioning.atmosphere.ionosphere}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          atmosphere: { ...config.positioning.atmosphere, ionosphere: value },
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
                  <ConfigSelect
                    size="xs"
                    value={config.positioning.atmosphere.troposphere}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          atmosphere: { ...config.positioning.atmosphere, troposphere: value },
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
                  <ConfigSelect
                    size="xs"
                    value={config.positioning.ephemerisOption}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          ephemerisOption: value,
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

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Earth Tides</Text>
                  <ConfigSelect
                    size="xs"
                    value={config.positioning.corrections.tidalCorrection}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        positioning: {
                          ...config.positioning,
                          corrections: { ...config.positioning.corrections, tidalCorrection: value },
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

                <Group justify="space-between" gap="md" mt={6}>
                  <Switch
                    size="xs"
                    label="Sat PCV"
                    checked={config.positioning.corrections.satelliteAntenna}
                    onChange={(e) =>
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
                    onChange={(e) =>
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
                    onChange={(e) =>
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
                    onChange={(e) =>
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
                    onChange={(e) =>
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

              {/* Corrections ([positioning.corrections] — bias / frequency / model options) */}
              <SectionHeader title="Corrections" anchor="corrections" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iono Compensation</Text>
                  <ConfigSelect size="xs" value={config.positioning.corrections.ionoCompensation}
                    onChange={(value) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, ionoCompensation: value } } })}
                    data={[{ value: 'off', label: 'OFF' }, { value: 'ssr', label: 'SSR' }, { value: 'meas', label: 'Measured' }]}
                    style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="GPS / QZS Freq" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'GPS' }, { name: 'QZS' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="GPS frequency" aria-label="GPS frequency" value={config.positioning.corrections.gpsFrequency}
                      onChange={(value) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, gpsFrequency: value } } })}
                      data={['l1', 'l1+l2', 'l1+l5', 'l1+l2+l5', 'l1+l5(l2)']} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="QZS frequency" aria-label="QZS frequency" value={config.positioning.corrections.qzsFrequency}
                      onChange={(value) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, qzsFrequency: value } } })}
                      data={['l1', 'l1+l2', 'l1+l5', 'l1+l2+l5', 'l1+l5(l2)']} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>SNR Fixed (dB-Hz)</Text>
                  <ConfigNumberInput size="xs" value={config.positioning.corrections.snrFixed}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, snrFixed: v } } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group justify="space-between" gap="md" mt={6}>
                  <Switch size="xs" label="Partial AR" checked={config.positioning.corrections.partialAr}
                    onChange={(e) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, partialAr: e.currentTarget.checked } } })}
                    styles={{ label: { fontSize: '10px' } }} />
                  <Switch size="xs" label="Shapiro" checked={config.positioning.corrections.shapiroDelay} disabled={!isPPP}
                    onChange={(e) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, shapiroDelay: e.currentTarget.checked } } })}
                    styles={{ label: { fontSize: '10px' } }} />
                  <Switch size="xs" label="Excl QZS Ref" checked={config.positioning.corrections.excludeQzsRef}
                    onChange={(e) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, excludeQzsRef: e.currentTarget.checked } } })}
                    styles={{ label: { fontSize: '10px' } }} />
                  <Switch size="xs" label="No Phase Bias Adj" checked={config.positioning.corrections.noPhaseBiasAdj}
                    onChange={(e) => handleConfigChange({ ...config, positioning: { ...config.positioning, corrections: { ...config.positioning.corrections, noPhaseBiasAdj: e.currentTarget.checked } } })}
                    styles={{ label: { fontSize: '10px' } }} />
                </Group>
              </Stack>

              {/* Group C: Satellite Selection */}
              <SectionHeader title="Satellite Selection" anchor="satellites" />
              <Stack gap={6}>
                <Text size="xs" style={{ fontSize: '10px' }}>
                  Constellations
                </Text>
                <Group justify="space-between" gap="md">
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
                  onChange={(e) =>
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

          {/* ── CLAS PPP-RTK/VRS section (incl. AR significance level + Adaptive Filter — PPP-RTK / VRS only) ── */}
          {activeSection === 'clas' && (
            <Stack gap="xs">
              <SectionHeader title="CLAS PPP-RTK/VRS" anchor="clas-ppk" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Grid Radius (m)</Text>
                  <ConfigNumberInput size="xs"
                    value={config.positioning.clas.gridSelectionRadius}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, gridSelectionRadius: v } } })}
                    min={0} hideControls disabled={!isClasMode} style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Receiver Type</Text>
                  <TextInput size="xs"
                    value={config.positioning.clas.receiverType}
                    onChange={(e) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, receiverType: e.currentTarget.value } } })}
                    placeholder="e.g. Trimble NetR9" disabled={!isClasMode} style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Enhanced SPP Seed</Text>
                  <ConfigSelect size="xs" value={config.positioning.clas.enhancedSppSeed}
                    onChange={(value) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, enhancedSppSeed: value } } })}
                    data={[{ value: 'off', label: 'OFF' }, { value: 'cn0+tdcp', label: 'C/N0 + TDCP' }, { value: 'cn0+tdcp+robust', label: 'C/N0 + TDCP + Robust' }]}
                    disabled={!isClasMode} style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.alpha" style={OPT_LABEL_STYLE} />
                  <ConfigSelect size="xs" value={config.ambiguityResolution.thresholds.alpha}
                    onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, alpha: value}}})}
                    data={['0.1%', '0.5%', '1%', '5%', '10%', '20%']}
                    disabled={modeDisabled('ar.thresholds.alpha')} style={{flex:1}} />
                </Group>
              </Stack>

              <SectionHeader title="CLAS Ambiguities" anchor="clas-amb" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Phase Shift</Text>
                  <ConfigSelect size="xs" value={config.receiver.phaseShift} disabled={!isClasMode}
                    onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, phaseShift: value } })}
                    data={[{ value: 'off', label: 'OFF' }, { value: 'table', label: 'Table' }]}
                    style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>ISB</Text>
                  <Switch size="xs" checked={config.receiver.isb} disabled={!isClasMode}
                    onChange={(e) => handleConfigChange({ ...config, receiver: { ...config.receiver, isb: e.currentTarget.checked } })} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Reference Type</Text>
                  <TextInput size="xs" value={config.receiver.referenceType} disabled={!isClasMode}
                    onChange={(e) => handleConfigChange({ ...config, receiver: { ...config.receiver, referenceType: e.currentTarget.value } })}
                    placeholder="CLAS" style={{ flex: 1 }} />
                </Group>
              </Stack>

              <SectionHeader title="CLAS Resilience" anchor="clas-res" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Max Obs Loss (%)</Text>
                  <ConfigNumberInput size="xs" value={config.server.maxObsLoss ?? 90} disabled={!isClasMode}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, maxObsLoss: v } })}
                    min={0} max={100} decimalScale={1} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Float Count</Text>
                  <ConfigNumberInput size="xs" value={config.server.floatCount ?? 15} disabled={!isClasMode}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, floatCount: v } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>L6 Merge</Text>
                  <ConfigNumberInput size="xs" value={config.positioning.clas.l6Merge} disabled={!isClasMode}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, l6Merge: v } } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Reset Interval</Text>
                  <ConfigNumberInput size="xs" value={config.positioning.clas.resetInterval} disabled={!isClasMode}
                    onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, clas: { ...config.positioning.clas, resetInterval: v } } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
              </Stack>

              <SectionHeader title="CLAS Adaptive Filter" anchor="adaptive-filter" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Enabled</Text>
                  <Switch size="xs" checked={config.adaptiveFilter.enabled}
                    disabled={!isAdaptiveMode}
                    onChange={(e) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, enabled: e.currentTarget.checked}})} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Iono Forget / Gain" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'Forget', metaKey: 'adaptive.iono_forgetting' }, { name: 'Gain' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Iono forgetting factor" aria-label="Iono forgetting factor" value={config.adaptiveFilter.ionoForgetting}
                      onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, ionoForgetting: v}})}
                      disabled={!isAdaptiveMode} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Iono gain" aria-label="Iono gain" value={config.adaptiveFilter.ionoGain}
                      onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, ionoGain: v}})}
                      disabled={!isAdaptiveMode} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="PVA Forget / Gain" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'Forget', metaKey: 'adaptive.pva_forgetting' }, { name: 'Gain' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="PVA forgetting factor" aria-label="PVA forgetting factor" value={config.adaptiveFilter.pvaForgetting}
                      onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, pvaForgetting: v}})}
                      disabled={!isAdaptiveMode} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="PVA gain" aria-label="PVA gain" value={config.adaptiveFilter.pvaGain}
                      onChange={(v) => handleConfigChange({...config, adaptiveFilter: {...config.adaptiveFilter, pvaGain: v}})}
                      disabled={!isAdaptiveMode} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </Stack>
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
                  <ConfigSelect
                    size="xs"
                    value={config.ambiguityResolution.mode}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, mode: value },
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
                {/* Per-system AR — GPS / GLO / BDS / QZS on one row */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="AR GPS/GLO/BDS/QZS" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'GPS', metaKey: 'ar.gps_ar' },
                      { name: 'GLONASS', metaKey: 'ar.glonass_ar' },
                      { name: 'BeiDou', metaKey: 'ar.bds_ar' },
                      { name: 'QZSS', metaKey: 'ar.qzs_ar' },
                    ]} />
                  <Group wrap="nowrap" align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="GPS AR" aria-label="GPS AR" value={config.ambiguityResolution.gpsAr ? 'on' : 'off'}
                      onChange={(value) => handleConfigChange({ ...config, ambiguityResolution: { ...config.ambiguityResolution, gpsAr: value === 'on' } })}
                      data={[{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }]}
                      disabled={modeDisabled('ar.gps_ar')} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="GLONASS AR" aria-label="GLONASS AR" value={config.ambiguityResolution.glonassAr}
                      onChange={(value) => handleConfigChange({ ...config, ambiguityResolution: { ...config.ambiguityResolution, glonassAr: value } })}
                      data={[{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }, { value: 'autocal', label: 'AutoCal' }]}
                      disabled={modeDisabled('ar.glonass_ar')} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="BeiDou AR" aria-label="BeiDou AR" value={config.ambiguityResolution.bdsAr}
                      onChange={(value) => handleConfigChange({ ...config, ambiguityResolution: { ...config.ambiguityResolution, bdsAr: value } })}
                      data={[{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }]}
                      disabled={modeDisabled('ar.bds_ar')} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="QZSS AR" aria-label="QZSS AR" value={config.ambiguityResolution.qzsAr}
                      onChange={(value) => handleConfigChange({ ...config, ambiguityResolution: { ...config.ambiguityResolution, qzsAr: value } })}
                      data={[{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }]}
                      disabled={modeDisabled('ar.qzs_ar')} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* PPP-AR constellations ([ambiguity_resolution].systems bitmask) */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.systems" style={OPT_LABEL_STYLE} />
                  <Group wrap="nowrap" align="center" gap="sm" style={{ flex: 1, minWidth: 0 }}>
                    {AR_SYSTEM_BITS.map(({ label, bit }) => (
                      <Checkbox
                        key={bit}
                        size="xs"
                        label={label}
                        checked={(config.ambiguityResolution.systems & bit) !== 0}
                        onChange={(e) => handleConfigChange({
                          ...config,
                          ambiguityResolution: {
                            ...config.ambiguityResolution,
                            systems: e.currentTarget.checked
                              ? config.ambiguityResolution.systems | bit
                              : config.ambiguityResolution.systems & ~bit,
                          },
                        })}
                        disabled={modeDisabled('ar.systems')}
                      />
                    ))}
                  </Group>
                </Group>
              </Stack>

              {/* AR Thresholds */}
              <SectionHeader title="Thresholds" anchor="ar-thresholds" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="ar.thresholds.ratio" style={OPT_LABEL_STYLE} />
                  <ConfigNumberInput
                    size="xs"
                    value={config.ambiguityResolution.thresholds.ratio}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        ambiguityResolution: { ...config.ambiguityResolution, thresholds: { ...config.ambiguityResolution.thresholds, ratio: value } },
                      })
                    }
                    min={1}
                    max={10}
                    step={0.1}
                    decimalScale={1}
                    hideControls
                    disabled={modeDisabled('ar.thresholds.ratio')}
                    style={{ flex: 1 }}
                  />
                </Group>
                {/* Elevation Mask: AR / Hold on one row */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Elev. Mask AR/Hold (°)" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'AR', metaKey: 'ar.thresholds.elevation_mask' },
                      { name: 'Hold', metaKey: 'ar.thresholds.hold_elevation' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Elev. Mask AR/Hold (°) AR" aria-label="AR Elevation Mask"
                      value={config.ambiguityResolution.thresholds.elevationMask}
                      onChange={(value) => handleConfigChange({ ...config, ambiguityResolution: { ...config.ambiguityResolution, thresholds: { ...config.ambiguityResolution.thresholds, elevationMask: value } } })}
                      min={0} max={90} hideControls disabled={modeDisabled('ar.thresholds.elevation_mask')}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Elev. Mask AR/Hold (°) Hold" aria-label="Hold Elevation Mask"
                      value={config.ambiguityResolution.thresholds.holdElevation}
                      onChange={(value) => handleConfigChange({ ...config, ambiguityResolution: { ...config.ambiguityResolution, thresholds: { ...config.ambiguityResolution.thresholds, holdElevation: value } } })}
                      min={0} max={90} hideControls disabled={modeDisabled('ar.thresholds.hold_elevation')}
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Ratio 1 / 5 / 6 (v0.7.6: ratio2/3/4 removed) */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Ratio 1 / 5 / 6" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Ratio 1', metaKey: 'ar.thresholds.ratio1' },
                      { name: 'Ratio 5', metaKey: 'ar.thresholds.ratio5' },
                      { name: 'Ratio 6', metaKey: 'ar.thresholds.ratio6' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Ratio 1" aria-label="Ratio 1" value={config.ambiguityResolution.thresholds.ratio1}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio1: value}}})}
                      decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio1')}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Ratio 5" aria-label="Ratio 5" value={config.ambiguityResolution.thresholds.ratio5}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio5: value}}})}
                      decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio5')}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Ratio 6" aria-label="Ratio 6" value={config.ambiguityResolution.thresholds.ratio6}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, ratio6: value}}})}
                      decimalScale={4} hideControls disabled={modeDisabled('ar.thresholds.ratio6')}
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Max PDOP AR/Hold (v0.7.6) */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Max PDOP AR/Hold" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'AR' }, { name: 'Hold' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Max PDOP AR (0: no limit)" aria-label="Max PDOP AR" value={config.ambiguityResolution.thresholds.maxPdopAr}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, maxPdopAr: value}}})}
                      min={0} decimalScale={1} hideControls disabled={modeDisabled('ar.mode')}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Max PDOP Hold (0: no limit)" aria-label="Max PDOP Hold" value={config.ambiguityResolution.thresholds.maxPdopHold}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, maxPdopHold: value}}})}
                      min={0} decimalScale={1} hideControls disabled={modeDisabled('ar.mode')}
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Reference DOP (v0.7.6) */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Reference DOP</Text>
                  <ConfigSelect size="xs" value={config.ambiguityResolution.thresholds.referenceDop}
                    onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, thresholds: {...config.ambiguityResolution.thresholds, referenceDop: value}}})}
                    data={[{ value: 'zd', label: 'Zero-Diff' }, { value: 'sd', label: 'Single-Diff' }]}
                    disabled={modeDisabled('ar.mode')} style={{ flex: 1 }} />
                </Group>
              </Stack>

              {/* AR Counters */}
              <Divider my={4} />
              <Stack gap={6}>
                {/* Lock Count + Min Fix Epochs on one row */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Lock Cnt / Min Fix Eps" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Lock Count', metaKey: 'ar.counters.lock_count' },
                      { name: 'Min Fix Epochs', metaKey: 'ar.counters.min_fix' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Lock Cnt / Fix Ep Lock Count" aria-label="Lock Count" value={config.ambiguityResolution.counters.lockCount}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, counters: {...config.ambiguityResolution.counters, lockCount: value}}})}
                      min={0} hideControls disabled={modeDisabled('ar.counters.lock_count')}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Lock Cnt / Fix Ep Min Fix Epochs" aria-label="Min Fix Epochs" value={config.ambiguityResolution.counters.minFix}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, counters: {...config.ambiguityResolution.counters, minFix: value}}})}
                      min={0} hideControls disabled={modeDisabled('ar.counters.min_fix')}
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Max Iterations + Outage Reset Count on one row */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Max Iter / Out Cnt" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Max Iterations', metaKey: 'ar.counters.max_iterations' },
                      { name: 'Outage Reset', metaKey: 'ar.counters.out_count' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Max Iter / Out Cnt Max Iterations" aria-label="Max LAMBDA Iterations" value={config.ambiguityResolution.counters.maxIterations}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, counters: {...config.ambiguityResolution.counters, maxIterations: value}}})}
                      min={1} max={10} hideControls disabled={modeDisabled('ar.counters.max_iterations')}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Max Iter / Out Cnt Outage Reset" aria-label="Outage Reset Count" value={config.ambiguityResolution.counters.outCount}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, counters: {...config.ambiguityResolution.counters, outCount: value}}})}
                      min={0} step={1} hideControls disabled={modeDisabled('ar.counters.out_count')}
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </Stack>

              {/* Slip Detection */}
              <SectionHeader title="Cycle Slip Detection" anchor="ar-cycleslip" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="slip.threshold" style={OPT_LABEL_STYLE} />
                  <ConfigNumberInput
                    size="xs"
                    value={config.slipDetection.threshold}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        slipDetection: { ...config.slipDetection, threshold: value },
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
                {/* Min Ambiguities + Max Excluded Sats */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Min Amb / Max Excl" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Min Ambiguities', metaKey: 'ar.partial_ar.min_ambiguities' },
                      { name: 'Max Excluded Sats', metaKey: 'ar.partial_ar.max_excluded_sats' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Min Amb / Max Excl Min Ambiguities" aria-label="Min Ambiguities" value={config.ambiguityResolution.partialAr.minAmbiguities}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minAmbiguities: value}}})}
                      disabled={modeDisabled('ar.partial_ar.min_ambiguities')} decimalScale={4} hideControls
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Min Amb / Max Excl Max Excluded Sats" aria-label="Max Excluded Sats" value={config.ambiguityResolution.partialAr.maxExcludedSats}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, maxExcludedSats: value}}})}
                      disabled={modeDisabled('ar.partial_ar.max_excluded_sats')} decimalScale={4} hideControls
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Min Fix / Drop / Hold Pairs */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Min Pairs Fix/Drop/Hold" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Fix', metaKey: 'ar.partial_ar.min_fix_sats' },
                      { name: 'Drop', metaKey: 'ar.partial_ar.min_drop_sats' },
                      { name: 'Hold', metaKey: 'ar.partial_ar.min_hold_sats' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Min Pairs Fix" aria-label="Min Fix Pairs" value={config.ambiguityResolution.partialAr.minFixSats}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minFixSats: value}}})}
                      disabled={modeDisabled('ar.partial_ar.min_fix_sats')} decimalScale={4} hideControls
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Min Pairs Drop" aria-label="Min Drop Pairs" value={config.ambiguityResolution.partialAr.minDropSats}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minDropSats: value}}})}
                      disabled={modeDisabled('ar.partial_ar.min_drop_sats')} decimalScale={4} hideControls
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Min Pairs Hold" aria-label="Min Hold Pairs" value={config.ambiguityResolution.partialAr.minHoldSats}
                      onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, partialAr: {...config.ambiguityResolution.partialAr, minHoldSats: value}}})}
                      disabled={modeDisabled('ar.partial_ar.min_hold_sats')} decimalScale={4} hideControls
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
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
                  <ConfigNumberInput size="xs" value={config.ambiguityResolution.hold.variance}
                    onChange={(value) => handleConfigChange({...config, ambiguityResolution: {...config.ambiguityResolution, hold: {...config.ambiguityResolution.hold, variance: value}}})}
                    decimalScale={4} hideControls style={{ flex: 1 }} />
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── Kalman Filter section ── */}
          {activeSection === 'kf' && (
            <Stack gap="xs">
              <SectionHeader title="Iterations" anchor="kf-iterations" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iterations</Text>
                  <ConfigNumberInput size="xs" value={config.kalmanFilter.iterations}
                    onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, iterations: value}})}
                    min={1} max={10} hideControls style={{ flex: 1 }} />
                </Group>
              </Stack>

              {/* Measurement Error */}
              <SectionHeader title="Measurement Error" anchor="kf-measurement" />
              <Stack gap={6}>
                {/* Code/Phase Ratio L1/L2/L5 */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Code/Phase Ratio L1/L2/L5" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'L1', metaKey: 'kf.meas.code_phase_ratio_L1' },
                      { name: 'L2' },
                      { name: 'L5' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Code/Phase Ratio L1" aria-label="Code/Phase Ratio L1" value={config.kalmanFilter.measurementError.codePhaseRatioL1}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, codePhaseRatioL1: value}}})}
                      min={0} step={1} decimalScale={1} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Code/Phase Ratio L2" aria-label="Code/Phase Ratio L2" value={config.kalmanFilter.measurementError.codePhaseRatioL2}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, codePhaseRatioL2: value}}})}
                      min={0} step={1} decimalScale={1} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Code/Phase Ratio L5" aria-label="Code/Phase Ratio L5" value={config.kalmanFilter.measurementError.codePhaseRatioL5}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, codePhaseRatioL5: v}}})}
                      min={0} decimalScale={1} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>

                {/* Phase Error Base / Elevation / Baseline */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Phase Error Base/Elev/BL" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Base', metaKey: 'kf.meas.phase' },
                      { name: 'Elevation', metaKey: 'kf.meas.phase_elevation' },
                      { name: 'Baseline', metaKey: 'kf.meas.phase_baseline' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Phase Error Base" aria-label="Phase Error Base" value={config.kalmanFilter.measurementError.phase}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, phase: value}}})}
                      min={0} step={0.001} decimalScale={3} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Phase Error Elevation" aria-label="Phase Error Elevation" value={config.kalmanFilter.measurementError.phaseElevation}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, phaseElevation: value}}})}
                      min={0} step={0.001} decimalScale={3} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Phase Error Baseline" aria-label="Phase Error Baseline" value={config.kalmanFilter.measurementError.phaseBaseline}
                      disabled={modeDisabled('kf.meas.phase_baseline')}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, phaseBaseline: value}}})}
                      min={0} step={0.001} decimalScale={3} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>

                {/* Doppler / URA Ratio */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Doppler / URA Ratio" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Doppler' },
                      { name: 'URA Ratio', metaKey: 'kf.meas.ura_ratio' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Doppler / URA Doppler" aria-label="Doppler (Hz)" value={config.kalmanFilter.measurementError.doppler}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, doppler: value}}})}
                      min={0} step={0.1} decimalScale={1} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Doppler / URA URA Ratio" aria-label="URA Ratio" value={config.kalmanFilter.measurementError.uraRatio}
                      disabled={modeDisabled('kf.meas.ura_ratio')}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, uraRatio: v}}})}
                      min={0} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* SNR Max / Error (v0.7.6) */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="SNR Max / Error" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'SNR Max' }, { name: 'SNR Error' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="SNR Max (dB-Hz)" aria-label="SNR Max" value={config.kalmanFilter.measurementError.snrMax}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, snrMax: v}}})}
                      min={0} decimalScale={1} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="SNR Error" aria-label="SNR Error" value={config.kalmanFilter.measurementError.snrError}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, snrError: v}}})}
                      min={0} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Iono / Tropo estimation error (v0.7.6) */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Iono / Tropo Error (m)" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'Iono' }, { name: 'Tropo' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Ionosphere error (m)" aria-label="Ionosphere error" value={config.kalmanFilter.measurementError.ionosphere}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, ionosphere: v}}})}
                      min={0} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Troposphere error (m)" aria-label="Troposphere error" value={config.kalmanFilter.measurementError.troposphere}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, measurementError: {...config.kalmanFilter.measurementError, troposphere: v}}})}
                      min={0} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </Stack>

              {/* Process Noise */}
              <SectionHeader title="Process Noise" anchor="kf-process" />
              <Stack gap={6}>
                {/* Accel Noise Horizontal / Vertical */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Accel Noise Hor/Ver" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Horizontal', metaKey: 'kf.pn.accel_h' },
                      { name: 'Vertical', metaKey: 'kf.pn.accel_v' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Accel Noise H/V Horizontal" aria-label="Accel Noise Horizontal" value={config.kalmanFilter.processNoise.accelH}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, accelH: value}}})}
                      min={0} step={0.1} decimalScale={1} hideControls
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Accel Noise H/V Vertical" aria-label="Accel Noise Vertical" value={config.kalmanFilter.processNoise.accelV}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, accelV: value}}})}
                      min={0} step={0.01} decimalScale={2} hideControls
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>

                {/* Phase Bias / Iono / ZTD */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="PB / Iono / ZTD" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Phase Bias' },
                      { name: 'Iono' },
                      { name: 'ZTD' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="PB / Iono / ZTD Phase Bias" aria-label="Phase Bias (cycle)" value={config.kalmanFilter.processNoise.bias}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, bias: value}}})}
                      min={0} step={0.0001} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="PB / Iono / ZTD Iono" aria-label="Iono (m/10km)" value={config.kalmanFilter.processNoise.ionosphere}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, ionosphere: value}}})}
                      min={0} step={0.001} decimalScale={3} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="PB / Iono / ZTD ZTD" aria-label="ZTD (m)" value={config.kalmanFilter.processNoise.troposphere}
                      onChange={(value) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, troposphere: value}}})}
                      min={0} step={0.0001} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
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
                  <ConfigNumberInput size="xs" value={config.kalmanFilter.processNoise.ionoMax}
                    disabled={modeDisabled('kf.pn.iono_max')}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, ionoMax: v}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                {/* Position H / V */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Position H/V (m)" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Horizontal' },
                      { name: 'Vertical' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Position H/V Horizontal" aria-label="Position H" value={config.kalmanFilter.processNoise.positionH}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, positionH: v}}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Position H/V Vertical" aria-label="Position V" value={config.kalmanFilter.processNoise.positionV}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, positionV: v}}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.pn.position" style={OPT_LABEL_STYLE} />
                  <ConfigNumberInput size="xs" value={config.kalmanFilter.processNoise.position}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, position: v}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="kf.pn.ifb" style={OPT_LABEL_STYLE} />
                  <ConfigNumberInput size="xs" value={config.kalmanFilter.processNoise.ifb}
                    disabled={modeDisabled('kf.pn.ifb')}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, ifb: v}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iono Time Const</Text>
                  <ConfigNumberInput size="xs" value={config.kalmanFilter.processNoise.ionoTimeConst}
                    onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, processNoise: {...config.kalmanFilter.processNoise, ionoTimeConst: v}}})}
                    decimalScale={4} hideControls style={{flex:1}} />
                </Group>
              </Stack>

              {/* Initial Std. Deviation */}
              <SectionHeader title="Initial Std. Deviation" anchor="kf-initial-std" />
              <Stack gap={6}>
                {/* Initial Std: Bias / Iono / Trop */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Bias / Iono / Trop" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Bias' },
                      { name: 'Iono' },
                      { name: 'Trop' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Bias / Iono / Trop Bias" aria-label="Initial Std Bias" value={config.kalmanFilter.initialStd.bias}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, initialStd: {...config.kalmanFilter.initialStd, bias: v}}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Bias / Iono / Trop Iono" aria-label="Initial Std Ionosphere" value={config.kalmanFilter.initialStd.ionosphere}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, initialStd: {...config.kalmanFilter.initialStd, ionosphere: v}}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Bias / Iono / Trop Trop" aria-label="Initial Std Troposphere" value={config.kalmanFilter.initialStd.troposphere}
                      onChange={(v) => handleConfigChange({...config, kalmanFilter: {...config.kalmanFilter, initialStd: {...config.kalmanFilter.initialStd, troposphere: v}}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </Stack>

              {/* Rejection Criteria (merged from the former Advanced section) */}
              <SectionHeader title="Rejection Criteria" anchor="rejection" />
              <Stack gap={6}>
                {/* Innovation Threshold + L1/L2 Residual */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Innov Thr / Res L1/L2" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Innovation Threshold', metaKey: 'rejection.innovation' },
                      { name: 'L1/L2 Residual', metaKey: 'rejection.l1_l2_residual' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Innovation Threshold" aria-label="Innovation Threshold" value={config.rejection.innovation}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, innovation: v}})}
                      disabled={modeDisabled('rejection.innovation')} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="L1/L2 Residual" aria-label="L1/L2 Residual" value={config.rejection.l1L2Residual}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, l1L2Residual: v}})}
                      disabled={modeDisabled('rejection.l1_l2_residual')} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Dispersive + Non-Dispersive Residual */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Disp / Non-Disp Res" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Dispersive Residual', metaKey: 'rejection.dispersive' },
                      { name: 'Non-Dispersive Residual', metaKey: 'rejection.non_dispersive' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Dispersive Residual" aria-label="Dispersive Residual" value={config.rejection.dispersive}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, dispersive: v}})}
                      disabled={modeDisabled('rejection.dispersive')} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Non-Dispersive Residual" aria-label="Non-Dispersive Residual" value={config.rejection.nonDispersive}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, nonDispersive: v}})}
                      disabled={modeDisabled('rejection.non_dispersive')} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Hold + Fix Chi-Square */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Chi-Square Hold/Fix" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Hold Chi-Square' },
                      { name: 'Fix Chi-Square' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Hold Chi-Square" aria-label="Hold Chi-Square" value={config.rejection.holdChiSquare}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, holdChiSquare: v}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Fix Chi-Square" aria-label="Fix Chi-Square" value={config.rejection.fixChiSquare}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, fixChiSquare: v}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* Max GDOP + Pseudorange Diff + Pos Error Count */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Max GDOP / PRdiff / PosErr" style={OPT_LABEL_STYLE}
                    fields={[
                      { name: 'Max GDOP', metaKey: 'rejection.gdop' },
                      { name: 'Pseudorange Diff' },
                      { name: 'Pos Error Count' },
                    ]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Max GDOP" aria-label="Max GDOP" value={config.rejection.gdop}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, gdop: v}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Pseudorange Diff" aria-label="Pseudorange Diff" value={config.rejection.pseudorangeDiff}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, pseudorangeDiff: v}})}
                      decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Pos Error Count" aria-label="Pos Error Count" value={config.rejection.positionErrorCount}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, positionErrorCount: v}})}
                      decimalScale={0} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                {/* SPP residual / min sats (v0.7.6) */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="SPP Res / Min Sats" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'SPP Residual' }, { name: 'SPP Min Sats' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="SPP Residual reject threshold" aria-label="SPP Residual" value={config.rejection.sppResidual}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, sppResidual: v}})}
                      min={0} decimalScale={4} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="SPP Min Sats" aria-label="SPP Min Sats" value={config.rejection.sppMinSats}
                      onChange={(v) => handleConfigChange({...config, rejection: {...config.rejection, sppMinSats: v}})}
                      min={0} decimalScale={0} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── SPP / Relative / Signal Selection / PPP sections (v0.7.6) ── */}
          {activeSection === 'method' && (
            <Stack gap="xs">
              <SectionHeader title="SPP / Robust QC" anchor="spp" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <OptionLabel metaKey="positioning.spp.ignore_chi_error" style={OPT_LABEL_STYLE} />
                  <Switch size="xs" checked={config.receiver.ignoreChiError}
                    onChange={(e) => handleConfigChange({ ...config, receiver: { ...config.receiver, ignoreChiError: e.currentTarget.checked } })} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Robust / K0 / K1" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'Robust' }, { name: 'K0' }, { name: 'K1' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="Robust (off/igg3)" aria-label="Robust" value={config.positioning.robust ?? 'off'}
                      onChange={(value) => handleConfigChange({ ...config, positioning: { ...config.positioning, robust: value } })}
                      data={[{ value: 'off', label: 'OFF' }, { value: 'igg3', label: 'IGG-III' }]}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Robust K0" aria-label="Robust K0" value={config.positioning.robustK0 ?? 1.5}
                      onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, robustK0: v } })}
                      disabled={(config.positioning.robust ?? 'off') === 'off'} decimalScale={2} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Robust K1" aria-label="Robust K1" value={config.positioning.robustK1 ?? 4.0}
                      onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, robustK1: v } })}
                      disabled={(config.positioning.robust ?? 'off') === 'off'} decimalScale={2} hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="TDCP / Jump (m)" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'TDCP' }, { name: 'Jump' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="TDCP (off/on)" aria-label="TDCP" value={config.positioning.tdcp ?? 'off'}
                      onChange={(value) => handleConfigChange({ ...config, positioning: { ...config.positioning, tdcp: value } })}
                      data={[{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }]}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="TDCP Jump (m)" aria-label="TDCP Jump" value={config.positioning.tdcpJump ?? 5.0}
                      onChange={(v) => handleConfigChange({ ...config, positioning: { ...config.positioning, tdcpJump: v } })}
                      disabled={(config.positioning.tdcp ?? 'off') === 'off'} decimalScale={1} hideControls style={{ flex: 1, minWidth: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </Stack>

              <SectionHeader title="Relative Positioning" anchor="relative" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Max Age (s)</Text>
                  <ConfigNumberInput size="xs" value={config.receiver.maxAge}
                    onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, maxAge: value } })}
                    min={0} decimalScale={1} hideControls disabled={!isRelativeMode} style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Baseline Len / Sigma (m)" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'Length' }, { name: 'Sigma' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="Baseline Length (m)" aria-label="Baseline Length" value={config.receiver.baselineLength}
                      onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, baselineLength: value } })}
                      min={0} decimalScale={1} hideControls disabled={!isRelativeMode} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Baseline Sigma (m)" aria-label="Baseline Sigma" value={config.receiver.baselineSigma}
                      onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, baselineSigma: value } })}
                      min={0} decimalScale={4} hideControls disabled={!isRelativeMode} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Time Interpolation</Text>
                  <Switch size="xs" checked={config.server.timeInterpolation ?? false} disabled={!isRelativeMode}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, timeInterpolation: e.currentTarget.checked } })} />
                </Group>
              </Stack>

              <SectionHeader title="Signal Selection" anchor="signals" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="GPS / QZS / GAL" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'GPS' }, { name: 'QZSS' }, { name: 'Galileo' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="GPS signals" aria-label="GPS signals" value={config.signalSelection.gps} disabled={useSignals}
                      onChange={(value) => handleConfigChange({ ...config, signalSelection: { ...config.signalSelection, gps: value } })}
                      data={['L1/L2', 'L1/L5', 'L1/L2/L5']} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="QZSS signals" aria-label="QZSS signals" value={config.signalSelection.qzs} disabled={useSignals}
                      onChange={(value) => handleConfigChange({ ...config, signalSelection: { ...config.signalSelection, qzs: value } })}
                      data={['L1/L5', 'L1/L2', 'L1/L5/L2']} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="Galileo signals" aria-label="Galileo signals" value={config.signalSelection.galileo} disabled={useSignals}
                      onChange={(value) => handleConfigChange({ ...config, signalSelection: { ...config.signalSelection, galileo: value } })}
                      data={['E1/E5a', 'E1/E5b', 'E1/E6', 'E1/E5a/E5b/E6', 'E1/E5a/E6/E5b']} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="BDS-2 / BDS-3" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'BDS-2' }, { name: 'BDS-3' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="BeiDou-2 signals" aria-label="BDS-2 signals" value={config.signalSelection.bds2} disabled={useSignals}
                      onChange={(value) => handleConfigChange({ ...config, signalSelection: { ...config.signalSelection, bds2: value } })}
                      data={['B1I/B3I', 'B1I/B2I', 'B1I/B3I/B2I']} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="BeiDou-3 signals" aria-label="BDS-3 signals" value={config.signalSelection.bds3} disabled={useSignals}
                      onChange={(value) => handleConfigChange({ ...config, signalSelection: { ...config.signalSelection, bds3: value } })}
                      data={['B1I/B3I', 'B1I/B2a', 'B1I/B3I/B2a']} style={{ flex: 1, minWidth: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </Stack>
            </Stack>
          )}

          {activeSection === 'ppp' && (
            <Stack gap="xs">
              <SectionHeader title="PPP" anchor="ppp" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Sat Clock / Phase / Uncorr Bias" style={OPT_LABEL_STYLE}
                    fields={[{ name: 'Clock' }, { name: 'Phase' }, { name: 'Uncorr' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="PPP Sat Clock Bias" aria-label="PPP Sat Clock Bias" value={config.receiver.pppSatClockBias} disabled={!isPPP}
                      onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, pppSatClockBias: value } })}
                      hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="PPP Sat Phase Bias" aria-label="PPP Sat Phase Bias" value={config.receiver.pppSatPhaseBias} disabled={!isPPP}
                      onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, pppSatPhaseBias: value } })}
                      hideControls style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="Uncorrected Bias" aria-label="Uncorrected Bias" value={config.receiver.uncorrBias} disabled={!isPPP}
                      onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, uncorrBias: value } })}
                      hideControls style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Clock Jump</Text>
                  <Switch size="xs" checked={config.receiver.clockJump} disabled={!isPPP}
                    onChange={(e) => handleConfigChange({ ...config, receiver: { ...config.receiver, clockJump: e.currentTarget.checked } })} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Max Bias dt</Text>
                  <ConfigNumberInput size="xs" value={config.receiver.maxBiasDt} disabled={!isPPP}
                    onChange={(value) => handleConfigChange({ ...config, receiver: { ...config.receiver, maxBiasDt: value } })}
                    hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>PPP Options</Text>
                  <TextInput size="xs" value={config.server.pppOption ?? ''} disabled={!isPPP}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, pppOption: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
                </Group>
              </Stack>

              <SectionHeader title="MADOCA" anchor="madoca" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Iono Comp.</Text>
                  <Switch size="xs" checked={config.receiver.ionoCorrection} disabled={!isPPP}
                    onChange={(e) => handleConfigChange({ ...config, receiver: { ...config.receiver, ionoCorrection: e.currentTarget.checked } })} />
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
                <ConfigNumberInput
                  size="xs"
                  value={config.antenna.base.maxAverageEpochs}
                  onChange={(v) =>
                    handleConfigChange({
                      ...config,
                      antenna: {
                        ...config.antenna,
                        base: { ...config.antenna.base, maxAverageEpochs: v },
                      },
                    })
                  }
                  min={0}
                  hideControls
                  style={{ flex: 1 }}
                />
              </Group>
              <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
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
                  <ConfigSelect
                    size="xs"
                    value={config.output.solutionFormat}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        output: {
                          ...config.output,
                          solutionFormat: value,
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

                {/* Output fields — label left, toggles right */}
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Output</Text>
                  <Group wrap="nowrap" align="center" gap="md" justify="space-between" style={{ flex: 1, minWidth: 0 }}>
                    <Switch size="xs" label="Header" checked={config.output.outputHeader}
                      onChange={(e) => handleConfigChange({ ...config, output: { ...config.output, outputHeader: e.currentTarget.checked } })}
                      disabled={isSolNMEA} styles={{ label: { fontSize: '10px' } }} />
                    <Switch size="xs" label="Options" checked={config.output.outputProcessingOptions}
                      onChange={(e) => handleConfigChange({ ...config, output: { ...config.output, outputProcessingOptions: e.currentTarget.checked } })}
                      disabled={isSolNMEA} styles={{ label: { fontSize: '10px' } }} />
                    <Switch size="xs" label="Velocity" checked={config.output.outputVelocity}
                      onChange={(e) => handleConfigChange({ ...config, output: { ...config.output, outputVelocity: e.currentTarget.checked } })}
                      styles={{ label: { fontSize: '10px' } }} />
                  </Group>
                </Group>

                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Time Format</Text>
                  <ConfigSelect
                    size="xs"
                    value={config.output.timeFormat}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, timeFormat: value },
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
                  <ConfigNumberInput
                    size="xs"
                    value={config.output.numDecimals}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, numDecimals: value },
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
                  <ConfigSelect
                    size="xs"
                    value={config.output.latLonFormat}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, latLonFormat: value },
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
                    onChange={(e) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, fieldSeparator: e.currentTarget.value },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </Group>
              </Stack>

              {/* Group B: Height & Geoid (datum removed in v0.7.6) */}
              <Divider my={4} />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Height</Text>
                  <ConfigSelect
                    size="xs"
                    value={config.output.height}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, height: value },
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
                  <ConfigSelect
                    size="xs"
                    value={config.output.geoidModel}
                    onChange={(value) =>
                      handleConfigChange({
                        ...config,
                        output: { ...config.output, geoidModel: value },
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
                {/* Static Sol Mode + Single on Outage on one row */}
                <Group wrap="nowrap" align="center" gap="xs" style={{ minHeight: 30 }}>
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Static / Single Outage</Text>
                  <Group wrap="nowrap" align="center" gap="md" style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="Static Solution Mode" aria-label="Static Solution Mode" value={config.output.staticSolutionMode}
                      onChange={(value) => handleConfigChange({ ...config, output: { ...config.output, staticSolutionMode: value } })}
                      data={[
                        { value: 'all', label: 'All' },
                        { value: 'single', label: 'Single' },
                        { value: 'fixed', label: 'Fixed' },
                      ]}
                      disabled={!isStaticMode} style={{ flex: 1, minWidth: 0 }} />
                    <Switch size="xs" label="Single" title="Single on Outage" checked={config.output.outputSingleOnOutage}
                      onChange={(e) => handleConfigChange({ ...config, output: { ...config.output, outputSingleOnOutage: e.currentTarget.checked } })}
                      disabled={isSingle} styles={{ label: { fontSize: '10px' } }} style={{ flexShrink: 0 }} />
                  </Group>
                </Group>

                {/* NMEA RMC/GGA + GSA/GSV intervals on one row */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>NMEA RMC/GGA · GSA/GSV (s)</Text>
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigNumberInput size="xs" title="NMEA RMC/GGA interval (s)" aria-label="NMEA RMC/GGA (s)" value={config.output.nmeaIntervalRmcGga}
                      onChange={(value) => handleConfigChange({ ...config, output: { ...config.output, nmeaIntervalRmcGga: value } })}
                      min={0} step={1} hideControls disabled={!isSolNMEA} style={{ flex: 1, minWidth: 0 }} />
                    <ConfigNumberInput size="xs" title="NMEA GSA/GSV interval (s)" aria-label="NMEA GSA/GSV (s)" value={config.output.nmeaIntervalGsaGsv}
                      onChange={(value) => handleConfigChange({ ...config, output: { ...config.output, nmeaIntervalGsaGsv: value } })}
                      min={0} step={1} hideControls disabled={!isSolNMEA} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>

                {/* Sol Status + Debug Trace on one row */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Sol Status / Debug Trace</Text>
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <ConfigSelect size="xs" title="Solution Status" aria-label="Sol Status" value={config.output.outputSolutionStatus}
                      onChange={(value) => handleConfigChange({ ...config, output: { ...config.output, outputSolutionStatus: value } })}
                      data={[
                        { value: 'off', label: 'OFF' },
                        { value: 'state', label: 'State' },
                        { value: 'residual', label: 'Residual' },
                      ]}
                      style={{ flex: 1, minWidth: 0 }} />
                    <ConfigSelect size="xs" title="Debug Trace" aria-label="Debug Trace" value={config.output.debugTrace}
                      onChange={(value) => handleConfigChange({ ...config, output: { ...config.output, debugTrace: value } })}
                      data={[
                        { value: 'off', label: 'OFF' },
                        { value: 'level1', label: 'Level 1' },
                        { value: 'level2', label: 'Level 2' },
                        { value: 'level3', label: 'Level 3' },
                        { value: 'level4', label: 'Level 4' },
                        { value: 'level5', label: 'Level 5' },
                      ]}
                      style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>

                {/* [output] max_solution_std — 0 = no limit */}
                <Group wrap="nowrap" align="center" gap="xs">
                  <OptionLabel metaKey="output.max_solution_std" style={OPT_LABEL_STYLE} />
                  <ConfigNumberInput size="xs" aria-label="Max solution std (m)" value={config.output.maxSolutionStd}
                    onChange={(value) => handleConfigChange({
                      ...config,
                      output: { ...config.output, maxSolutionStd: value },
                    })}
                    min={0} step={0.1} decimalScale={3} hideControls placeholder="0 = no limit"
                    style={{ flex: 1, minWidth: 0 }} />
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
                label="Temp Directory"
                value={config.files.tempDir}
                onChange={(val) => handleConfigChange({ ...config, files: { ...config.files, tempDir: val } })}
                onBrowse={() => openFileBrowser((path) => handleConfigChange({ ...config, files: { ...config.files, tempDir: path } }))}
              />

              <FileInputRow
                label="Trace File"
                value={config.files.trace}
                onChange={(val) => handleConfigChange({ ...config, files: { ...config.files, trace: val } })}
                onBrowse={() => openFileBrowser((path) => handleConfigChange({ ...config, files: { ...config.files, trace: path } }))}
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

              <FileInputRow
                label="Command File 1"
                value={config.files.cmdFile1}
                onChange={(val) => handleConfigChange({ ...config, files: { ...config.files, cmdFile1: val } })}
                onBrowse={() => openFileBrowser((path) => handleConfigChange({ ...config, files: { ...config.files, cmdFile1: path } }))}
              />
              <FileInputRow
                label="Command File 2"
                value={config.files.cmdFile2}
                onChange={(val) => handleConfigChange({ ...config, files: { ...config.files, cmdFile2: val } })}
                onBrowse={() => openFileBrowser((path) => handleConfigChange({ ...config, files: { ...config.files, cmdFile2: path } }))}
              />
              <FileInputRow
                label="Command File 3"
                value={config.files.cmdFile3}
                onChange={(val) => handleConfigChange({ ...config, files: { ...config.files, cmdFile3: val } })}
                onBrowse={() => openFileBrowser((path) => handleConfigChange({ ...config, files: { ...config.files, cmdFile3: path } }))}
              />
            </Stack>
          )}

          {/* ── Input Options section (RINEX / RTCM / SBAS decoding) ── */}
          {activeSection === 'input-options' && (
            <Stack gap="xs">
              <SectionHeader title="Input Decoding" anchor="input-options" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>RINEX Option 1</Text>
                  <TextInput size="xs" value={config.server.rinexOption1 ?? ''}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, rinexOption1: e.currentTarget.value } })}
                    placeholder="e.g. -GL2X" style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>RINEX Option 2</Text>
                  <TextInput size="xs" value={config.server.rinexOption2 ?? ''}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, rinexOption2: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>RTCM Options</Text>
                  <TextInput size="xs" value={config.server.rtcmOption ?? ''}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, rtcmOption: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>SBAS Satellite</Text>
                  <TextInput size="xs" value={config.server.sbasSatellite ?? '0'}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, sbasSatellite: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
                </Group>
              </Stack>
            </Stack>
          )}

          {/* ── Server section ── */}
          {activeSection === 'server' && (
            <Stack gap="xs">
              <SectionHeader title="Server Options" anchor="server-options" />
              <Stack gap={6}>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Cycle (ms)</Text>
                  <ConfigNumberInput size="xs" value={config.server.cycleMs ?? 10}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, cycleMs: v } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Timeout (ms)</Text>
                  <ConfigNumberInput size="xs" value={config.server.timeoutMs ?? 10000}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, timeoutMs: v } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Reconnect (ms)</Text>
                  <ConfigNumberInput size="xs" value={config.server.reconnectMs ?? 10000}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, reconnectMs: v } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>NMEA Cycle (ms)</Text>
                  <ConfigNumberInput size="xs" value={config.server.nmeaCycleMs ?? 5000}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, nmeaCycleMs: v } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Buffer Size</Text>
                  <ConfigNumberInput size="xs" value={config.server.bufferSize ?? 32768}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, bufferSize: v } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Nav Msg Select</Text>
                  <TextInput size="xs" value={config.server.navMsgSelect ?? 'all'}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, navMsgSelect: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Proxy</Text>
                  <TextInput size="xs" value={config.server.proxy ?? ''}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, proxy: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Swap Margin (s)</Text>
                  <ConfigNumberInput size="xs" value={config.server.swapMargin ?? 30}
                    onChange={(v) => handleConfigChange({ ...config, server: { ...config.server, swapMargin: v } })}
                    min={0} hideControls style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Start Cmd</Text>
                  <TextInput size="xs" value={config.server.startCmd ?? ''}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, startCmd: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <Text size="xs" c="dimmed" style={LABEL_STYLE}>Stop Cmd</Text>
                  <TextInput size="xs" value={config.server.stopCmd ?? ''}
                    onChange={(e) => handleConfigChange({ ...config, server: { ...config.server, stopCmd: e.currentTarget.value } })}
                    style={{ flex: 1 }} />
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
  const isClasPreview =
    config.positioning.positioningMode === 'ppp-rtk' ||
    config.positioning.positioningMode === 'vrs-rtk';

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
    L.push(`correction          = ${_s(p.correction)}`);
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
    if (p.robust !== 'off') L.push(`robust              = ${_s(p.robust)}`);
    if (p.tdcp !== 'off') L.push(`tdcp                = ${_s(p.tdcp)}`);
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
    if (isClasPreview) {
      L.push('[positioning.clas]');
      L.push(`grid_selection_radius = ${p.clas.gridSelectionRadius}`);
      L.push(`receiver_type         = ${_s(p.clas.receiverType)}`);
      L.push(`enhanced_spp_seed     = ${_s(p.clas.enhancedSppSeed)}`);
      L.push('');
      L.push('[positioning.clas.ambiguities]');
      L.push(`phase_shift    = ${_s(rx.phaseShift)}`);
      L.push(`isb            = ${_b(rx.isb)}`);
      if (rx.referenceType) L.push(`reference_type = ${_s(rx.referenceType)}`);
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
    L.push('[positioning.relative]');
    L.push(`max_age = ${rx.maxAge}`);
    L.push('');
    L.push('[positioning.madoca]');
    L.push(`iono_correction = ${_b(rx.ionoCorrection)}`);
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
    if (srv.startCmd) L.push(`start_cmd          = ${_s(srv.startCmd)}`);
    if (srv.stopCmd) L.push(`stop_cmd           = ${_s(srv.stopCmd)}`);
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
  }, [config, isClasPreview, streams]);

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
