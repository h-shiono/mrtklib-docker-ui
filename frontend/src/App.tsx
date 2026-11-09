import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AppShell,
  Box,
  Button,
  Card,
  Grid,
  Group,
  ScrollArea,
  SegmentedControl,
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
import { ConsoleFrame } from './components/ConsoleFrame';
import { RealTimeProcessing, type RtLiveStatus } from './components/RealTimeProcessing';
import { qualityColor, qualityLabel, qualityTextColor } from './utils/quality';
import { STATUS_COLOR } from './utils/status';
import { StatusBadge } from './components/common/StatusBadge';
import { ConversionPanel } from './components/ConversionPanel';
import { StreamPathHelp } from './components/StreamPathHelp';
import { ClasPipelinePanel } from './components/ClasPipelinePanel';
import { StreamMonitorPanel } from './components/StreamMonitorPanel';
import { MaskedPathInput } from './components/common/MaskedPathInput';
import { maskLogLine } from './utils/maskPath';
import { randomUUID } from './utils/uuid';
import { GnssTimeConverter } from './components/tools/GnssTimeConverter';
import { DataDownloader } from './components/tools/DataDownloader';
import { ToolsSidebar } from './components/tools/ToolsSidebar';
import { TraceLogView } from './components/common/TraceLogView';
import { AiSettingsPanel } from './components/tools/AiSettingsPanel';
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
import { generateRelayArgs, parseRelayArgs } from './utils/streamArgs';
import { FONT_SIZE, MONO } from './utils/typography';
import { FormRow } from './components/common/FormRow';
import { StreamCardHeader } from './components/common/StreamCardHeader';
import { FORM_LABEL_GAP, MIN_PANEL_HEIGHT, SCREEN_HEIGHT } from './utils/formLayout';
import { useElementSize } from '@mantine/hooks';

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
  /** The config writes the CLAS L6 source into the GGA station id. */
  clasSource: boolean;
  onClearLog: () => void;
}

