import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AppShell,
  Box,
  Button,
  Card,
  Grid,
  Group,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Title,
  useMantineColorScheme,
  ActionIcon,
  Badge,
  Code,
  Alert,
  Select,
} from '@mantine/core';
import {
  IconSun,
  IconMoon,
  IconSatellite,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconDownload,
  IconInfoCircle,
  IconChartDots,
  IconFileText,
  IconTerminal2,
  IconTrash,
  IconCopy,
  IconBug,
  IconPlus,
} from '@tabler/icons-react';
import { PostProcessingConfiguration  } from './components';
import { ResultViewer } from './components/viewer';
import { RealTimeProcessing } from './components/RealTimeProcessing';
import { ConversionPanel } from './components/ConversionPanel';
import { StreamPathHelp } from './components/StreamPathHelp';
import { MaskedPathInput } from './components/common/MaskedPathInput';
import { maskLogLine } from './utils/maskPath';
import { GnssTimeConverter } from './components/tools/GnssTimeConverter';
import { DataDownloader } from './components/tools/DataDownloader';
import { ToolsSidebar } from './components/tools/ToolsSidebar';
import { configToBackend } from './utils/configToBackend';
import { ObsViewerModal } from './components/obsViewer';
import type { ProcessStatus } from './components';
import { useWebSocket } from './hooks';
import type { LogMessage } from './hooks';
import * as mrtkRelayApi from './api/mrtkRelay';
import * as mrtkPostApi from './api/mrtkPost';
import type { MrtkPostConfig } from './types/mrtkPostConfig';
import { DEFAULT_MRTK_POST_CONFIG } from './types/mrtkPostConfig';
import type { InputStream, OutputStream, StreamType } from './types/streamConfig';
import type { BuilderConfig } from './types/streamConfig';
import { generateRelayArgs } from './utils/streamArgs';

function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <ActionIcon
      variant="default"
      size="lg"
      onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle color scheme"
    >
      {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  );
}

interface PostProcessingRightPanelProps {
  processStatus: ProcessStatus;
  progress: {
    epoch: string;
    quality: number;
    ns: number | null;
    ratio: number | null;
  } | null;
  logLines: string[];
  outputFile: string;
  onClearLog: () => void;
}

