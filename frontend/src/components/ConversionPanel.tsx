import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Box,
  Stack,
  Group,
  Text,
  Title,
  TextInput,
  Select,
  NumberInput,
  Switch,
  Button,
  ActionIcon,
  Badge,
  Code,
  ScrollArea,
  Collapse,
  SegmentedControl,
  UnstyledButton,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { DateTimePicker } from '@mantine/dates';
import dayjs from 'dayjs';
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconCopy,
  IconTrash,
  IconDownload,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconRefresh,
  IconFileCode,
  IconCalendar,
} from '@tabler/icons-react';
import { FileBrowserModal } from './FileBrowserModal';
import { ComboLabel } from './common/OptionLabel';

// ─── Types ──────────────────────────────────────────────────────────────────

type ConvertStatus = 'idle' | 'converting' | 'done' | 'failed';
type RightPanelTab = 'console' | 'preview';
type PreviewFileType = 'obs' | 'nav';

interface RinexPreview {
  filename: string;
  rinexType: string;
  header: string;
  dataPreview: string;
  totalLines: number;
  headerLines: number;
  truncated: boolean;
}

interface ConvertFormState {
  // Input
  rawFile: string;
  receiverFormat: string;
  receiverOptions: string;
  // Output
  observationFile: string;
  navigationFile: string;
  rinexVersion: string;
  outputDirectory: string;
  stationId: string;
  // Time Range
  timeStart: string;
  timeEnd: string;
  rtcmRefTime: string;
  interval: number | '';
  epochTolerance: number;
  timeSpan: number | '';
  // Signal Options
  frequencies: number;
  includeDoppler: boolean;
  includeSnr: boolean;
  ionoCorrection: boolean;
  timeCorrection: boolean;
  leapSeconds: boolean;
  halfCycleCorr: boolean;
  excludeSatellites: string;
  signalMask: string;
  // RINEX Header
  comment: string;
  markerName: string;
  markerNumber: string;
  markerType: string;
  observerAgency: string;
  receiver: string;
  antenna: string;
  approxPosition: string;
  antennaDelta: string;
  // Debug
  traceLevel: string;
}

const DEFAULT_FORM: ConvertFormState = {
  rawFile: '',
  receiverFormat: '',
  receiverOptions: '',
  observationFile: '',
  navigationFile: '',
  rinexVersion: '3.04',
  outputDirectory: '/workspace',
  stationId: '',
  timeStart: '',
  timeEnd: '',
  rtcmRefTime: '',
  interval: '',
  epochTolerance: 0.005,
  timeSpan: '',
  frequencies: 5,
  includeDoppler: true,
  includeSnr: true,
  ionoCorrection: false,
  timeCorrection: false,
  leapSeconds: false,
  halfCycleCorr: false,
  excludeSatellites: '',
  signalMask: '',
  comment: '',
  markerName: '',
  markerNumber: '',
  markerType: '',
  observerAgency: '',
  receiver: '',
  antenna: '',
  approxPosition: '',
  antennaDelta: '',
  traceLevel: '0',
};

const RECEIVER_FORMATS = [
  { value: '', label: 'Auto-detect' },
  { value: 'rtcm2', label: 'RTCM 2' },
  { value: 'rtcm3', label: 'RTCM 3' },
  { value: 'ubx', label: 'u-blox' },
  { value: 'sbf', label: 'Septentrio SBF' },
  { value: 'nov', label: 'NovAtel' },
  { value: 'oem3', label: 'NovAtel OEM3' },
  { value: 'binex', label: 'BINEX' },
  { value: 'rt17', label: 'Trimble RT17' },
  { value: 'javad', label: 'Javad' },
  { value: 'nvs', label: 'NVS' },
  { value: 'hemis', label: 'Hemisphere' },
  { value: 'stq', label: 'SkyTraq' },
  { value: 'ss2', label: 'NovAtel SS2' },
  { value: 'rinex', label: 'RINEX' },
];

const RINEX_VERSIONS = [
  { value: '2.11', label: '2.11' },
  { value: '3.03', label: '3.03' },
  { value: '3.04', label: '3.04' },
  { value: '4.00', label: '4.00' },
];

const TRACE_LEVELS = [
  { value: '0', label: 'Off' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
];

const LABEL_STYLE = { width: 130, flexShrink: 0, fontSize: '11px' } as const;

// ─── Sidebar components ─────────────────────────────────────────────────────

function SidebarGroup({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <Group
        gap={6}
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

function SidebarItem({ label, icon, active, onClick }: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 8px',
        fontSize: '11px',
        borderLeft: active ? '2px solid var(--mantine-primary-color-filled)' : '2px solid transparent',
        backgroundColor: active ? 'var(--mantine-color-default-hover)' : undefined,
        color: active ? 'var(--mantine-color-text)' : 'var(--mantine-color-dimmed)',
        fontWeight: active ? 500 : 400,
      }}
    >
      {icon}
      {label}
    </UnstyledButton>
  );
}

// ─── Collapsible Section ────────────────────────────────────────────────────

function CollapsibleSection({ label, children, defaultOpen = false }: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [opened, { toggle }] = useDisclosure(defaultOpen);
  return (
    <Box>
      <UnstyledButton
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          padding: '6px 0',
        }}
      >
        {opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <Text size="xs" fw={600}>{label}</Text>
      </UnstyledButton>
      <Collapse in={opened}>
        <Stack gap={6} pl={4} pb={8}>
          {children}
        </Stack>
      </Collapse>
    </Box>
  );
}