function PostProcessingRightPanel({
  processStatus,
  progress,
  logLines,
  outputFile,
  clasSource,
  onClearLog,
}: PostProcessingRightPanelProps) {
  const [rightTab, setRightTab] = useState<string | null>('chart');
  const [refreshKey, setRefreshKey] = useState(0);
  const consoleViewportRef = useRef<HTMLDivElement>(null);
  const [prevStatus, setPrevStatus] = useState(processStatus);
  const { ref: contentRef, height: contentAreaHeight } = useElementSize();

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
  if (prevStatus !== processStatus) {
    setPrevStatus(processStatus);
    if (prevStatus === 'running' && processStatus === 'success') {
      setRefreshKey((k) => k + 1);
    }
  }

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
                <Badge size="sm" color={qualityColor(progress.quality)}>
                  {qualityLabel(progress.quality).toUpperCase()}
                </Badge>
                <Text size="xs" ff="monospace" style={{ fontSize: FONT_SIZE.label }}>
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
            <StatusBadge tone="ok">Complete</StatusBadge>
            <Code style={{ fontSize: FONT_SIZE.label }}>{outputFile}</Code>
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
          <StatusBadge tone="error">Error</StatusBadge>
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

  const contentHeight = Math.max(MIN_PANEL_HEIGHT, contentAreaHeight);

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
              style={{ fontSize: FONT_SIZE.label, padding: '6px 10px' }}
            >
              Chart
            </Tabs.Tab>
            <Tabs.Tab
              value="solution"
              leftSection={<IconFileText size={13} />}
              style={{ fontSize: FONT_SIZE.label, padding: '6px 10px' }}
            >
              Solution
            </Tabs.Tab>
            <Tabs.Tab
              value="console"
              leftSection={<IconTerminal2 size={13} />}
              style={{ fontSize: FONT_SIZE.label, padding: '6px 10px' }}
            >
              Console
            </Tabs.Tab>
            <Tabs.Tab
              value="trace"
              leftSection={<IconBug size={13} />}
              style={{ fontSize: FONT_SIZE.label, padding: '6px 10px' }}
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
        <div ref={contentRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Tabs.Panel value="chart">
          <ResultViewer
            filePath={outputFile}
            maxHeight={contentHeight}
            refreshKey={refreshKey}
            clasSource={clasSource}
          />
        </Tabs.Panel>

        {/* Solution tab */}
        <Tabs.Panel value="solution">
          <SolutionView
            outputFile={outputFile}
            refreshKey={refreshKey}
            maxHeight={contentHeight}
          />
        </Tabs.Panel>

        {/* Console tab */}
        <Tabs.Panel value="console">
          <ScrollArea
            h={contentHeight}
            viewportRef={consoleViewportRef}
            styles={{ viewport: { backgroundColor: 'var(--app-console-bg)', padding: '8px 12px' } }}
          >
            {logLines.length === 0 ? (
              <Text size="xs" c="dimmed" fs="italic" style={{ fontFamily: MONO, fontSize: FONT_SIZE.label }}>
                Waiting for output...
              </Text>
            ) : (
              logLines.map((line, index) => (
                <Text
                  key={index}
                  size="xs"
                  c="var(--app-console-fg)"
                  style={{
                    fontFamily: MONO,
                    fontSize: FONT_SIZE.label,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {maskLogLine(line)}
                </Text>
              ))
            )}
          </ScrollArea>
        </Tabs.Panel>

        {/* Trace tab */}
        <Tabs.Panel value="trace">
          <SolutionView
            outputFile={outputFile ? outputFile + '.trace' : ''}
            refreshKey={refreshKey}
            maxHeight={contentHeight}
            fromEnd
            noun="trace file"
            searchable
          />
        </Tabs.Panel>
        </div>
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

// Lines fetched for the Solution / Trace views.
const VIEW_MAX_LINES = 5000;

/** Displays a text output file (solution or trace) in a scrollable monospace
 *  block. `fromEnd` shows the last lines instead of the first; `searchable`
 *  adds a search / filter toolbar over the loaded lines. */
function SolutionView({
  outputFile,
  refreshKey,
  maxHeight,
  fromEnd = false,
  noun = 'solution file',
  searchable = false,
}: {
  outputFile: string;
  refreshKey: number;
  maxHeight: number;
  fromEnd?: boolean;
  noun?: string;
  searchable?: boolean;
}) {
  // `path` is the server-resolved path (a relative entry resolves under /workspace).
  const [loaded, setContent] = useState<{ path: string; content: string; returned: number; total: number } | null>(null);
  const loadedContent = loaded?.content ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const content = outputFile ? loadedContent : null;
  // Split once per load, so the search toolbar does not rescan on every render.
  const lines = useMemo(() => (content ? content.replace(/\n$/, '').split('\n') : []), [content]);

  // Enter the loading state while rendering, not from the fetch effect
  const loadKey = `${refreshKey}:${outputFile}`;
  const [startedLoadKey, setStartedLoadKey] = useState<string | null>(null);
  if (!outputFile) {
    // A fetch cancelled by clearing the path never clears these itself
    if (startedLoadKey !== null) {
      setStartedLoadKey(null);
      setLoading(false);
      setError(null);
    }
  } else if (startedLoadKey !== loadKey) {
    setStartedLoadKey(loadKey);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    if (!outputFile) return;
    let cancelled = false;

    const params = new URLSearchParams({ path: outputFile, max_lines: String(VIEW_MAX_LINES) });
    if (fromEnd) params.set('from_end', 'true');
    fetch(`/api/files/read?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setContent({
            path: data.path || outputFile,
            content: data.content || '',
            returned: data.returned_lines ?? 0,
            total: data.total_lines ?? 0,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [outputFile, refreshKey, fromEnd]);

  // Auto-scroll to bottom on content change
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight });
    }
  }, [content]);

  const consoleBg = 'var(--app-console-bg)';

  if (loading) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs" style={{ backgroundColor: consoleBg }}>
        <Text size="xs" c="dimmed" style={{ fontFamily: MONO }}>Loading {noun}...</Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs" style={{ backgroundColor: consoleBg }}>
        <Text size="xs" c="dimmed" fs="italic" style={{ fontFamily: MONO }}>{error}</Text>
      </Stack>
    );
  }

  if (!content) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs" style={{ backgroundColor: consoleBg }}>
        <Text size="xs" c="dimmed" fs="italic" style={{ fontFamily: MONO }}>No {noun} to display</Text>
      </Stack>
    );
  }

  // Only part of a long file is shown: say which part, and offer the whole file.
  const partial = loaded && loaded.returned < loaded.total;
  const NOTE_H = 24;

  return (
    <>
      {partial && (
        <Group gap={6} wrap="nowrap" px={12} h={NOTE_H} style={{ backgroundColor: consoleBg }}>
          <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: FONT_SIZE.label }} truncate>
            Showing the {fromEnd ? 'last' : 'first'} {loaded.returned.toLocaleString()} of{' '}
            {loaded.total.toLocaleString()} lines{searchable ? ' (search covers these only)' : ''}
          </Text>
          {loaded.path.startsWith('/workspace/') && (
            <Button
              variant="light"
              leftSection={<IconDownload size={12} />}
              size="compact-xs"
              component="a"
              href={`/api/files/download?path=${encodeURIComponent(loaded.path)}`}
              download
              style={{ flexShrink: 0 }}
            >
              Download
            </Button>
          )}
        </Group>
      )}
      {searchable ? (
        <TraceLogView
          lines={lines}
          height={partial ? maxHeight - NOTE_H : maxHeight}
          viewportRef={viewportRef}
        />
      ) : (
        <ScrollArea
          h={partial ? maxHeight - NOTE_H : maxHeight}
          viewportRef={viewportRef}
          styles={{ viewport: { backgroundColor: consoleBg, padding: '8px 12px' } }}
        >
          <Text
            c="var(--app-console-fg)"
            style={{
              fontFamily: MONO,
              whiteSpace: 'pre',
              fontSize: FONT_SIZE.label,
              lineHeight: 1.5,
            }}
          >
            {content}
          </Text>
        </ScrollArea>
      )}
    </>
  );
}

function PostProcessingPanel({ onNavigateToAiSettings, aiConfigured, configOpen = true, onToggleConfig }: { onNavigateToAiSettings?: () => void; aiConfigured?: boolean; configOpen?: boolean; onToggleConfig?: () => void }) {
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
    // Forget the previous job first: until the new id arrives, the status
    // poll must not run against the old one (its 404 would end this run).
    jobIdRef.current = null;
    setJobId(null);
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
        config: backendConfig as unknown as MrtkPostConfig,
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
    // Responses that arrive after this effect was cleaned up (job changed or
    // finished) belong to an old poll and must not touch the current run.
    let cancelled = false;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/mrtk-post/status/${jobId}`);
        if (cancelled) return;
        if (res.status === 404) {
          // The server no longer knows this job (backend restarted, or its
          // result was pruned): stop waiting instead of polling forever.
          setProcessStatus('idle');
          setIsLoading(false);
          setLogLines((prev) => [
            ...prev,
            '[WARN] Job status is no longer available on the server (restarted or expired); check the output file.',
          ]);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
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

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [processStatus, jobId]);

  const handleStop = () => {
    setProcessStatus('idle');
    jobIdRef.current = null;
    setLogLines((prev) => [...prev, '[INFO] Process stopped by user']);
    setIsLoading(false);
  };

  return (
    <>
    <ConsoleFrame
      configOpen={configOpen}
      onToggleConfig={onToggleConfig ?? (() => {})}
      config={
        <Stack gap="xs" h="100%">
          <PostProcessingConfiguration
            onConfigChange={setConfig}
            onNavigateToAiSettings={onNavigateToAiSettings}
            aiConfigured={aiConfigured}
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
            onCollapse={onToggleConfig}
          />

          {/* Error Display */}
          {error && (
            <Alert color="red" icon={<IconInfoCircle size={14} />} p="xs" withCloseButton onClose={() => setError(null)}>
              <Text size="xs">{error}</Text>
            </Alert>
          )}
        </Stack>
      }
      workspace={
        <PostProcessingRightPanel
          processStatus={processStatus}
          progress={progress}
          logLines={logLines}
          outputFile={outputFile}
          clasSource={config.positioning.positioningMode === 'ppp-rtk' && config.output.clasNmeaSourceId}
          onClearLog={() => setLogLines([])}
        />
      }
    />

    <ObsViewerModal
      opened={qcModalOpened}
      onClose={() => setQcModalOpened(false)}
      obsFile={roverFile}
      navFile={navFile || undefined}
    />
    </>
  );
}

// --- Stream Relay: Multi-Stream ---

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

const MAX_RELAY_LOG_LINES = 500;

const RELAY_STATE_TO_STATUS: Record<string, RelayStream['status']> = {
  idle: 'idle', starting: 'running', running: 'running',
  stopping: 'running', stopped: 'idle', error: 'error',
};

function newRelayStream(name: string): RelayStream {
  return {
    id: randomUUID(),
    name,
    status: 'idle',
    processId: null,
    input: { ...DEFAULT_SS_INPUT, id: randomUUID() },
    outputs: [{ ...DEFAULT_SS_OUTPUT, id: randomUUID() }],
    logLines: [],
  };
}

/** The single default stream a fresh page starts with, not yet used or edited */
function isPristineRelayStream(s: RelayStream): boolean {
  return s.status === 'idle' && !s.processId && s.logLines.length === 0
    && s.input.type === DEFAULT_SS_INPUT.type && s.input.path === DEFAULT_SS_INPUT.path
    && s.outputs.length === 1
    && s.outputs[0].type === DEFAULT_SS_OUTPUT.type && s.outputs[0].path === DEFAULT_SS_OUTPUT.path;
}

/** Rebuild a stream card for a relay the backend runs but this page did not start */
function adoptRelayStream(r: mrtkRelayApi.RelayStreamInfo): RelayStream {
  const { input, outputs = [] } = parseRelayArgs(r.args);
  return {
    id: randomUUID(),
    name: r.name,
    status: RELAY_STATE_TO_STATUS[r.state] ?? 'idle',
    processId: r.id,
    input: input ? { ...input, id: randomUUID() } : { ...DEFAULT_SS_INPUT, id: randomUUID() },
    outputs: outputs.map((o) => ({ ...o, id: randomUUID() })),
    logLines: r.log.slice(-MAX_RELAY_LOG_LINES),
  };
}

/**
 * Bring the stream list in line with the backend after a page load or a
 * WebSocket reconnect: refresh state and log of the streams this page knows,
 * and adopt the running relays it does not, so they can be monitored and stopped.
 */
function reconcileRelayStreams(
  prev: RelayStream[],
  remote: mrtkRelayApi.RelayStreamInfo[],
  changedSince: Set<string>,
): RelayStream[] {
  // Relays this page started or stopped after the list was requested are
  // newer here than in the list: leave them alone, and never re-adopt them
  remote = remote.filter((r) => !changedSince.has(r.id));
  const byId = new Map(remote.map((r) => [r.id, r]));
  let next = prev.map((s) => {
    if (!s.processId || changedSince.has(s.processId)) return s;
    const r = byId.get(s.processId);
    if (!r) return { ...s, status: 'idle' as const, processId: null };
    const status = RELAY_STATE_TO_STATUS[r.state] ?? 'idle';
    return {
      ...s,
      status,
      processId: status === 'idle' ? null : s.processId,
      logLines: r.log.length > 0 ? r.log.slice(-MAX_RELAY_LOG_LINES) : s.logLines,
    };
  });
  const known = new Set(prev.map((s) => s.processId));
  const adopted = remote
    .filter((r) => !known.has(r.id) && RELAY_STATE_TO_STATUS[r.state] === 'running')
    .map(adoptRelayStream);
  if (adopted.length === 0) return next;
  if (next.length === 1 && isPristineRelayStream(next[0])) next = [];
  return [...next, ...adopted];
}

/** A password still masked as *** (e.g. in an adopted stream) cannot be sent */
function hasMaskedPassword(stream: RelayStream): boolean {
  return [stream.input, ...stream.outputs].some((c) => /^[^:@/]*:\*\*\*@/.test(c.path));
}

function MultiStreamPanel() {
  const [streams, setStreams] = useState<RelayStream[]>(() => [newRelayStream('Stream 1')]);
  const [selectedStreamId, setActiveStreamId] = useState<string>(streams[0].id);
  // Adopting relays may replace the selected stream; fall back to the first
  const activeStreamId = streams.some((s) => s.id === selectedStreamId) ? selectedStreamId : streams[0].id;
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // When this page last started or stopped each relay, or saw it stop over
  // the WebSocket (performance.now()): a list requested earlier is older
  const localChangeAtRef = useRef<Map<string, number>>(new Map());

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
      // Record a stop even for a relay not mapped yet (fresh page, list still
      // in flight), so the older list cannot re-adopt it as running
      if (message.type === 'status' && message.status
          && RELAY_STATE_TO_STATUS[message.status] !== 'running') {
        localChangeAtRef.current.set(message.process_id, performance.now());
      }
      const streamId = processMapRef.current.get(message.process_id);
      if (!streamId) return;

      if (message.type === 'log' && message.message) {
        setStreams((prev) => prev.map((s) =>
          s.id === streamId ? { ...s, logLines: [...s.logLines.slice(-(MAX_RELAY_LOG_LINES - 1)), message.message!] } : s
        ));
      }
      if (message.type === 'status' && message.status) {
        const newStatus = RELAY_STATE_TO_STATUS[message.status] || 'idle';
        setStreams((prev) => prev.map((s) =>
          s.id === streamId ? { ...s, status: newStatus, processId: newStatus === 'idle' ? null : s.processId } : s
        ));
      }
    }, []),
    // Runs on the first connect and on every reconnect: pick up relays that
    // kept running across a page reload or a dropped connection (#52)
    onConnect: useCallback(() => {
      const requestedAt = performance.now();
      mrtkRelayApi.listStreams()
        .then((remote) => {
          const changedSince = new Set<string>();
          for (const [pid, at] of localChangeAtRef.current) {
            if (at >= requestedAt) changedSince.add(pid);
          }
          setStreams((prev) => reconcileRelayStreams(prev, remote, changedSince));
        })
        .catch(() => { /* keep the current view; the next reconnect retries */ });
    }, []),
    onDisconnect: useCallback(() => {}, []),
  });

  // Helpers to update a single stream
  const updateStream = useCallback((id: string, patch: Partial<RelayStream>) => {
    setStreams((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }, []);

  const handleAddStream = () => {
    if (streams.length >= 4) return;
    const newStream = newRelayStream(`Stream ${streams.length + 1}`);
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
    if (hasMaskedPassword(stream)) {
      updateStream(id, { status: 'error', logLines: [...stream.logLines, '[ERROR] Re-enter the password (shown as ***) before starting'] });
      return;
    }

    setLoadingIds((prev) => new Set(prev).add(id));
    try {
      const args = buildArgs(stream);
      const result = await mrtkRelayApi.startRelay({ args, name: stream.name });
      localChangeAtRef.current.set(result.id, performance.now());
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
      localChangeAtRef.current.set(stream.processId, performance.now());
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
        outputs: [...s.outputs, { ...DEFAULT_SS_OUTPUT, id: randomUUID() }],
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
      case 'running': return STATUS_COLOR.ok;
      case 'error': return STATUS_COLOR.error;
      default: return STATUS_COLOR.off;
    }
  };

  const handleCopyLog = useCallback(() => {
    if (activeStream) navigator.clipboard.writeText(activeStream.logLines.join('\n'));
  }, [activeStream]);

  const handleClearLog = useCallback(() => {
    if (activeStreamId) updateStream(activeStreamId, { logLines: [] });
  }, [activeStreamId, updateStream]);

  const runningCount = streams.filter((s) => s.status === 'running').length;

  return (
    <Grid gutter="md" overflow="hidden" h={{ base: 'auto', md: '100%' }} styles={{ inner: { height: 'calc(100% + var(--mantine-spacing-md))' } }}>
      {/* Left Pane: Stream Cards */}
      <Grid.Col span={{ base: 12, md: 6 }} h={{ base: 'auto', md: '100%' }}>
        <Card withBorder p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <Group justify="space-between" mb="xs">
            <Title order={5} size="sm">Streams</Title>
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
                    <StreamCardHeader
                      name={stream.name}
                      dotColor={statusDotColor(stream.status)}
                      tone={stream.status === 'running' ? 'ok' : stream.status === 'error' ? 'error' : 'off'}
                      status={stream.status === 'running' ? 'Running' : stream.status === 'error' ? 'Error' : 'Idle'}
                      running={stream.status === 'running'}
                      loading={loadingIds.has(stream.id)}
                      removeDisabled={streams.length <= 1 || stream.status === 'running'}
                      onStart={() => handleStartStream(stream.id)}
                      onStop={() => handleStopStream(stream.id)}
                      onRemove={() => handleRemoveStream(stream.id)}
                    />


                    {/* Input */}
                    <FormRow label={<Group gap={4} wrap="nowrap">Input<StreamPathHelp /></Group>}>
                      <Group gap={FORM_LABEL_GAP} wrap="nowrap">
                        <Select
                          value={stream.input.type}
                          onChange={(v) => handleInputTypeChange(stream.id, v as StreamType)}
                          data={STREAM_TYPE_OPTIONS}
                          style={{ width: 120, flexShrink: 0 }}
                        />
                        <MaskedPathInput
                          value={stream.input.path}
                          onChange={(v) => handleInputPathChange(stream.id, v)}
                          placeholder={PATH_PLACEHOLDER_FOR_TYPE[stream.input.type]}
                          styles={{ input: { fontFamily: MONO } }}
                          style={{ flex: 1, minWidth: 0 }}
                        />
                      </Group>
                    </FormRow>

                    {/* Outputs */}
                    <FormRow
                      label={<Group gap={4} wrap="nowrap">Outputs<StreamPathHelp /></Group>}
                      align="flex-start"
                      trailing={<ActionIcon variant="light" color="blue" size="xs" onClick={() => handleAddOutput(stream.id)}> <IconPlus size={10} /> </ActionIcon>}
                    >
                      <Stack gap={6}>
                        {stream.outputs.map((output) => (
                          <Group key={output.id} gap={FORM_LABEL_GAP} wrap="nowrap">
                            <Select
                              value={output.type}
                              onChange={(v) => handleOutputTypeChange(stream.id, output.id, v as StreamType)}
                              data={STREAM_TYPE_OPTIONS}
                              style={{ width: 120, flexShrink: 0 }}
                            />
                            <MaskedPathInput
                              value={output.path}
                              onChange={(v) => handleOutputPathChange(stream.id, output.id, v)}
                              placeholder={PATH_PLACEHOLDER_FOR_TYPE[output.type]}
                              styles={{ input: { fontFamily: MONO } }}
                              style={{ flex: 1, minWidth: 0 }}
                            />
                            <ActionIcon variant="subtle" color="red" size="xs" onClick={() => handleRemoveOutput(stream.id, output.id)} disabled={stream.outputs.length <= 1} style={{ flexShrink: 0 }} > <IconTrash size={10} /> </ActionIcon>
                          </Group>
                        ))}
                      </Stack>
                    </FormRow>
                  </Stack>
                </Card>
              ))}
            </Stack>
          </ScrollArea>
        </Card>
      </Grid.Col>

      {/* Right Pane: Console */}
      <Grid.Col span={{ base: 12, md: 6 }} h={{ base: 'auto', md: '100%' }}>
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
                    style={{ fontSize: FONT_SIZE.label, padding: '6px 10px' }}
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
                <ScrollArea
                  h="100%"
                  viewportRef={stream.id === activeStreamId ? consoleViewportRef : undefined}
                  styles={{ viewport: { backgroundColor: 'var(--app-console-bg)', padding: '8px 12px' } }}
                >
                  {stream.logLines.length === 0 ? (
                    <Text size="xs" c="dimmed" fs="italic" style={{ fontFamily: MONO, fontSize: FONT_SIZE.label }}>
                      Waiting for output...
                    </Text>
                  ) : (
                    stream.logLines.map((line, index) => (
                      <Text
                        key={index}
                        size="xs"
                        c="var(--app-console-fg)"
                        style={{
                          fontFamily: MONO,
                          fontSize: FONT_SIZE.label,
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {maskLogLine(line)}
                      </Text>
                    ))
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

function StreamRelayView() {
  const [mode, setMode] = useState<string | null>('multi-stream');
  return (
    <Stack gap="sm" h={SCREEN_HEIGHT}>
      <Tabs value={mode} onChange={setMode}>
        <Tabs.List>
          <Tabs.Tab value="multi-stream">Multi-Stream</Tabs.Tab>
          <Tabs.Tab value="clas">CLAS Pipeline</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <div style={{ display: mode === 'multi-stream' ? undefined : 'none', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <MultiStreamPanel />
      </div>
      <div style={{ display: mode === 'clas' ? undefined : 'none', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <ClasPipelinePanel />
      </div>
    </Stack>
  );
}

function RealTimePanel({ onNavigateToAiSettings, aiConfigured, configOpen, onToggleConfig, onLiveStatus }: { onNavigateToAiSettings?: () => void; aiConfigured?: boolean; configOpen?: boolean; onToggleConfig?: () => void; onLiveStatus?: (s: RtLiveStatus | null) => void }) {
  return <RealTimeProcessing onNavigateToAiSettings={onNavigateToAiSettings} aiConfigured={aiConfigured} configOpen={configOpen} onToggleConfig={onToggleConfig} onLiveStatus={onLiveStatus} />;
}

// ConversionPanel is now imported from ./components/ConversionPanel

// Primary modes live in the header SegmentedControl; the remaining screens move
// to a secondary "More" menu (console redesign Phase 2).
const PRIMARY_MODES = [
  { value: 'realtime', label: 'Real-time' },
  { value: 'post-processing', label: 'Post-processing' },
] as const;

const SECONDARY_VIEWS = [
  { value: 'stream-relay', label: 'Stream Relay' },
  { value: 'stream-monitor', label: 'Stream Monitor' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'tools', label: 'Tools' },
] as const;


/** Bottom status bar (console redesign Phase 2/4). Shows live RT solution
 *  values when a Real-time session is producing them; dashes otherwise. */
function StatusBar({ activeTab, mrtkVersion, rtStatus }: { activeTab: string; mrtkVersion: string; rtStatus: RtLiveStatus | null }) {
  const modeLabel =
    activeTab === 'realtime' ? 'real-time' :
    activeTab === 'post-processing' ? 'post-proc' :
    (SECONDARY_VIEWS.find((v) => v.value === activeTab)?.label.toLowerCase() ?? activeTab);

  const cell = { fontFamily: MONO, fontSize: FONT_SIZE.label } as const;
  const sat = rtStatus
    ? (rtStatus.satsVisible > 0 ? `${rtStatus.ns}/${rtStatus.satsVisible}` : `${rtStatus.ns}`)
    : '—/—';

  return (
    <Group
      h="100%"
      px="md"
      gap={18}
      wrap="nowrap"
      style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, color: 'var(--mantine-color-dimmed)', overflow: 'hidden' }}
    >
      {rtStatus ? (
        <Text span style={{ ...cell, color: qualityTextColor(rtStatus.quality), fontWeight: 600 }}>
          ● {qualityLabel(rtStatus.quality).toUpperCase()}
        </Text>
      ) : (
        <Text span style={{ ...cell, color: STATUS_COLOR.off }}>● —</Text>
      )}
      <Text span style={cell}>Sat {sat}</Text>
      <Text span style={cell}>ratio {rtStatus ? rtStatus.ratio.toFixed(1) : '—'}</Text>
      <Text span style={cell}>age {rtStatus ? `${rtStatus.age.toFixed(1)}s` : '—'}</Text>
      <Text span style={cell}>mode: {modeLabel}</Text>
      {mrtkVersion && (
        <Text span visibleFrom="md" style={cell}>MRTKLIB {mrtkVersion}</Text>
      )}
      <Text span ml="auto" style={{ ...cell, whiteSpace: 'nowrap' }}>
        {rtStatus
          ? `N ${rtStatus.lat.toFixed(5)}  E ${rtStatus.lon.toFixed(5)}  H ${rtStatus.height.toFixed(1)} m`
          : 'N —  E —  H — m'}
      </Text>
    </Group>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<string | null>('realtime');
  const [configOpen, setConfigOpen] = useState(true);
  const toggleConfig = useCallback(() => setConfigOpen((o) => !o), []);
  const [rtStatus, setRtStatus] = useState<RtLiveStatus | null>(null);
  const handleRtStatus = useCallback((s: RtLiveStatus | null) => setRtStatus(s), []);
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [mrtkVersion, setMrtkVersion] = useState<string>('');
  const [selectedTool, setSelectedTool] = useState('time-converter');

  // Lifted AI configuration state — shared across sidebar, PP, RT, and settings panel
  const [aiConfigured, setAiConfigured] = useState(false);
  const refreshAiConfigured = useCallback(() => {
    fetch('/api/ai/settings')
      .then((r) => r.json())
      .then((data) => setAiConfigured(Boolean(data.configured)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshAiConfigured();
  }, [refreshAiConfigured]);

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

  // Header navigation state (console redesign Phase 2)
  const isPrimaryMode = activeTab === 'realtime' || activeTab === 'post-processing';
  const primaryMode = isPrimaryMode ? (activeTab as string) : '';

  return (
    <AppShell header={{ height: 52 }} footer={{ height: 30 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          {/* Brand + primary mode switch */}
          <Group gap="md" wrap="nowrap">
            <Group gap={9} wrap="nowrap">
              <IconSatellite size={22} />
              {/* Name only from md: below it the header buttons need the room. */}
              <Text fw={600} size="sm" visibleFrom="md" style={{ whiteSpace: 'nowrap' }}>
                MRTKLIB Console
              </Text>
            </Group>
            <SegmentedControl
              size="xs"
              visibleFrom="sm"
              value={primaryMode}
              onChange={setActiveTab}
              data={PRIMARY_MODES as unknown as { value: string; label: string }[]}
              styles={{ label: { fontWeight: 600, paddingLeft: 15, paddingRight: 15 } }}
            />
          </Group>

          {/* Secondary views (flat, right-aligned) + status + theme */}
          <Group gap="sm" wrap="nowrap">
            <Group gap={2} wrap="nowrap" visibleFrom="sm">
              {SECONDARY_VIEWS.map((v) => {
                const active = activeTab === v.value;
                return (
                  <Button
                    key={v.value}
                    size="xs"
                    variant={active ? 'light' : 'subtle'}
                    color={active ? 'blue' : 'gray'}
                    onClick={() => setActiveTab(v.value)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {v.label}
                  </Button>
                );
              })}
            </Group>
            <Badge
              color={STATUS_COLOR[healthStatus === 'ok' ? 'ok' : healthStatus === 'error' ? 'error' : 'off']}
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
            <Tabs.Tab value="stream-relay">Relay</Tabs.Tab>
            <Tabs.Tab value="stream-monitor">Monitor</Tabs.Tab>
            <Tabs.Tab value="conversion">Convert</Tabs.Tab>
            <Tabs.Tab value="tools">Tools</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {/* Tab Content - keep all panels mounted to preserve state */}
        <div style={{ display: activeTab === 'post-processing' ? undefined : 'none' }}>
          <PostProcessingPanel aiConfigured={aiConfigured} onNavigateToAiSettings={() => { setActiveTab('tools'); setSelectedTool('ai-settings'); }} configOpen={configOpen} onToggleConfig={toggleConfig} />
        </div>
        <div style={{ display: activeTab === 'realtime' ? undefined : 'none' }}>
          <RealTimePanel aiConfigured={aiConfigured} onNavigateToAiSettings={() => { setActiveTab('tools'); setSelectedTool('ai-settings'); }} configOpen={configOpen} onToggleConfig={toggleConfig} onLiveStatus={handleRtStatus} />
        </div>
        <div style={{ display: activeTab === 'stream-relay' ? undefined : 'none' }}>
          <StreamRelayView />
        </div>
        <div style={{ display: activeTab === 'stream-monitor' ? undefined : 'none' }}>
          <StreamMonitorPanel configOpen={configOpen} onToggleConfig={toggleConfig} />
        </div>
        <div style={{ display: activeTab === 'conversion' ? undefined : 'none' }}>
          <ConversionPanel />
        </div>
        <div style={{ display: activeTab === 'tools' ? 'flex' : 'none', width: '100%', height: SCREEN_HEIGHT, overflow: 'hidden', border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)', background: 'var(--mantine-color-default)' }}>
          <div style={{ width: 160, flexShrink: 0, borderRight: '1px solid var(--mantine-color-default-border)', overflowY: 'auto' }}>
            <ToolsSidebar selected={selectedTool} onSelect={setSelectedTool} aiConfigured={aiConfigured} />
          </div>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '1.5rem 2rem' }}>
            {selectedTool === 'time-converter' && <GnssTimeConverter />}
            {selectedTool === 'downloader' && <DataDownloader />}
            {selectedTool === 'ai-settings' && <AiSettingsPanel onSettingsSaved={refreshAiConfigured} />}
          </div>
        </div>
      </AppShell.Main>

      <AppShell.Footer>
        <StatusBar activeTab={activeTab ?? ''} mrtkVersion={mrtkVersion} rtStatus={rtStatus} />
      </AppShell.Footer>
    </AppShell>
  );
}

export default App;