function PostProcessingRightPanel({
  processStatus,
  progress,
  logLines,
  outputFile,
  onClearLog,
}: PostProcessingRightPanelProps) {
  const [rightTab, setRightTab] = useState<string | null>('chart');
  const [refreshKey, setRefreshKey] = useState(0);
  const consoleViewportRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef(processStatus);

  // Auto-scroll console when new lines arrive
  useEffect(() => {
    if (rightTab === 'console' && consoleViewportRef.current) {
      consoleViewportRef.current.scrollTo({
        top: consoleViewportRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [logLines, rightTab]);

  // Auto-refresh chart when processing completes
  useEffect(() => {
    if (prevStatusRef.current === 'running' && processStatus === 'success') {
      setRefreshKey((k) => k + 1);
    }
    prevStatusRef.current = processStatus;
  }, [processStatus]);

  const handleCopyLog = useCallback(() => {
    navigator.clipboard.writeText(logLines.join('\n'));
  }, [logLines]);

  // Result summary strip content
  const renderSummaryStrip = () => {
    if (processStatus === 'running') {
      return (
        <Group justify="space-between" px="sm" py={6}>
          <Group gap="xs">
            {progress ? (
              <>
                <Badge
                  size="sm"
                  color={
                    progress.quality === 1 ? 'green' :
                    progress.quality === 2 ? 'yellow' :
                    progress.quality === 4 ? 'cyan' :
                    progress.quality === 5 ? 'orange' :
                    'gray'
                  }
                >
                  {progress.quality === 1 ? 'FIXED' :
                   progress.quality === 2 ? 'FLOAT' :
                   progress.quality === 4 ? 'DGPS' :
                   progress.quality === 5 ? 'SINGLE' :
                   `Q=${progress.quality}`}
                </Badge>
                <Text size="xs" ff="monospace" style={{ fontSize: '11px' }}>
                  {progress.epoch}
                </Text>
              </>
            ) : (
              <Text size="xs" c="dimmed" fs="italic">Processing...</Text>
            )}
          </Group>
          <Group gap="xs">
            {progress?.ns !== null && progress?.ns !== undefined && (
              <Badge size="xs" variant="light" color="blue">ns={progress.ns}</Badge>
            )}
            {progress?.ratio !== null && progress?.ratio !== undefined && (
              <Badge size="xs" variant="light" color={progress.ratio >= 3 ? 'green' : 'gray'}>
                ratio={progress.ratio.toFixed(1)}
              </Badge>
            )}
          </Group>
        </Group>
      );
    }

    if (processStatus === 'success') {
      return (
        <Group justify="space-between" px="sm" py={6}>
          <Group gap="xs">
            <Badge size="sm" color="green">Complete</Badge>
            <Code style={{ fontSize: '10px' }}>{outputFile}</Code>
          </Group>
          <Button
            variant="light"
            leftSection={<IconDownload size={12} />}
            size="compact-xs"
            component="a"
            href={`/api/files/download?path=${encodeURIComponent(outputFile)}`}
            download
          >
            Download
          </Button>
        </Group>
      );
    }

    if (processStatus === 'error') {
      return (
        <Group justify="center" px="sm" py={6}>
          <Badge size="sm" color="red">Error</Badge>
          <Text size="xs" c="dimmed">Processing failed. Check console for details.</Text>
        </Group>
      );
    }

    // idle
    return (
      <Group justify="center" px="sm" py={6}>
        <Text size="xs" c="dimmed" fs="italic">Waiting for output...</Text>
      </Group>
    );
  };

  const CONTENT_HEIGHT = 540;

  return (
    <Card withBorder p={0} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 1. Result summary strip */}
      <Box
        style={{
          borderBottom: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-5))',
          flexShrink: 0,
        }}
      >
        {renderSummaryStrip()}
      </Box>

      {/* 2. Tab bar + 3. Content area */}
      <Tabs
        value={rightTab}
        onChange={setRightTab}
        keepMounted={false}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Group
          justify="space-between"
          wrap="nowrap"
          px="sm"
          style={{
            backgroundColor: 'var(--app-surface)',
            borderBottom: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-6))',
            flexShrink: 0,
          }}
        >
          <Tabs.List style={{ borderBottom: 'none', flexWrap: 'nowrap' }}>
            <Tabs.Tab
              value="chart"
              leftSection={<IconChartDots size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Chart
            </Tabs.Tab>
            <Tabs.Tab
              value="solution"
              leftSection={<IconFileText size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Solution
            </Tabs.Tab>
            <Tabs.Tab
              value="console"
              leftSection={<IconTerminal2 size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Console
            </Tabs.Tab>
            <Tabs.Tab
              value="trace"
              leftSection={<IconBug size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Trace
            </Tabs.Tab>
          </Tabs.List>

          {/* Action buttons for active tab */}
          <Group gap="xs" wrap="nowrap">
            {rightTab === 'console' && (
              <>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={handleCopyLog}
                  title="Copy to clipboard"
                >
                  <IconCopy size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={onClearLog}
                  title="Clear terminal"
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </>
            )}
            {rightTab === 'solution' && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => setRefreshKey((k) => k + 1)}
                title="Refresh"
              >
                <IconRefresh size={14} />
              </ActionIcon>
            )}
          </Group>
        </Group>

        {/* Chart tab */}
        <Tabs.Panel value="chart" style={{ flex: 1, minHeight: 0 }}>
          <ResultViewer
            filePath={outputFile}
            maxHeight={CONTENT_HEIGHT}
            refreshKey={refreshKey}
          />
        </Tabs.Panel>

        {/* Solution tab */}
        <Tabs.Panel value="solution" style={{ flex: 1, minHeight: 0 }}>
          <SolutionView
            outputFile={outputFile}
            refreshKey={refreshKey}
            maxHeight={CONTENT_HEIGHT}
          />
        </Tabs.Panel>

        {/* Console tab */}
        <Tabs.Panel value="console" style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea h={CONTENT_HEIGHT} viewportRef={consoleViewportRef} p="sm">
            {logLines.length === 0 ? (
              <Text size="sm" c="dimmed" fs="italic" ff="monospace">
                Waiting for output...
              </Text>
            ) : (
              <Code
                block
                style={{
                  backgroundColor: 'transparent',
                  color: 'light-dark(var(--mantine-color-dark-8), var(--mantine-color-green-4))',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: '12px',
                  lineHeight: 1.6,
                }}
              >
                {logLines.map((line, index) => (
                  <div key={index}>{maskLogLine(line)}</div>
                ))}
              </Code>
            )}
          </ScrollArea>
        </Tabs.Panel>

        {/* Trace tab */}
        <Tabs.Panel value="trace" style={{ flex: 1, minHeight: 0 }}>
          <SolutionView
            outputFile={outputFile ? outputFile + '.trace' : ''}
            refreshKey={refreshKey}
            maxHeight={CONTENT_HEIGHT}
          />
        </Tabs.Panel>
      </Tabs>

      {/* 4. Fix rate gauge bar (always visible) */}
      <Box
        px="sm"
        py={4}
        style={{
          borderTop: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-5))',
          flexShrink: 0,
          height: 32,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Group justify="center" style={{ width: '100%' }}>
          <Text size="xs" c="dimmed">
            Fix: --- | Float: --- | Single: ---
          </Text>
        </Group>
      </Box>
    </Card>
  );
}

/** Displays the solution output file content in a scrollable monospace block */
function SolutionView({
  outputFile,
  refreshKey,
  maxHeight,
}: {
  outputFile: string;
  refreshKey: number;
  maxHeight: number;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!outputFile) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/files/read?path=${encodeURIComponent(outputFile)}&max_lines=5000`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setContent(data.content || '');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [outputFile, refreshKey]);

  // Auto-scroll to bottom on content change
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight });
    }
  }, [content]);

  if (loading) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="xs" c="dimmed">Loading solution file...</Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="xs" c="dimmed" fs="italic" ff="monospace">{error}</Text>
      </Stack>
    );
  }

  if (!content) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">No solution file to display</Text>
      </Stack>
    );
  }

  return (
    <ScrollArea h={maxHeight} viewportRef={viewportRef} p="sm">
      <Code
        block
        style={{
          backgroundColor: 'transparent',
          whiteSpace: 'pre',
          fontSize: '11px',
          lineHeight: 1.5,
        }}
      >
        {content}
      </Code>
    </ScrollArea>
  );
}

function PostProcessingPanel() {
  const [roverFile, setRoverFile] = useState('/workspace/rover.obs');
  const [baseFile, setBaseFile] = useState('');
  const [navFile, setNavFile] = useState('/workspace/nav.nav');
  const [correctionFiles, setCorrectionFiles] = useState<string[]>(['', '']);
  const [outputFile, setOutputFile] = useState('/workspace/output.pos');
  const [processStatus, setProcessStatus] = useState<ProcessStatus>('idle');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [config, setConfig] = useState<MrtkPostConfig>(DEFAULT_MRTK_POST_CONFIG);

  // Modes that require a base station
  const needsBase = ['dgps', 'kinematic', 'static', 'fixed', 'moving-base'].includes(
    config.positioning.positioningMode,
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [qcModalOpened, setQcModalOpened] = useState(false);
  const [progress, setProgress] = useState<{
    epoch: string;
    quality: number;
    ns: number | null;
    ratio: number | null;
  } | null>(null);

  // Use ref for jobId to avoid WebSocket reconnection when jobId changes
  // Updated synchronously in handleStart (not via useEffect) to avoid timing gaps
  const jobIdRef = useRef<string | null>(null);



  // WebSocket connection for real-time logs
  useWebSocket({
    onMessage: useCallback((message: LogMessage) => {
      // Only process messages for our job (use ref to avoid reconnection)
      if (message.process_id === jobIdRef.current) {
        if (message.type === 'log' && message.message) {
          setLogLines((prev) => [...prev.slice(-500), message.message!]);
        }
        if (message.type === 'progress') {
          setProgress({
            epoch: message.epoch || '',
            quality: message.quality ?? 0,
            ns: message.ns ?? null,
            ratio: message.ratio ?? null,
          });
        }
        if (message.type === 'status' && message.status) {
          // Map backend status to UI status
          const statusMap: Record<string, ProcessStatus> = {
            running: 'running',
            completed: 'success',
            failed: 'error',
          };
          const newStatus = statusMap[message.status] || 'idle';
          setProcessStatus(newStatus);
          if (newStatus !== 'running') {
            setIsLoading(false);
          }
        }
      }
    }, []),
    onConnect: useCallback(() => {}, []),
    onDisconnect: useCallback(() => {}, []),
  });

  // Convert frontend config to backend format (camelCase -> snake_case)
  const buildBackendConfig = useCallback(() => configToBackend(config), [config]);

  const handleExportConf = async () => {
    try {
      await mrtkPostApi.exportConf(buildBackendConfig());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export conf');
    }
  };

  const handleStart = async () => {
    if (!config) {
      setError('Configuration not set');
      return;
    }

    // Validate inputs
    if (!roverFile || !navFile || !outputFile) {
      setError('Please provide all required input files');
      return;
    }

    if (needsBase && !baseFile) {
      setError('Please provide base station observation file for the selected positioning mode');
      return;
    }

    setIsLoading(true);
    setError(null);
    setLogLines([]);
    setProgress(null);
    setProcessStatus('running');

    try {
      const backendConfig = buildBackendConfig();

      // Build time_range from config.time (only if any setting is enabled)
      const t = config.time;
      const timeRange = (t?.startEnabled || t?.endEnabled || (t?.interval && t.interval > 0))
        ? {
            start_time: t.startEnabled ? `${t.startDate} ${t.startTime}` : undefined,
            end_time: t.endEnabled ? `${t.endDate} ${t.endTime}` : undefined,
            interval: t.interval > 0 ? t.interval : undefined,
          }
        : undefined;

      const response = await mrtkPostApi.executeMrtkPost({
        input_files: {
          rover_obs_file: roverFile,
          base_obs_file: needsBase ? baseFile : undefined,
          nav_file: navFile,
          correction_files: correctionFiles.filter((f) => f.trim() !== ''),
          output_file: outputFile,
        },
        config: backendConfig as any,
        time_range: timeRange,
      });

      // Set ref synchronously BEFORE state update so WebSocket handler can
      // match messages immediately (useEffect would run after next render)
      jobIdRef.current = response.job_id;
      setJobId(response.job_id);
      setLogLines((prev) => [...prev, `[INFO] Job started: ${response.job_id}`]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start processing';
      setError(message);
      setLogLines((prev) => [...prev, `[ERROR] ${message}`]);
      setProcessStatus('error');
      setIsLoading(false);
    }
  };

  // Polling fallback: check job status via REST API when running.
  // This catches completion even if WebSocket messages are missed.
  useEffect(() => {
    if (processStatus !== 'running' || !jobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/mrtk-post/status/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'completed' || data.status === 'failed') {
          const statusMap: Record<string, ProcessStatus> = {
            completed: 'success',
            failed: 'error',
          };
          setProcessStatus(statusMap[data.status] || 'idle');
          setIsLoading(false);
          if (data.status === 'completed') {
            setLogLines((prev) => [...prev, `[INFO] Processing completed (return code: ${data.return_code ?? 0})`]);
          } else {
            setLogLines((prev) => [...prev, `[ERROR] Processing failed: ${data.error_message || 'see logs'}`]);
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [processStatus, jobId]);

  const handleStop = () => {
    setProcessStatus('idle');
    jobIdRef.current = null;
    setLogLines((prev) => [...prev, '[INFO] Process stopped by user']);
    setIsLoading(false);
  };

  return (
    <>
    <Grid gutter="md">
      {/* Left Column: Configuration & Control */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap="xs">
          <PostProcessingConfiguration
            onConfigChange={setConfig}
            roverFile={roverFile}
            onRoverFileChange={setRoverFile}
            baseFile={baseFile}
            onBaseFileChange={setBaseFile}
            navFile={navFile}
            onNavFileChange={setNavFile}
            correctionFiles={correctionFiles}
            onCorrectionFilesChange={setCorrectionFiles}
            outputFile={outputFile}
            onOutputFileChange={setOutputFile}
            needsBase={needsBase}
            processStatus={processStatus}
            isLoading={isLoading}
            onExecute={handleStart}
            onStop={handleStop}
            onExportConf={handleExportConf}
            onQcPreview={() => setQcModalOpened(true)}
            roverFileValid={!!roverFile}
          />

          {/* Error Display */}
          {error && (
            <Alert color="red" icon={<IconInfoCircle size={14} />} p="xs" withCloseButton onClose={() => setError(null)}>
              <Text size="xs">{error}</Text>
            </Alert>
          )}
        </Stack>
      </Grid.Col>

      {/* Right Column: Monitoring */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <PostProcessingRightPanel
          processStatus={processStatus}
          progress={progress}
          logLines={logLines}
          outputFile={outputFile}
          onClearLog={() => setLogLines([])}
        />
      </Grid.Col>

    </Grid>

    <ObsViewerModal
      opened={qcModalOpened}
      onClose={() => setQcModalOpened(false)}
      obsFile={roverFile}
      navFile={navFile || undefined}
    />
    </>
  );
}

// --- Stream Server (Multi-stream) ---

const DEFAULT_SS_INPUT: InputStream = {
  id: 'input-1',
  type: 'tcpcli',
  path: '192.168.1.100:2101',
};

const DEFAULT_SS_OUTPUT: OutputStream = {
  id: 'output-1',
  type: 'file',
  path: '/workspace/output.ubx',
};

interface RelayStream {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'error';
  processId: string | null;
  input: InputStream;
  outputs: OutputStream[];
  logLines: string[];
}

const STREAM_TYPE_OPTIONS = [
  { value: 'serial', label: 'Serial' },
  { value: 'tcpcli', label: 'TCP Client' },
  { value: 'tcpsvr', label: 'TCP Server' },
  { value: 'ntripcli', label: 'NTRIP' },
  { value: 'file', label: 'File' },
];

const DEFAULT_PATH_FOR_TYPE: Record<StreamType, string> = {
  serial: 'ttyUSB0:115200',
  tcpcli: '192.168.1.100:2101',
  tcpsvr: ':2101',
  ntripcli: 'rtk2go.com:2101/MOUNT',
  file: '/workspace/output.ubx',
};

const PATH_PLACEHOLDER_FOR_TYPE: Record<StreamType, string> = {
  serial: 'ttyUSB0:115200',
  tcpcli: '192.168.1.100:2101',
  tcpsvr: ':2101',
  ntripcli: 'user:pass@host:port/mount',
  file: '/workspace/output.ubx',
};

function StreamServerPanel() {
  const [streams, setStreams] = useState<RelayStream[]>([{
    id: crypto.randomUUID(),
    name: 'Stream 1',
    status: 'idle',
    processId: null,
    input: { ...DEFAULT_SS_INPUT, id: crypto.randomUUID() },
    outputs: [{ ...DEFAULT_SS_OUTPUT, id: crypto.randomUUID() }],
    logLines: [],
  }]);
  const [activeStreamId, setActiveStreamId] = useState<string>(streams[0].id);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // Ref for process-id-to-stream-id mapping (avoids re-creating WS callback)
  const processMapRef = useRef<Map<string, string>>(new Map());

  // Keep processMapRef in sync
  useEffect(() => {
    const map = new Map<string, string>();
    for (const s of streams) {
      if (s.processId) map.set(s.processId, s.id);
    }
    processMapRef.current = map;
  }, [streams]);

  const consoleViewportRef = useRef<HTMLDivElement>(null);

  // Auto-scroll console
  const activeStream = streams.find((s) => s.id === activeStreamId);
  useEffect(() => {
    if (consoleViewportRef.current) {
      consoleViewportRef.current.scrollTo({ top: consoleViewportRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [activeStream?.logLines]);

  // WebSocket
  useWebSocket({
    onMessage: useCallback((message: LogMessage) => {
      if (!message.process_id) return;
      const streamId = processMapRef.current.get(message.process_id);
      if (!streamId) return;

      if (message.type === 'log' && message.message) {
        setStreams((prev) => prev.map((s) =>
          s.id === streamId ? { ...s, logLines: [...s.logLines.slice(-500), message.message!] } : s
        ));
      }
      if (message.type === 'status' && message.status) {
        const statusMap: Record<string, RelayStream['status']> = {
          idle: 'idle', starting: 'running', running: 'running',
          stopping: 'running', stopped: 'idle', error: 'error',
        };
        const newStatus = statusMap[message.status] || 'idle';
        setStreams((prev) => prev.map((s) =>
          s.id === streamId ? { ...s, status: newStatus, processId: newStatus === 'idle' ? null : s.processId } : s
        ));
      }
    }, []),
    onConnect: useCallback(() => {}, []),
    onDisconnect: useCallback(() => {}, []),
  });

  // Helpers to update a single stream
  const updateStream = useCallback((id: string, patch: Partial<RelayStream>) => {
    setStreams((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }, []);

  const handleAddStream = () => {
    if (streams.length >= 4) return;
    const num = streams.length + 1;
    const newStream: RelayStream = {
      id: crypto.randomUUID(),
      name: `Stream ${num}`,
      status: 'idle',
      processId: null,
      input: { ...DEFAULT_SS_INPUT, id: crypto.randomUUID() },
      outputs: [{ ...DEFAULT_SS_OUTPUT, id: crypto.randomUUID() }],
      logLines: [],
    };
    setStreams((prev) => [...prev, newStream]);
    setActiveStreamId(newStream.id);
  };

  const handleRemoveStream = (id: string) => {
    const s = streams.find((st) => st.id === id);
    if (s?.status === 'running') return; // Don't remove running streams
    setStreams((prev) => {
      const next = prev.filter((st) => st.id !== id);
      if (next.length === 0) return prev; // Keep at least one
      return next;
    });
    if (activeStreamId === id) {
      const remaining = streams.filter((st) => st.id !== id);
      if (remaining.length > 0) setActiveStreamId(remaining[0].id);
    }
  };

  const buildArgs = (stream: RelayStream): string[] => {
    const config: BuilderConfig = { input: stream.input, outputs: stream.outputs };
    return generateRelayArgs(config);
  };

  const handleStartStream = async (id: string) => {
    const stream = streams.find((s) => s.id === id);
    if (!stream || stream.status === 'running') return;

    setLoadingIds((prev) => new Set(prev).add(id));
    try {
      const args = buildArgs(stream);
      const result = await mrtkRelayApi.startRelay({ args });
      updateStream(id, { processId: result.id, status: 'running', logLines: [`[INFO] Started (${result.id})`] });
    } catch (err) {
      updateStream(id, { status: 'error', logLines: [...stream.logLines, `[ERROR] ${err instanceof Error ? err.message : 'Failed to start'}`] });
    } finally {
      setLoadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleStopStream = async (id: string) => {
    const stream = streams.find((s) => s.id === id);
    if (!stream?.processId) return;

    setLoadingIds((prev) => new Set(prev).add(id));
    try {
      await mrtkRelayApi.stopRelay({ process_id: stream.processId });
      updateStream(id, { status: 'idle', processId: null });
    } catch (err) {
      updateStream(id, { logLines: [...stream.logLines, `[ERROR] ${err instanceof Error ? err.message : 'Failed to stop'}`] });
    } finally {
      setLoadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleStartAll = async () => {
    const idle = streams.filter((s) => s.status === 'idle');
    await Promise.allSettled(idle.map((s) => handleStartStream(s.id)));
  };

  const handleStopAll = async () => {
    const running = streams.filter((s) => s.status === 'running');
    await Promise.allSettled(running.map((s) => handleStopStream(s.id)));
  };

  // Input/output config handlers
  const handleInputTypeChange = (streamId: string, type: StreamType) => {
    setStreams((prev) => prev.map((s) =>
      s.id === streamId ? { ...s, input: { ...s.input, type, path: DEFAULT_PATH_FOR_TYPE[type] } } : s
    ));
  };

  const handleInputPathChange = (streamId: string, path: string) => {
    setStreams((prev) => prev.map((s) =>
      s.id === streamId ? { ...s, input: { ...s.input, path } } : s
    ));
  };

  const handleOutputTypeChange = (streamId: string, outputId: string, type: StreamType) => {
    setStreams((prev) => prev.map((s) =>
      s.id === streamId ? {
        ...s,
        outputs: s.outputs.map((o) => o.id === outputId ? { ...o, type, path: DEFAULT_PATH_FOR_TYPE[type] } : o),
      } : s
    ));
  };

  const handleOutputPathChange = (streamId: string, outputId: string, path: string) => {
    setStreams((prev) => prev.map((s) =>
      s.id === streamId ? {
        ...s,
        outputs: s.outputs.map((o) => o.id === outputId ? { ...o, path } : o),
      } : s
    ));
  };

  const handleAddOutput = (streamId: string) => {
    setStreams((prev) => prev.map((s) =>
      s.id === streamId ? {
        ...s,
        outputs: [...s.outputs, { ...DEFAULT_SS_OUTPUT, id: crypto.randomUUID() }],
      } : s
    ));
  };

  const handleRemoveOutput = (streamId: string, outputId: string) => {
    setStreams((prev) => prev.map((s) =>
      s.id === streamId ? {
        ...s,
        outputs: s.outputs.filter((o) => o.id !== outputId),
      } : s
    ));
  };

  const statusDotColor = (status: RelayStream['status']) => {
    switch (status) {
      case 'running': return '#22c55e';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const handleCopyLog = useCallback(() => {
    if (activeStream) navigator.clipboard.writeText(activeStream.logLines.join('\n'));
  }, [activeStream]);

  const handleClearLog = useCallback(() => {
    if (activeStreamId) updateStream(activeStreamId, { logLines: [] });
  }, [activeStreamId, updateStream]);

  const runningCount = streams.filter((s) => s.status === 'running').length;
  const CONSOLE_HEIGHT = 540;

  return (
    <Grid gutter="md">
      {/* Left Pane: Stream Cards */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <Group justify="space-between" mb="xs">
            <Title order={5} size="sm">Stream Server</Title>
            <Group gap="xs">
              <Button
                variant="light"
                size="compact-xs"
                leftSection={<IconPlus size={12} />}
                onClick={handleAddStream}
                disabled={streams.length >= 4}
              >
                Add Stream
              </Button>
              {runningCount > 0 ? (
                <Button
                  variant="filled"
                  color="red"
                  size="compact-xs"
                  leftSection={<IconPlayerStop size={12} />}
                  onClick={handleStopAll}
                >
                  Stop All
                </Button>
              ) : (
                <Button
                  variant="filled"
                  color="green"
                  size="compact-xs"
                  leftSection={<IconPlayerPlay size={12} />}
                  onClick={handleStartAll}
                >
                  Start All
                </Button>
              )}
            </Group>
          </Group>

          {/* Stream cards */}
          <ScrollArea style={{ flex: 1 }} offsetScrollbars>
            <Stack gap="xs">
              {streams.map((stream) => (
                <Card key={stream.id} withBorder p="xs" style={{ borderColor: activeStreamId === stream.id ? 'var(--mantine-color-blue-5)' : undefined }}>
                  <Stack gap="xs">
                    {/* Stream header row */}
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Box
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: statusDotColor(stream.status),
                            flexShrink: 0,
                          }}
                        />
                        <Text size="xs" fw={600}>{stream.name}</Text>
                        <Badge
                          size="xs"
                          variant="light"
                          color={stream.status === 'running' ? 'green' : stream.status === 'error' ? 'red' : 'gray'}
                        >
                          {stream.status === 'running' ? 'Running' : stream.status === 'error' ? 'Error' : 'Idle'}
                        </Badge>
                      </Group>
                      <Group gap={4}>
                        {stream.status === 'running' ? (
                          <ActionIcon
                            variant="light"
                            color="red"
                            size="xs"
                            onClick={() => handleStopStream(stream.id)}
                            loading={loadingIds.has(stream.id)}
                            title="Stop"
                          >
                            <IconPlayerStop size={12} />
                          </ActionIcon>
                        ) : (
                          <ActionIcon
                            variant="light"
                            color="green"
                            size="xs"
                            onClick={() => handleStartStream(stream.id)}
                            loading={loadingIds.has(stream.id)}
                            title="Start"
                          >
                            <IconPlayerPlay size={12} />
                          </ActionIcon>
                        )}
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="xs"
                          onClick={() => handleRemoveStream(stream.id)}
                          disabled={streams.length <= 1 || stream.status === 'running'}
                          title="Remove stream"
                        >
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Group>
                    </Group>

                    {/* Input */}
                    <Box>
                      <Group gap={4} mb={2}><Text size="xs" fw={500}>Input</Text><StreamPathHelp /></Group>
                      <Group gap="xs" grow>
                        <Select
                          size="xs"
                          value={stream.input.type}
                          onChange={(v) => handleInputTypeChange(stream.id, v as StreamType)}
                          data={STREAM_TYPE_OPTIONS}
                          style={{ maxWidth: 120 }}
                        />
                        <MaskedPathInput
                          size="xs"
                          value={stream.input.path}
                          onChange={(v) => handleInputPathChange(stream.id, v)}
                          placeholder={PATH_PLACEHOLDER_FOR_TYPE[stream.input.type]}
                          styles={{ input: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' } }}
                        />
                      </Group>
                    </Box>

                    {/* Outputs */}
                    <Box>
                      <Group justify="space-between" mb={2}>
                        <Group gap={4}><Text size="xs" fw={500}>Outputs</Text><StreamPathHelp /></Group>
                        <ActionIcon variant="light" color="blue" size="xs" onClick={() => handleAddOutput(stream.id)}>
                          <IconPlus size={10} />
                        </ActionIcon>
                      </Group>
                      <Stack gap={4}>
                        {stream.outputs.map((output) => (
                          <Group key={output.id} gap="xs" grow wrap="nowrap">
                            <Select
                              size="xs"
                              value={output.type}
                              onChange={(v) => handleOutputTypeChange(stream.id, output.id, v as StreamType)}
                              data={STREAM_TYPE_OPTIONS}
                              style={{ maxWidth: 120, flexShrink: 0 }}
                            />
                            <MaskedPathInput
                              size="xs"
                              value={output.path}
                              onChange={(v) => handleOutputPathChange(stream.id, output.id, v)}
                              placeholder={PATH_PLACEHOLDER_FOR_TYPE[output.type]}
                              styles={{ input: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' } }}
                            />
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="xs"
                              onClick={() => handleRemoveOutput(stream.id, output.id)}
                              disabled={stream.outputs.length <= 1}
                              style={{ flexShrink: 0 }}
                            >
                              <IconTrash size={10} />
                            </ActionIcon>
                          </Group>
                        ))}
                      </Stack>
                    </Box>
                  </Stack>
                </Card>
              ))}
            </Stack>
          </ScrollArea>
        </Card>
      </Grid.Col>

      {/* Right Pane: Console */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder p={0} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Tabs
            value={activeStreamId}
            onChange={(v) => { if (v) setActiveStreamId(v); }}
            keepMounted={false}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            <Group
              justify="space-between"
              wrap="nowrap"
              px="sm"
              style={{
                backgroundColor: 'var(--app-surface)',
                borderBottom: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-6))',
                flexShrink: 0,
              }}
            >
              <Tabs.List style={{ borderBottom: 'none', flexWrap: 'nowrap' }}>
                {streams.map((stream) => (
                  <Tabs.Tab
                    key={stream.id}
                    value={stream.id}
                    leftSection={
                      <Box
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          backgroundColor: statusDotColor(stream.status),
                        }}
                      />
                    }
                    style={{ fontSize: '11px', padding: '6px 10px' }}
                  >
                    {stream.name}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              <Group gap="xs" wrap="nowrap">
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleCopyLog} title="Copy to clipboard">
                  <IconCopy size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleClearLog} title="Clear terminal">
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            </Group>

            {streams.map((stream) => (
              <Tabs.Panel key={stream.id} value={stream.id} style={{ flex: 1, minHeight: 0 }}>
                <ScrollArea h={CONSOLE_HEIGHT} viewportRef={stream.id === activeStreamId ? consoleViewportRef : undefined} p="sm">
                  {stream.logLines.length === 0 ? (
                    <Text size="sm" c="dimmed" fs="italic" ff="monospace">
                      Waiting for output...
                    </Text>
                  ) : (
                    <Code
                      block
                      style={{
                        backgroundColor: 'transparent',
                        color: 'light-dark(var(--mantine-color-dark-8), var(--mantine-color-green-4))',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11px',
                        lineHeight: 1.6,
                      }}
                    >
                      {stream.logLines.map((line, index) => (
                        <div key={index}>{maskLogLine(line)}</div>
                      ))}
                    </Code>
                  )}
                </ScrollArea>
              </Tabs.Panel>
            ))}
          </Tabs>
        </Card>
      </Grid.Col>
    </Grid>
  );
}

function RealTimePanel() {
  return <RealTimeProcessing />;
}

// ConversionPanel is now imported from ./components/ConversionPanel

function App() {
  const [activeTab, setActiveTab] = useState<string | null>('stream-server');
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [mrtkVersion, setMrtkVersion] = useState<string>('');
  const [selectedTool, setSelectedTool] = useState('time-converter');

  useEffect(() => {
    // Check API health
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setHealthStatus(data.status === 'ok' ? 'ok' : 'error');
      })
      .catch(() => {
        setHealthStatus('error');
      });

    // Get MRTKLIB version (from git tag)
    fetch('/api/mrtklib/version')
      .then((res) => res.json())
      .then((data) => {
        setMrtkVersion(data.version || '');
      })
      .catch(() => {
        setMrtkVersion('');
      });
  }, []);

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          {/* Logo & Title */}
          <Group gap="sm">
            <IconSatellite size={28} />
            <Stack gap={0}>
              <Title order={4} visibleFrom="sm">MRTKLIB Web UI</Title>
              {mrtkVersion && (
                <Text size="xs" c="dimmed" visibleFrom="md">MRTKLIB {mrtkVersion}</Text>
              )}
            </Stack>
          </Group>

          {/* Tabs - Center */}
          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            variant="pills"
            visibleFrom="sm"
          >
            <Tabs.List>
              <Tabs.Tab value="post-processing">Post Processing</Tabs.Tab>
              <Tabs.Tab value="realtime">Real-Time</Tabs.Tab>
              <Tabs.Tab value="stream-server">Stream Server</Tabs.Tab>
              <Tabs.Tab value="conversion">Conversion</Tabs.Tab>
              <Tabs.Tab value="tools">Tools</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {/* Right Controls */}
          <Group gap="sm">
            <Badge
              color={healthStatus === 'ok' ? 'green' : healthStatus === 'error' ? 'red' : 'gray'}
              variant="dot"
              size="lg"
              visibleFrom="sm"
            >
              API: {healthStatus.toUpperCase()}
            </Badge>
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        {/* Mobile Tabs */}
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          variant="pills"
          hiddenFrom="sm"
          mb="md"
        >
          <Tabs.List grow>
            <Tabs.Tab value="post-processing">Post</Tabs.Tab>
            <Tabs.Tab value="realtime">RT</Tabs.Tab>
            <Tabs.Tab value="stream-server">Stream</Tabs.Tab>
            <Tabs.Tab value="conversion">Convert</Tabs.Tab>
            <Tabs.Tab value="tools">Tools</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {/* Tab Content - keep all panels mounted to preserve state */}
        <div style={{ display: activeTab === 'post-processing' ? undefined : 'none' }}>
          <PostProcessingPanel />
        </div>
        <div style={{ display: activeTab === 'realtime' ? undefined : 'none' }}>
          <RealTimePanel />
        </div>
        <div style={{ display: activeTab === 'stream-server' ? undefined : 'none' }}>
          <StreamServerPanel />
        </div>
        <div style={{ display: activeTab === 'conversion' ? undefined : 'none' }}>
          <ConversionPanel />
        </div>
        <div style={{ display: activeTab === 'tools' ? 'flex' : 'none', width: '100%', minHeight: 500, overflow: 'hidden', border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)', background: 'var(--mantine-color-default)' }}>
          <div style={{ width: 160, flexShrink: 0, borderRight: '1px solid var(--mantine-color-default-border)', overflowY: 'auto' }}>
            <ToolsSidebar selected={selectedTool} onSelect={setSelectedTool} />
          </div>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '1.5rem 2rem' }}>
            {selectedTool === 'time-converter' && <GnssTimeConverter />}
            {selectedTool === 'downloader' && <DataDownloader />}
          </div>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

export default App;