// ─── Field row helper ───────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group wrap="nowrap" align="center" gap="xs">
      <Text size="xs" c="dimmed" style={LABEL_STYLE}>{label}</Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

// Split a space-joined "A B C" string into 3 parts (for X/Y/Z, H/E/N inputs).
function xyz(s: string): [string, string, string] {
  const p = s.trim() === '' ? [] : s.trim().split(/\s+/);
  return [p[0] ?? '', p[1] ?? '', p[2] ?? ''];
}
// Update one part and re-join, preserving the space-joined string contract.
function setXyz(s: string, idx: number, val: string): string {
  const parts = xyz(s);
  parts[idx] = val;
  return parts.join(' ').trim();
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ConversionPanel() {
  const [form, setForm] = useState<ConvertFormState>(DEFAULT_FORM);
  const [status, setStatus] = useState<ConvertStatus>('idle');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [_selectedSidebar] = useState('rinex-converter');
  const consoleRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Right panel tab state
  const [rightTab, setRightTab] = useState<RightPanelTab>('console');

  // Preview state
  const [outputFiles, setOutputFiles] = useState<{ obs?: string; nav?: string }>({});
  const [previews, setPreviews] = useState<{ obs?: RinexPreview; nav?: RinexPreview }>({});
  const [activePreviewFile, setActivePreviewFile] = useState<PreviewFileType>('obs');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Track output file paths parsed from log messages
  const parsedOutputRef = useRef<{ obs?: string; nav?: string }>({});

  const previewEnabled = status === 'done' && (previews.obs != null || previews.nav != null);
  const currentPreview = previews[activePreviewFile];
  const availablePreviewTypes = useMemo(() => {
    const types: PreviewFileType[] = [];
    if (previews.obs) types.push('obs');
    if (previews.nav) types.push('nav');
    return types;
  }, [previews]);

  // File browser state
  const [fbOpened, setFbOpened] = useState(false);
  const [fbTarget, setFbTarget] = useState<keyof ConvertFormState | null>(null);
  const [fbDefaultRoot, setFbDefaultRoot] = useState<'workspace' | 'data'>('data');
  const [fbSelectDir, setFbSelectDir] = useState(false);

  const openFileBrowser = useCallback((target: keyof ConvertFormState, root: 'workspace' | 'data' = 'data', selectDir = false) => {
    setFbTarget(target);
    setFbDefaultRoot(root);
    setFbSelectDir(selectDir);
    setFbOpened(true);
  }, []);

  const handleFileSelect = useCallback((path: string) => {
    if (fbTarget) {
      setForm(prev => ({ ...prev, [fbTarget]: path }));
    }
    setFbOpened(false);
  }, [fbTarget]);

  // Fetch RINEX preview for a file path
  const fetchPreview = useCallback(async (filePath: string): Promise<RinexPreview | undefined> => {
    try {
      const baseUrl = import.meta.env.DEV ? `http://${window.location.hostname}:8000` : '';
      const url = `${baseUrl}/api/convert/preview?path=${encodeURIComponent(filePath)}&max_epochs=5`;
      const res = await fetch(url);
      if (!res.ok) return undefined;
      const data = await res.json();
      return {
        filename: data.filename,
        rinexType: data.rinex_type,
        header: data.header,
        dataPreview: data.data_preview,
        totalLines: data.total_lines,
        headerLines: data.header_lines,
        truncated: data.truncated,
      };
    } catch {
      return undefined;
    }
  }, []);

  // Fetch previews for output files after conversion completes
  const fetchPreviews = useCallback(async (files: { obs?: string; nav?: string }) => {
    setPreviewLoading(true);
    const results: { obs?: RinexPreview; nav?: RinexPreview } = {};
    const promises: Promise<void>[] = [];
    if (files.obs) {
      promises.push(fetchPreview(files.obs).then(p => { if (p) results.obs = p; }));
    }
    if (files.nav) {
      promises.push(fetchPreview(files.nav).then(p => { if (p) results.nav = p; }));
    }
    await Promise.all(promises);
    setPreviews(results);
    if (results.obs) setActivePreviewFile('obs');
    else if (results.nav) setActivePreviewFile('nav');
    setPreviewLoading(false);
    // Auto-switch to Preview tab after a short delay
    if (results.obs || results.nav) {
      setTimeout(() => setRightTab('preview'), 500);
    }
  }, [fetchPreview]);

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTo({
        top: consoleRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [logLines]);

  // WebSocket for log streaming
  const connectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = import.meta.env.DEV ? `${window.location.hostname}:8000` : window.location.host;
    const ws = new WebSocket(`${proto}//${host}/api/convert/ws`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log' && msg.message) {
          setLogLines(prev => [...prev, msg.message]);
          // Parse output file paths from converter log lines
          // e.g. "[STDERR] ->rinex obs : /workspace/G5P3083c.obs"
          const obsMatch = msg.message.match(/->rinex\s+obs\s*:\s*(.+)/);
          if (obsMatch) parsedOutputRef.current.obs = obsMatch[1].trim();
          const navMatch = msg.message.match(/->rinex\s+nav\s*:\s*(.+)/);
          if (navMatch) parsedOutputRef.current.nav = navMatch[1].trim();
        } else if (msg.type === 'progress' && msg.message) {
          // Overwrite last progress line instead of appending
          setLogLines(prev => {
            const last = prev.length > 0 && prev[prev.length - 1].startsWith('[STDERR] scanning:') || prev[prev.length - 1]?.includes(': O=') || prev[prev.length - 1]?.includes(': E=') || prev[prev.length - 1]?.includes(': S=');
            return last ? [...prev.slice(0, -1), msg.message] : [...prev, msg.message];
          });
        } else if (msg.type === 'status') {
          if (msg.status === 'completed' || msg.status === 'done') {
            setStatus('done');
          } else if (msg.status === 'failed' || msg.status === 'error') {
            setStatus('failed');
          } else if (msg.status === 'running' || msg.status === 'converting') {
            setStatus('converting');
          }
        } else if (msg.type === 'output_files') {
          // If backend sends output file paths (future enhancement)
          if (msg.obs || msg.nav) {
            const files = { obs: msg.obs, nav: msg.nav };
            setOutputFiles(files);
            fetchPreviews(files);
          }
        }
      } catch {
        // raw text line
        setLogLines(prev => [...prev, event.data]);
      }
    };

    ws.onclose = () => {
      // Only clear the ref if this socket is still the current one. Close
      // events are async, so an older socket can close after a newer socket
      // has been assigned — clearing unconditionally would orphan the newer
      // socket (leaving it active) and duplicate output on the next convert.
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };

    wsRef.current = ws;
  }, [fetchPreviews]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Build command preview
  const commandPreview = useMemo(() => {
    const args: string[] = ['mrtk', 'convert'];

    if (form.receiverFormat) {
      args.push('-r', form.receiverFormat);
    }
    if (form.rinexVersion) {
      args.push('-v', form.rinexVersion);
    }
    if (form.observationFile) {
      args.push('-o', form.observationFile);
    }
    if (form.navigationFile) {
      args.push('-n', form.navigationFile);
    }
    if (form.outputDirectory && form.outputDirectory !== '/workspace') {
      args.push('-d', form.outputDirectory);
    }
    if (form.stationId) {
      args.push('-c', form.stationId);
    }
    if (form.receiverOptions) {
      args.push('-ro', form.receiverOptions);
    }
    // Time range
    if (form.timeStart) {
      args.push('-ts', form.timeStart);
    }
    if (form.timeEnd) {
      args.push('-te', form.timeEnd);
    }
    if (form.rtcmRefTime) {
      args.push('-tr', form.rtcmRefTime);
    }
    if (form.interval !== '' && form.interval > 0) {
      args.push('-ti', String(form.interval));
    }
    // Backend sends -tt only when it differs from convbin's default
    if (form.epochTolerance !== 0.005) {
      args.push('-tt', String(form.epochTolerance));
    }
    if (form.timeSpan !== '' && form.timeSpan > 0) {
      args.push('-span', String(form.timeSpan));
    }
    // Signal options
    if (form.frequencies !== 5) {
      args.push('-f', String(form.frequencies));
    }
    if (!form.includeDoppler) {
      args.push('-od');
    }
    if (!form.includeSnr) {
      args.push('-os');
    }
    if (form.ionoCorrection) {
      args.push('-oi');
    }
    if (form.timeCorrection) {
      args.push('-ot');
    }
    if (form.leapSeconds) {
      args.push('-ol');
    }
    if (form.halfCycleCorr) {
      args.push('-halfc');
    }
    if (form.excludeSatellites.trim()) {
      form.excludeSatellites.trim().split(/\s+/).forEach(sat => {
        args.push('-x', sat);
      });
    }
    if (form.signalMask.trim()) {
      args.push('-mask', form.signalMask.trim());
    }
    // RINEX header
    if (form.comment) args.push('-hc', form.comment);
    if (form.markerName) args.push('-hm', form.markerName);
    if (form.markerNumber) args.push('-hn', form.markerNumber);
    if (form.markerType) args.push('-ht', form.markerType);
    if (form.observerAgency) args.push('-ho', form.observerAgency);
    if (form.receiver) args.push('-hr', form.receiver);
    if (form.antenna) args.push('-ha', form.antenna);
    if (form.approxPosition) args.push('-hp', form.approxPosition);
    if (form.antennaDelta) args.push('-hd', form.antennaDelta);
    // Debug
    if (form.traceLevel !== '0') {
      args.push('-trace', form.traceLevel);
    }
    // Input file last
    if (form.rawFile) {
      args.push(form.rawFile);
    }

    return args.join(' ');
  }, [form]);

  // Derive output file paths: prefer parsed paths from log, then form state
  const deriveOutputFiles = useCallback((): { obs?: string; nav?: string } => {
    const parsed = parsedOutputRef.current;
    const dir = form.outputDirectory || '/workspace';
    const inputName = form.rawFile ? form.rawFile.split('/').pop()?.replace(/\.[^.]+$/, '') || 'output' : 'output';
    return {
      obs: parsed.obs || form.observationFile || `${dir}/${inputName}.obs`,
      nav: parsed.nav || form.navigationFile || `${dir}/${inputName}.nav`,
    };
  }, [form.rawFile, form.observationFile, form.navigationFile, form.outputDirectory]);

  const handleConvert = useCallback(async () => {
    if (!form.rawFile) return;
    setStatus('converting');
    setLogLines([]);
    // Clear preview state on new conversion
    setPreviews({});
    setOutputFiles({});
    parsedOutputRef.current = {};
    setRightTab('console');
    connectWs();

    try {
      const response = await fetch('/api/convert/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_file: form.rawFile,
          format: form.receiverFormat || null,
          receiver_options: form.receiverOptions || null,
          output_obs: form.observationFile || null,
          output_nav: form.navigationFile || null,
          output_dir: form.outputDirectory || null,
          rinex_version: form.rinexVersion,
          station_id: form.stationId || null,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          time_ref: form.rtcmRefTime || null,
          interval: form.interval === '' ? null : Number(form.interval),
          epoch_tolerance: form.epochTolerance,
          time_span: form.timeSpan === '' ? null : Number(form.timeSpan),
          frequencies: form.frequencies,
          include_doppler: form.includeDoppler,
          include_snr: form.includeSnr,
          include_iono: form.ionoCorrection,
          include_time_corr: form.timeCorrection,
          include_leap_sec: form.leapSeconds,
          half_cycle: form.halfCycleCorr,
          exclude_sats: form.excludeSatellites || null,
          signal_mask: form.signalMask || null,
          header_comment: form.comment || null,
          header_marker: form.markerName || null,
          header_marker_no: form.markerNumber || null,
          header_marker_type: form.markerType || null,
          header_observer: form.observerAgency || null,
          header_receiver: form.receiver || null,
          header_antenna: form.antenna || null,
          header_position: form.approxPosition || null,
          header_delta: form.antennaDelta || null,
          trace_level: parseInt(form.traceLevel, 10),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Request failed' }));
        setLogLines(prev => [...prev, `Error: ${err.detail || 'Request failed'}`]);
        setStatus('failed');
      }
    } catch (err) {
      setLogLines(prev => [...prev, `Error: ${err instanceof Error ? err.message : 'Unknown error'}`]);
      setStatus('failed');
    }
  }, [form, connectWs]);

  const handleStop = useCallback(async () => {
    try {
      await fetch('/api/convert/stop', { method: 'POST' });
      setStatus('idle');
    } catch {
      // ignore
    }
  }, []);

  const handleCopyLog = useCallback(() => {
    navigator.clipboard.writeText(logLines.join('\n'));
  }, [logLines]);

  const handleClearLog = useCallback(() => {
    setLogLines([]);
  }, []);

  // When conversion completes, try to fetch previews for output files
  useEffect(() => {
    if (status === 'done' && !outputFiles.obs && !outputFiles.nav) {
      const files = deriveOutputFiles();
      setOutputFiles(files);
      fetchPreviews(files);
    }
  }, [status, outputFiles, deriveOutputFiles, fetchPreviews]);

  // Download the currently previewed file
  const handleDownloadPreview = useCallback(() => {
    const filePath = outputFiles[activePreviewFile];
    if (!filePath) return;
    const baseUrl = import.meta.env.DEV ? `http://${window.location.hostname}:8000` : '';
    window.open(`${baseUrl}/api/files/download?path=${encodeURIComponent(filePath)}`, '_blank');
  }, [activePreviewFile, outputFiles]);

  const statusColor = status === 'converting' ? 'blue' : status === 'done' ? 'green' : status === 'failed' ? 'red' : 'gray';
  const statusLabel = status === 'converting' ? 'Converting' : status === 'done' ? 'Done' : status === 'failed' ? 'Failed' : 'Idle';

  return (
    <Box style={{
      display: 'flex',
      width: '100%',
      minHeight: 600,
      overflow: 'hidden',
      border: '1px solid var(--mantine-color-default-border)',
      borderRadius: 'var(--mantine-radius-md)',
      background: 'var(--mantine-color-default)',
    }}>
      {/* Sidebar */}
      <Box style={{
        width: 160,
        flexShrink: 0,
        borderRight: '1px solid var(--mantine-color-default-border)',
        overflowY: 'auto',
      }}>
        <Stack gap={0}>
          <SidebarGroup label="FORMAT" icon={<IconFileCode size={12} />}>
            <SidebarItem
              label="RINEX Converter"
              icon={<IconRefresh size={14} />}
              active={true}
              onClick={() => {}}
            />
          </SidebarGroup>
        </Stack>
      </Box>

      {/* Main content */}
      <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header bar */}
        <Group
          justify="space-between"
          px="md"
          py={8}
          style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
        >
          <Group gap="xs">
            <Title order={5}>RINEX Converter</Title>
            <Text size="xs" c="dimmed">convbin</Text>
          </Group>
          <Group gap="xs">
            <Badge size="sm" color={statusColor} variant="light">{statusLabel}</Badge>
            {status === 'converting' ? (
              <Button
                size="compact-xs"
                color="red"
                variant="light"
                leftSection={<IconPlayerStop size={14} />}
                onClick={handleStop}
              >
                Stop
              </Button>
            ) : (
              <Button
                size="compact-xs"
                leftSection={<IconPlayerPlay size={14} />}
                onClick={handleConvert}
                disabled={!form.rawFile}
              >
                Convert
              </Button>
            )}
          </Group>
        </Group>

        {/* Form + Console split */}
        <Box style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Form (55%) */}
          <ScrollArea style={{ width: '55%', flexShrink: 0 }}>
            <Stack gap={10} p="md">
              {/* Input Section */}
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.06em' }}>Input</Text>
              <FieldRow label="Raw File">
                <Group wrap="nowrap" gap={4}>
                  <TextInput
                    size="xs"
                    value={form.rawFile}
                    onChange={e => setForm(prev => ({ ...prev, rawFile: e.currentTarget.value }))}
                    placeholder="/data/raw/receiver.ubx"
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser('rawFile', 'data')}>
                    <IconFolder size={16} />
                  </ActionIcon>
                </Group>
              </FieldRow>
              <FieldRow label="Receiver Format">
                <Select
                  size="xs"
                  value={form.receiverFormat}
                  onChange={v => setForm(prev => ({ ...prev, receiverFormat: v || '' }))}
                  data={RECEIVER_FORMATS}
                />
              </FieldRow>
              <FieldRow label="Receiver Options">
                <TextInput
                  size="xs"
                  value={form.receiverOptions}
                  onChange={e => setForm(prev => ({ ...prev, receiverOptions: e.currentTarget.value }))}
                  placeholder="-ephall -tadj=1"
                />
              </FieldRow>

              {/* Output Section */}
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.06em', marginTop: 8 }}>Output</Text>
              <FieldRow label="Observation File">
                <Group wrap="nowrap" gap={4}>
                  <TextInput
                    size="xs"
                    value={form.observationFile}
                    onChange={e => setForm(prev => ({ ...prev, observationFile: e.currentTarget.value }))}
                    placeholder="auto-generated"
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser('observationFile', 'workspace')}>
                    <IconFolder size={16} />
                  </ActionIcon>
                </Group>
              </FieldRow>
              <FieldRow label="Navigation File">
                <Group wrap="nowrap" gap={4}>
                  <TextInput
                    size="xs"
                    value={form.navigationFile}
                    onChange={e => setForm(prev => ({ ...prev, navigationFile: e.currentTarget.value }))}
                    placeholder="auto-generated"
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser('navigationFile', 'workspace')}>
                    <IconFolder size={16} />
                  </ActionIcon>
                </Group>
              </FieldRow>
              <FieldRow label="RINEX Version">
                <Select
                  size="xs"
                  value={form.rinexVersion}
                  onChange={v => setForm(prev => ({ ...prev, rinexVersion: v || '3.04' }))}
                  data={RINEX_VERSIONS}
                />
              </FieldRow>
              <FieldRow label="Output Directory">
                <Group wrap="nowrap" gap={4}>
                  <TextInput
                    size="xs"
                    value={form.outputDirectory}
                    onChange={e => setForm(prev => ({ ...prev, outputDirectory: e.currentTarget.value }))}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser('outputDirectory', 'workspace', true)}>
                    <IconFolder size={16} />
                  </ActionIcon>
                </Group>
              </FieldRow>
              <FieldRow label="Station ID">
                <TextInput
                  size="xs"
                  value={form.stationId}
                  onChange={e => setForm(prev => ({ ...prev, stationId: e.currentTarget.value }))}
                />
              </FieldRow>

              {/* Time Range (collapsible) */}
              <CollapsibleSection label="Time Range">
                <FieldRow label="Time Start">
                  <DateTimePicker
                    size="xs"
                    valueFormat="YYYY/MM/DD HH:mm:ss"
                    placeholder="2026/03/28 00:00:00"
                    clearable
                    leftSection={<IconCalendar size={14} />}
                    value={form.timeStart ? dayjs(form.timeStart, 'YYYY/MM/DD HH:mm:ss').toDate() : null}
                    onChange={date => setForm(prev => ({ ...prev, timeStart: date ? dayjs(date).format('YYYY/MM/DD HH:mm:ss') : '' }))}
                    style={{ flex: 1 }}
                    styles={{ input: { fontSize: '11px' } }}
                  />
                </FieldRow>
                <FieldRow label="Time End">
                  <DateTimePicker
                    size="xs"
                    valueFormat="YYYY/MM/DD HH:mm:ss"
                    placeholder="2026/03/28 23:59:59"
                    clearable
                    leftSection={<IconCalendar size={14} />}
                    value={form.timeEnd ? dayjs(form.timeEnd, 'YYYY/MM/DD HH:mm:ss').toDate() : null}
                    onChange={date => setForm(prev => ({ ...prev, timeEnd: date ? dayjs(date).format('YYYY/MM/DD HH:mm:ss') : '' }))}
                    style={{ flex: 1 }}
                    styles={{ input: { fontSize: '11px' } }}
                  />
                </FieldRow>
                <FieldRow label="RTCM Ref Time">
                  <DateTimePicker
                    size="xs"
                    valueFormat="YYYY/MM/DD HH:mm:ss"
                    placeholder="2026/03/28 00:00:00"
                    clearable
                    leftSection={<IconCalendar size={14} />}
                    value={form.rtcmRefTime ? dayjs(form.rtcmRefTime, 'YYYY/MM/DD HH:mm:ss').toDate() : null}
                    onChange={date => setForm(prev => ({ ...prev, rtcmRefTime: date ? dayjs(date).format('YYYY/MM/DD HH:mm:ss') : '' }))}
                    style={{ flex: 1 }}
                    styles={{ input: { fontSize: '11px' } }}
                  />
                </FieldRow>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Interval / Tol / Span" style={LABEL_STYLE}
                    fields={[{ name: 'Interval (s)' }, { name: 'Epoch Tolerance (s)' }, { name: 'Time Span (s)' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <NumberInput
                      size="xs"
                      title="Interval"
                      aria-label="Interval"
                      value={form.interval}
                      onChange={v => setForm(prev => ({ ...prev, interval: v === '' ? '' : Number(v) }))}
                      min={0}
                      hideControls
                      placeholder="Interval"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <NumberInput
                      size="xs"
                      title="Epoch Tolerance"
                      aria-label="Epoch Tolerance"
                      value={form.epochTolerance}
                      onChange={v => setForm(prev => ({ ...prev, epochTolerance: v === '' ? 0.005 : Number(v) }))}
                      min={0}
                      hideControls
                      placeholder="Tol"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <NumberInput
                      size="xs"
                      title="Time Span"
                      aria-label="Time Span"
                      value={form.timeSpan}
                      onChange={v => setForm(prev => ({ ...prev, timeSpan: v === '' ? '' : Number(v) }))}
                      min={0}
                      hideControls
                      placeholder="Span"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  </Group>
                </Group>
              </CollapsibleSection>

              {/* Signal Options (collapsible) */}
              <CollapsibleSection label="Signal Options">
                <FieldRow label="Frequencies">
                  <NumberInput
                    size="xs"
                    value={form.frequencies}
                    onChange={v => setForm(prev => ({ ...prev, frequencies: v === '' ? 5 : Number(v) }))}
                    min={1}
                    max={7}
                  />
                </FieldRow>
                <Group justify="space-between" gap="md" align="center" mih={30}>
                  <Switch
                    size="xs"
                    label="Include Doppler"
                    styles={{ label: { fontSize: '10px' } }}
                    checked={form.includeDoppler}
                    onChange={e => setForm(prev => ({ ...prev, includeDoppler: e.currentTarget.checked }))}
                  />
                  <Switch
                    size="xs"
                    label="Include SNR"
                    styles={{ label: { fontSize: '10px' } }}
                    checked={form.includeSnr}
                    onChange={e => setForm(prev => ({ ...prev, includeSnr: e.currentTarget.checked }))}
                  />
                  <Switch
                    size="xs"
                    label="Iono Correction"
                    styles={{ label: { fontSize: '10px' } }}
                    checked={form.ionoCorrection}
                    onChange={e => setForm(prev => ({ ...prev, ionoCorrection: e.currentTarget.checked }))}
                  />
                  <Switch
                    size="xs"
                    label="Time Correction"
                    styles={{ label: { fontSize: '10px' } }}
                    checked={form.timeCorrection}
                    onChange={e => setForm(prev => ({ ...prev, timeCorrection: e.currentTarget.checked }))}
                  />
                  <Switch
                    size="xs"
                    label="Leap Seconds"
                    styles={{ label: { fontSize: '10px' } }}
                    checked={form.leapSeconds}
                    onChange={e => setForm(prev => ({ ...prev, leapSeconds: e.currentTarget.checked }))}
                  />
                  <Switch
                    size="xs"
                    label="Half-cycle Corr"
                    styles={{ label: { fontSize: '10px' } }}
                    checked={form.halfCycleCorr}
                    onChange={e => setForm(prev => ({ ...prev, halfCycleCorr: e.currentTarget.checked }))}
                  />
                </Group>
                <FieldRow label="Exclude Satellites">
                  <TextInput
                    size="xs"
                    value={form.excludeSatellites}
                    onChange={e => setForm(prev => ({ ...prev, excludeSatellites: e.currentTarget.value }))}
                    placeholder="G04 G05 R09"
                  />
                </FieldRow>
                <FieldRow label="Signal Mask">
                  <TextInput
                    size="xs"
                    value={form.signalMask}
                    onChange={e => setForm(prev => ({ ...prev, signalMask: e.currentTarget.value }))}
                  />
                </FieldRow>
              </CollapsibleSection>

              {/* RINEX Header (collapsible) */}
              <CollapsibleSection label="RINEX Header">
                <FieldRow label="Comment">
                  <TextInput size="xs" value={form.comment} onChange={e => setForm(prev => ({ ...prev, comment: e.currentTarget.value }))} />
                </FieldRow>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Marker" style={LABEL_STYLE}
                    fields={[{ name: 'Name' }, { name: 'Number' }, { name: 'Type' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <TextInput size="xs" title="Marker Name" aria-label="Marker Name" placeholder="Name" value={form.markerName} onChange={e => setForm(prev => ({ ...prev, markerName: e.currentTarget.value }))} style={{ flex: 1, minWidth: 0 }} />
                    <TextInput size="xs" title="Marker Number" aria-label="Marker Number" placeholder="Number" value={form.markerNumber} onChange={e => setForm(prev => ({ ...prev, markerNumber: e.currentTarget.value }))} style={{ flex: 1, minWidth: 0 }} />
                    <TextInput size="xs" title="Marker Type" aria-label="Marker Type" placeholder="Type" value={form.markerType} onChange={e => setForm(prev => ({ ...prev, markerType: e.currentTarget.value }))} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <FieldRow label="Observer/Agency">
                  <TextInput size="xs" value={form.observerAgency} onChange={e => setForm(prev => ({ ...prev, observerAgency: e.currentTarget.value }))} />
                </FieldRow>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Receiver / Antenna" style={LABEL_STYLE}
                    fields={[{ name: 'Receiver' }, { name: 'Antenna' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <TextInput size="xs" title="Receiver" aria-label="Receiver" placeholder="Receiver" value={form.receiver} onChange={e => setForm(prev => ({ ...prev, receiver: e.currentTarget.value }))} style={{ flex: 1, minWidth: 0 }} />
                    <TextInput size="xs" title="Antenna" aria-label="Antenna" placeholder="Antenna" value={form.antenna} onChange={e => setForm(prev => ({ ...prev, antenna: e.currentTarget.value }))} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Approx Position" style={LABEL_STYLE}
                    fields={[{ name: 'X (m)' }, { name: 'Y (m)' }, { name: 'Z (m)' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <TextInput size="xs" title="X" aria-label="X" placeholder="X" value={xyz(form.approxPosition)[0]} onChange={e => setForm(prev => ({ ...prev, approxPosition: setXyz(prev.approxPosition, 0, e.currentTarget.value) }))} style={{ flex: 1, minWidth: 0 }} />
                    <TextInput size="xs" title="Y" aria-label="Y" placeholder="Y" value={xyz(form.approxPosition)[1]} onChange={e => setForm(prev => ({ ...prev, approxPosition: setXyz(prev.approxPosition, 1, e.currentTarget.value) }))} style={{ flex: 1, minWidth: 0 }} />
                    <TextInput size="xs" title="Z" aria-label="Z" placeholder="Z" value={xyz(form.approxPosition)[2]} onChange={e => setForm(prev => ({ ...prev, approxPosition: setXyz(prev.approxPosition, 2, e.currentTarget.value) }))} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
                <Group wrap="nowrap" align="center" gap="xs">
                  <ComboLabel label="Antenna Delta" style={LABEL_STYLE}
                    fields={[{ name: 'H (m)' }, { name: 'E (m)' }, { name: 'N (m)' }]} />
                  <Group wrap="nowrap" gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <TextInput size="xs" title="H" aria-label="H" placeholder="H" value={xyz(form.antennaDelta)[0]} onChange={e => setForm(prev => ({ ...prev, antennaDelta: setXyz(prev.antennaDelta, 0, e.currentTarget.value) }))} style={{ flex: 1, minWidth: 0 }} />
                    <TextInput size="xs" title="E" aria-label="E" placeholder="E" value={xyz(form.antennaDelta)[1]} onChange={e => setForm(prev => ({ ...prev, antennaDelta: setXyz(prev.antennaDelta, 1, e.currentTarget.value) }))} style={{ flex: 1, minWidth: 0 }} />
                    <TextInput size="xs" title="N" aria-label="N" placeholder="N" value={xyz(form.antennaDelta)[2]} onChange={e => setForm(prev => ({ ...prev, antennaDelta: setXyz(prev.antennaDelta, 2, e.currentTarget.value) }))} style={{ flex: 1, minWidth: 0 }} />
                  </Group>
                </Group>
              </CollapsibleSection>

              {/* Debug (collapsible) */}
              <CollapsibleSection label="Debug">
                <FieldRow label="Trace Level">
                  <Select
                    size="xs"
                    value={form.traceLevel}
                    onChange={v => setForm(prev => ({ ...prev, traceLevel: v || '0' }))}
                    data={TRACE_LEVELS}
                  />
                </FieldRow>
              </CollapsibleSection>
            </Stack>
          </ScrollArea>

          {/* Right panel (45%) — Console + Preview tabs */}
          <Box style={{
            width: '45%',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--mantine-color-default-border)',
          }}>
            {/* Tab header */}
            <Group
              justify="space-between"
              px="sm"
              py={6}
              style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
            >
              <Group gap={0}>
                <UnstyledButton
                  onClick={() => setRightTab('console')}
                  style={{
                    padding: '2px 10px',
                    fontSize: 12,
                    fontWeight: rightTab === 'console' ? 600 : 400,
                    color: rightTab === 'console' ? 'var(--mantine-color-text)' : 'var(--mantine-color-dimmed)',
                    borderBottom: rightTab === 'console' ? '2px solid var(--mantine-primary-color-filled)' : '2px solid transparent',
                  }}
                >
                  Console
                </UnstyledButton>
                <UnstyledButton
                  onClick={() => { if (previewEnabled) setRightTab('preview'); }}
                  style={{
                    padding: '2px 10px',
                    fontSize: 12,
                    fontWeight: rightTab === 'preview' ? 600 : 400,
                    color: !previewEnabled ? 'var(--mantine-color-dimmed)' : rightTab === 'preview' ? 'var(--mantine-color-text)' : 'var(--mantine-color-dimmed)',
                    borderBottom: rightTab === 'preview' ? '2px solid var(--mantine-primary-color-filled)' : '2px solid transparent',
                    opacity: previewEnabled ? 1 : 0.4,
                    cursor: previewEnabled ? 'pointer' : 'default',
                  }}
                >
                  Preview
                  {previewEnabled && currentPreview && (
                    <Badge size="xs" variant="light" ml={4}>{currentPreview.rinexType}</Badge>
                  )}
                </UnstyledButton>
              </Group>
              <Group gap={4}>
                {rightTab === 'console' ? (
                  <>
                    <Tooltip label="Copy">
                      <ActionIcon size="xs" variant="subtle" onClick={handleCopyLog}>
                        <IconCopy size={12} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Clear">
                      <ActionIcon size="xs" variant="subtle" onClick={handleClearLog}>
                        <IconTrash size={12} />
                      </ActionIcon>
                    </Tooltip>
                  </>
                ) : rightTab === 'preview' && currentPreview ? (
                  <Tooltip label="Download">
                    <ActionIcon size="xs" variant="subtle" onClick={handleDownloadPreview}>
                      <IconDownload size={12} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              </Group>
            </Group>

            {/* Console body (shown when tab is 'console') */}
            {rightTab === 'console' && (
              <>
                <ScrollArea
                  style={{ flex: 1, minHeight: 0 }}
                  viewportRef={consoleRef}
                  styles={{
                    viewport: {
                      backgroundColor: 'var(--mantine-color-dark-8, #1a1b1e)',
                      padding: '8px 12px',
                    },
                  }}
                >
                  {logLines.length === 0 ? (
                    <Text size="xs" c="dimmed" fs="italic" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}>
                      Waiting for output...
                    </Text>
                  ) : (
                    logLines.map((line, i) => (
                      <Text
                        key={i}
                        size="xs"
                        c="gray.4"
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '11px',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {line}
                      </Text>
                    ))
                  )}
                </ScrollArea>

                {/* Command preview strip */}
                <Box
                  px="sm"
                  py={6}
                  style={{
                    borderTop: '1px solid var(--mantine-color-default-border)',
                    backgroundColor: 'var(--mantine-color-dark-8, #1a1b1e)',
                  }}
                >
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0, fontSize: '10px' }}>Command Preview</Text>
                    <Text
                      size="xs"
                      c="gray.5"
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '9px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flex: 1,
                        minWidth: 0,
                      }}
                      title={commandPreview}
                    >
                      {commandPreview}
                    </Text>
                  </Group>
                </Box>
              </>
            )}

            {/* Preview body (shown when tab is 'preview') */}
            {rightTab === 'preview' && (
              <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {/* File type toggle + download */}
                {availablePreviewTypes.length > 1 && (
                  <Group px="sm" py={4} style={{ borderBottom: '0.5px solid var(--mantine-color-default-border)' }}>
                    <SegmentedControl
                      size="xs"
                      value={activePreviewFile}
                      onChange={v => setActivePreviewFile(v as PreviewFileType)}
                      data={availablePreviewTypes.map(t => ({ value: t, label: t.toUpperCase() }))}
                    />
                  </Group>
                )}

                {previewLoading ? (
                  <Stack align="center" justify="center" style={{ flex: 1 }}>
                    <Text size="xs" c="dimmed">Loading preview...</Text>
                  </Stack>
                ) : currentPreview ? (
                  <>
                    {/* Info bar */}
                    <Box px="sm" py={4} style={{ borderBottom: '0.5px solid var(--mantine-color-default-border)', fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>
                      <Text size="xs" c="dimmed" style={{ fontSize: 11 }}>
                        {currentPreview.filename} — RINEX {currentPreview.rinexType} — {currentPreview.totalLines.toLocaleString()} lines
                        <span style={{ marginLeft: 8 }}>
                          Showing header ({currentPreview.headerLines} lines) + first 5 epochs
                        </span>
                      </Text>
                    </Box>

                    {/* RINEX content */}
                    <ScrollArea style={{ flex: 1, minHeight: 0 }}>
                      <Code block style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        lineHeight: 1.5,
                        whiteSpace: 'pre',
                        background: 'transparent',
                        padding: '8px 12px',
                        border: 'none',
                      }}>
                        {currentPreview.header + currentPreview.dataPreview}
                      </Code>
                    </ScrollArea>

                    {/* Truncation notice */}
                    {currentPreview.truncated && (
                      <Box style={{
                        padding: '6px 12px',
                        fontSize: 10,
                        color: 'var(--mantine-color-dimmed)',
                        borderTop: '0.5px solid var(--mantine-color-default-border)',
                        fontStyle: 'italic',
                      }}>
                        {'\u2191'} Showing first 5 epochs.{' '}
                        {(currentPreview.totalLines - currentPreview.headerLines).toLocaleString()} data lines not shown.{' '}
                        Use the download button to get the full file.
                      </Box>
                    )}
                  </>
                ) : (
                  <Stack align="center" justify="center" style={{ flex: 1 }}>
                    <Text size="xs" c="dimmed" fs="italic">No preview available</Text>
                  </Stack>
                )}
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* File Browser Modal */}
      <FileBrowserModal
        opened={fbOpened}
        onClose={() => setFbOpened(false)}
        onSelect={handleFileSelect}
        title={fbSelectDir ? 'Select Directory' : 'Select File'}
        defaultRoot={fbDefaultRoot}
        selectDirectory={fbSelectDir}
      />
    </Box>
  );
}
