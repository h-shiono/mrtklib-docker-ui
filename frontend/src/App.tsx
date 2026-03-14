import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AppShell,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
  ActionIcon,
  Badge,
  Checkbox,
  Code,
  NumberInput,
  Tooltip,
  Alert,
  SimpleGrid,
} from '@mantine/core';
import {
  IconSun,
  IconMoon,
  IconSatellite,
  IconPlayerPlay,
  IconPlayerStop,
  IconFile,
  IconRefresh,
  IconDownload,
  IconPlugConnected,
  IconPlugConnectedX,
  IconTestPipe,
  IconInfoCircle,
  IconFolderOpen,
  IconChartBar,
} from '@tabler/icons-react';
import { TerminalOutput, StatusIndicator, StreamConfiguration, PostProcessingConfiguration, FileBrowserModal, TabbedTerminalOutput } from './components';
import { ObsViewerModal } from './components/obsViewer';
import type { ProcessStatus } from './components';
import { useWebSocket } from './hooks';
import type { LogMessage } from './hooks';
import * as mrtkRelayApi from './api/mrtkRelay';
import * as mrtkPostApi from './api/mrtkPost';
import type { MrtkPostConfig } from './types/mrtkPostConfig';
import { DEFAULT_MRTK_POST_CONFIG } from './types/mrtkPostConfig';

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

function PostProcessingPanel() {
  const [roverFile, setRoverFile] = useState('/workspace/rover.obs');
  const [baseFile, setBaseFile] = useState('');
  const [navFile, setNavFile] = useState('/workspace/nav.nav');
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
  const [fileBrowserOpened, setFileBrowserOpened] = useState(false);
  const [qcModalOpened, setQcModalOpened] = useState(false);
  const fileBrowserCallbackRef = useRef<((path: string) => void) | null>(null);
  const [progress, setProgress] = useState<{
    epoch: string;
    quality: number;
    ns: number | null;
    ratio: number | null;
  } | null>(null);

  // Use ref for jobId to avoid WebSocket reconnection when jobId changes
  // Updated synchronously in handleStart (not via useEffect) to avoid timing gaps
  const jobIdRef = useRef<string | null>(null);

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
  const buildBackendConfig = useCallback(() => {
    const p = config.positioning;
    const ar = config.ambiguityResolution;
    const kf = config.kalmanFilter;
    const ant = config.antenna;
    return {
      positioning: {
        positioning_mode: p.positioningMode,
        frequency: p.frequency,
        signal_mode: p.signalMode,
        signals: p.signals,
        filter_type: p.filterType,
        elevation_mask: p.elevationMask,
        receiver_dynamics: p.receiverDynamics,
        ephemeris_option: p.ephemerisOption,
        constellations: p.constellations,
        excluded_satellites: p.excludedSatellites,
        snr_mask: {
          enable_rover: p.snrMask.enableRover,
          enable_base: p.snrMask.enableBase,
          mask: p.snrMask.mask,
        },
        satellite_pcv: p.satellitePcv,
        receiver_pcv: p.receiverPcv,
        phase_windup: p.phaseWindup,
        reject_eclipse: p.rejectEclipse,
        raim_fde: p.raimFde,
        earth_tides_correction: p.earthTidesCorrection,
        ionosphere_correction: p.ionosphereCorrection,
        troposphere_correction: p.troposphereCorrection,
        clas: {
          grid_selection_radius: p.clas.gridSelectionRadius,
          receiver_type: p.clas.receiverType,
          position_uncertainty_x: p.clas.positionUncertaintyX,
          position_uncertainty_y: p.clas.positionUncertaintyY,
          position_uncertainty_z: p.clas.positionUncertaintyZ,
        },
      },
      ambiguity_resolution: {
        mode: ar.mode,
        ratio: ar.ratio,
        elevation_mask: ar.elevationMask,
        hold_elevation: ar.holdElevation,
        lock_count: ar.lockCount,
        min_fix: ar.minFix,
        max_iterations: ar.maxIterations,
        out_count: ar.outCount,
      },
      rejection: {
        innovation: config.rejection.innovation,
        gdop: config.rejection.gdop,
      },
      slip_detection: {
        threshold: config.slipDetection.threshold,
      },
      kalman_filter: {
        iterations: kf.iterations,
        sync_solution: kf.syncSolution,
        measurement_error: {
          code_phase_ratio_l1: kf.measurementError.codePhaseRatioL1,
          code_phase_ratio_l2: kf.measurementError.codePhaseRatioL2,
          phase: kf.measurementError.phase,
          phase_elevation: kf.measurementError.phaseElevation,
          phase_baseline: kf.measurementError.phaseBaseline,
          doppler: kf.measurementError.doppler,
        },
        process_noise: {
          bias: kf.processNoise.bias,
          ionosphere: kf.processNoise.ionosphere,
          troposphere: kf.processNoise.troposphere,
          accel_h: kf.processNoise.accelH,
          accel_v: kf.processNoise.accelV,
          clock_stability: kf.processNoise.clockStability,
        },
      },
      antenna: {
        rover: {
          mode: ant.rover.mode,
          values: ant.rover.values,
          antenna_type_enabled: ant.rover.antennaTypeEnabled,
          antenna_type: ant.rover.antennaType,
          antenna_delta: ant.rover.antennaDelta,
        },
        base: {
          mode: ant.base.mode,
          values: ant.base.values,
          antenna_type_enabled: ant.base.antennaTypeEnabled,
          antenna_type: ant.base.antennaType,
          antenna_delta: ant.base.antennaDelta,
        },
      },
      output: {
        solution_format: config.output.solutionFormat,
        output_header: config.output.outputHeader,
        output_processing_options: config.output.outputProcessingOptions,
        time_format: config.output.timeFormat,
        num_decimals: config.output.numDecimals,
        lat_lon_format: config.output.latLonFormat,
        field_separator: config.output.fieldSeparator,
        output_velocity: config.output.outputVelocity,
        datum: config.output.datum,
        height: config.output.height,
        geoid_model: config.output.geoidModel,
        static_solution_mode: config.output.staticSolutionMode,
        output_single_on_outage: config.output.outputSingleOnOutage,
        nmea_interval_rmc_gga: config.output.nmeaIntervalRmcGga,
        nmea_interval_gsa_gsv: config.output.nmeaIntervalGsaGsv,
        output_solution_status: config.output.outputSolutionStatus,
        debug_trace: config.output.debugTrace,
      },
      files: {
        satellite_atx: config.files.satelliteAtx,
        receiver_atx: config.files.receiverAtx,
        station_pos: config.files.stationPos,
        geoid: config.files.geoid,
        ionosphere: config.files.ionosphere,
        dcb: config.files.dcb,
        eop: config.files.eop,
        ocean_loading: config.files.oceanLoading,
        cssr_grid: config.files.cssrGrid,
      },
      server: {
        time_interpolation: config.server.timeInterpolation,
        sbas_satellite: config.server.sbasSatellite,
        rinex_option_1: config.server.rinexOption1,
        rinex_option_2: config.server.rinexOption2,
      },
      receiver: {
        iono_correction: config.receiver.ionoCorrection,
      },
    };
  }, [config]);

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
          {/* Time Range */}
          <Card withBorder p="xs">
            <SimpleGrid cols={3} spacing="xs">
              {/* Start */}
              <div>
                <Checkbox
                  size="xs"
                  label="Time Start (GPST)"
                  checked={config.time.startEnabled}
                  onChange={(e) => setConfig({ ...config, time: { ...config.time, startEnabled: e.currentTarget.checked } })}
                  styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                />
                <Group gap={4} mt={4}>
                  <TextInput
                    size="xs"
                    placeholder="YYYY/MM/DD"
                    value={config.time.startDate}
                    onChange={(e) => setConfig({ ...config, time: { ...config.time, startDate: e.currentTarget.value } })}
                    disabled={!config.time.startEnabled}
                    style={{ flex: 1 }}
                    styles={{ input: { fontSize: '11px', textAlign: 'center' } }}
                  />
                  <TextInput
                    size="xs"
                    placeholder="HH:MM:SS"
                    value={config.time.startTime}
                    onChange={(e) => setConfig({ ...config, time: { ...config.time, startTime: e.currentTarget.value } })}
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
                  onChange={(e) => setConfig({ ...config, time: { ...config.time, endEnabled: e.currentTarget.checked } })}
                  styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                />
                <Group gap={4} mt={4}>
                  <TextInput
                    size="xs"
                    placeholder="YYYY/MM/DD"
                    value={config.time.endDate}
                    onChange={(e) => setConfig({ ...config, time: { ...config.time, endDate: e.currentTarget.value } })}
                    disabled={!config.time.endEnabled}
                    style={{ flex: 1 }}
                    styles={{ input: { fontSize: '11px', textAlign: 'center' } }}
                  />
                  <TextInput
                    size="xs"
                    placeholder="HH:MM:SS"
                    value={config.time.endTime}
                    onChange={(e) => setConfig({ ...config, time: { ...config.time, endTime: e.currentTarget.value } })}
                    disabled={!config.time.endEnabled}
                    style={{ flex: 1 }}
                    styles={{ input: { fontSize: '11px', textAlign: 'center' } }}
                  />
                </Group>
              </div>

              {/* Interval */}
              <div>
                <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Interval</Text>
                <NumberInput
                  size="xs"
                  value={config.time.interval}
                  onChange={(v) => setConfig({ ...config, time: { ...config.time, interval: Number(v) || 0 } })}
                  min={0}
                  step={1}
                  decimalScale={2}
                  suffix=" s"
                  placeholder="0 = all epochs"
                  hideControls
                  styles={{ input: { fontSize: '11px' } }}
                />
              </div>
            </SimpleGrid>
          </Card>

          {/* Execution Inputs */}
          <Card withBorder p="xs">
            <Stack gap="xs">
              <Title order={6} size="xs">Input Files</Title>

              <SimpleGrid cols={2} spacing="xs">
                <div>
                  <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Rover OBS *</Text>
                  <Group gap="xs" wrap="nowrap">
                    <TextInput
                      size="xs"
                      placeholder="/workspace/rover.obs"
                      value={roverFile}
                      onChange={(e) => setRoverFile(e.currentTarget.value)}
                      leftSection={<IconFile size={12} />}
                      style={{ flex: 1 }}
                    />
                    <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(setRoverFile)}>
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
                      onChange={(e) => setNavFile(e.currentTarget.value)}
                      leftSection={<IconFile size={12} />}
                      style={{ flex: 1 }}
                    />
                    <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(setNavFile)}>
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
                      onChange={(e) => setBaseFile(e.currentTarget.value)}
                      leftSection={<IconFile size={12} />}
                      style={{ flex: 1 }}
                      disabled={!needsBase}
                    />
                    <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(setBaseFile)} disabled={!needsBase}>
                      <IconFolderOpen size={16} />
                    </ActionIcon>
                  </Group>
                </div>

              <div>
                <Text size="xs" style={{ fontSize: '10px', marginBottom: '4px' }}>Output *</Text>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    size="xs"
                    placeholder="/workspace/output.pos"
                    value={outputFile}
                    onChange={(e) => setOutputFile(e.currentTarget.value)}
                    leftSection={<IconFile size={12} />}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon variant="filled" color="blue" size="lg" onClick={() => openFileBrowser(setOutputFile)}>
                    <IconFolderOpen size={16} />
                  </ActionIcon>
                </Group>
              </div>

              <Button
                variant="light"
                size="xs"
                leftSection={<IconChartBar size={14} />}
                onClick={() => setQcModalOpened(true)}
                disabled={!roverFile}
              >
                QC Preview
              </Button>
            </Stack>
          </Card>

          {/* Configuration Tabs */}
          <PostProcessingConfiguration onConfigChange={setConfig} />

          {/* Error Display */}
          {error && (
            <Alert color="red" icon={<IconInfoCircle size={14} />} p="xs" withCloseButton onClose={() => setError(null)}>
              <Text size="xs">{error}</Text>
            </Alert>
          )}

          {/* Execute / Export Buttons */}
          <Card withBorder p="xs">
            <Group>
              <Group grow style={{ flex: 1 }}>
                {processStatus === 'running' ? (
                  <Button
                    size="xs"
                    color="red"
                    leftSection={<IconPlayerStop size={12} />}
                    onClick={handleStop}
                    loading={isLoading}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    color="green"
                    leftSection={<IconPlayerPlay size={12} />}
                    onClick={handleStart}
                    loading={isLoading}
                  >
                    Execute
                  </Button>
                )}
              </Group>
              <Tooltip label="Download .conf file">
                <ActionIcon
                  variant="light"
                  color="blue"
                  size="lg"
                  onClick={handleExportConf}
                  disabled={processStatus === 'running'}
                >
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Card>
        </Stack>
      </Grid.Col>

      {/* Right Column: Monitoring */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap="xs" style={{ height: '100%' }}>
          {/* Status Bar */}
          <Card withBorder p="xs">
            <Group justify="space-between">
              <StatusIndicator status={processStatus} />
              <Badge variant="light" color="blue" size="sm">
                rnx2rtkp
              </Badge>
            </Group>
          </Card>

          {/* Processing Progress */}
          {processStatus === 'running' && progress && (
            <Card withBorder p="xs">
              <Group justify="space-between" gap="xs">
                <Group gap="xs">
                  <Text size="xs" fw={500} style={{ fontFamily: 'var(--mantine-font-family-monospace)', fontSize: '11px' }}>
                    {progress.epoch}
                  </Text>
                </Group>
                <Group gap="xs">
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
                    Q={progress.quality}
                    {progress.quality === 1 ? ' Fix' :
                     progress.quality === 2 ? ' Float' :
                     progress.quality === 4 ? ' DGPS' :
                     progress.quality === 5 ? ' Single' :
                     progress.quality === 0 ? ' None' : ''}
                  </Badge>
                  {progress.ns !== null && (
                    <Badge size="sm" variant="light" color="blue">
                      ns={progress.ns}
                    </Badge>
                  )}
                  {progress.ratio !== null && (
                    <Badge size="sm" variant="light" color={progress.ratio >= 3 ? 'green' : 'gray'}>
                      ratio={progress.ratio.toFixed(1)}
                    </Badge>
                  )}
                </Group>
              </Group>
            </Card>
          )}

          {/* Terminal Output - Tabbed (Console / Result / Trace) */}
          <Card withBorder p={0} style={{ flex: 1 }}>
            <TabbedTerminalOutput
              logLines={logLines}
              maxHeight={600}
              onClearLog={() => setLogLines([])}
              outputFilePath={outputFile}
              traceEnabled={config.output.debugTrace !== 'off'}
              processStatus={processStatus}
            />
          </Card>

          {/* Result Card */}
          {processStatus === 'success' && (
            <Card withBorder p="xs">
              <Stack gap="xs">
                <Group justify="space-between">
                  <Title order={6} size="xs">Result</Title>
                  <Badge color="green" size="sm">Complete</Badge>
                </Group>
                <Box>
                  <Text size="xs" c="dimmed">Output File</Text>
                  <Code style={{ fontSize: '10px' }}>{outputFile}</Code>
                </Box>
                <Button
                  variant="light"
                  leftSection={<IconDownload size={12} />}
                  size="xs"
                  component="a"
                  href={`/api/files/download?path=${encodeURIComponent(outputFile)}`}
                  download
                >
                  Download Result
                </Button>
              </Stack>
            </Card>
          )}
        </Stack>
      </Grid.Col>

    </Grid>

    <FileBrowserModal
      opened={fileBrowserOpened}
      onClose={() => setFileBrowserOpened(false)}
      onSelect={handleFileBrowserSelect}
      title="Select File"
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

interface StreamServerPanelProps {
  processId: string | null;
  setProcessId: (id: string | null) => void;
  processState: ProcessStatus;
  setProcessState: (state: ProcessStatus) => void;
}

function StreamServerPanel({
  processId,
  setProcessId,
  processState,
  setProcessState,
}: StreamServerPanelProps) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [currentArgs, setCurrentArgs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to track current process ID without causing useCallback re-creation
  const processIdRef = useRef<string | null>(processId);
  processIdRef.current = processId;

  // WebSocket connection for real-time logs
  const { isConnected, clearMessages } = useWebSocket({
    onMessage: useCallback((message: LogMessage) => {
      // Only process messages for our str2str process
      if (message.process_id !== processIdRef.current) return;
      if (message.type === 'log' && message.message) {
        setLogLines((prev) => [...prev.slice(-500), message.message!]);
      }
      if (message.type === 'status' && message.status) {
        // Map backend status to UI status
        const statusMap: Record<string, ProcessStatus> = {
          idle: 'idle',
          starting: 'running',
          running: 'running',
          stopping: 'running',
          stopped: 'idle',
          error: 'error',
        };
        setProcessState(statusMap[message.status] || 'idle');
      }
    }, []),
    onConnect: useCallback(() => {
      setLogLines((prev) => [...prev, '[WS] Connected to log stream']);
    }, []),
    onDisconnect: useCallback(() => {
      setLogLines((prev) => [...prev, '[WS] Disconnected from log stream']);
    }, []),
  });

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    setLogLines([]);

    try {
      const result = await mrtkRelayApi.startRelay({ args: currentArgs });
      setProcessId(result.id);
      setProcessState('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start process');
      setProcessState('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!processId) return;

    setIsLoading(true);
    setError(null);

    try {
      await mrtkRelayApi.stopRelay({ process_id: processId });
      setProcessState('idle');
      setProcessId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop process');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTest = async () => {
    setIsLoading(true);
    setError(null);
    setLogLines([]);

    try {
      // Use -h argument to show help
      const result = await mrtkRelayApi.startRelay({ args: ['-h'] });
      setProcessId(result.id);
      setProcessState('running');

      // Auto-stop after 3 seconds (help exits immediately, this ensures cleanup)
      setTimeout(async () => {
        try {
          await mrtkRelayApi.stopRelay({ process_id: result.id });
          setProcessState('idle');
          setProcessId(null);
        } catch (err) {
          console.error('Auto-stop failed:', err);
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run test');
      setProcessState('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setLogLines([]);
    clearMessages();
  };

  return (
    <Grid gutter="md">
      {/* Left Pane: Configuration */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap="md">
          <Card withBorder padding="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600}>WebSocket Status</Text>
              <Group gap="xs">
                <Tooltip label={isConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
                  {isConnected ? (
                    <IconPlugConnected size={18} color="var(--mantine-color-green-6)" />
                  ) : (
                    <IconPlugConnectedX size={18} color="var(--mantine-color-red-6)" />
                  )}
                </Tooltip>
                <Text size="xs" c={isConnected ? 'green' : 'dimmed'}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </Group>
            </Group>
          </Card>

          <StreamConfiguration onArgsChange={setCurrentArgs} />

          {error && (
            <Alert color="red" icon={<IconInfoCircle size={16} />} withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Action Area */}
          <Card withBorder>
            <Stack gap="sm">
              <Group grow>
                {processState === 'running' ? (
                  <Button
                    color="red"
                    leftSection={<IconPlayerStop size={18} />}
                    onClick={handleStop}
                    loading={isLoading}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    color="green"
                    leftSection={<IconPlayerPlay size={18} />}
                    onClick={handleStart}
                    loading={isLoading}
                  >
                    Start Stream
                  </Button>
                )}
              </Group>
              <Button
                variant="light"
                leftSection={<IconTestPipe size={18} />}
                onClick={handleTest}
                loading={isLoading}
                disabled={processState === 'running'}
              >
                Test (Show Help)
              </Button>
            </Stack>
          </Card>
        </Stack>
      </Grid.Col>

      {/* Right Pane: Monitor */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap="md" h="100%">
          {/* Status Bar */}
          <Card withBorder>
            <Group justify="space-between">
              <StatusIndicator status={processState} />
              <Group gap="xs">
                <Badge variant="light" color="blue">
                  str2str
                </Badge>
                {processId && (
                  <Badge variant="outline" size="sm">
                    ID: {processId}
                  </Badge>
                )}
              </Group>
            </Group>
          </Card>

          {/* Terminal Output */}
          <Card withBorder style={{ flex: 1 }} p={0}>
            <TerminalOutput
              lines={logLines}
              maxHeight={400}
              onClear={handleClear}
            />
          </Card>
        </Stack>
      </Grid.Col>
    </Grid>
  );
}

function ConversionPanel() {
  return (
    <Card withBorder>
      <Stack gap="md" align="center" py="xl">
        <IconRefresh size={48} opacity={0.5} />
        <Title order={4} c="dimmed">Data Conversion</Title>
        <Text size="sm" c="dimmed">Convert binary data formats with convbin</Text>
        <Badge>Coming Soon</Badge>
      </Stack>
    </Card>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<string | null>('stream-server');
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [mrtkVersion, setMrtkVersion] = useState<string>('');

  // Stream process state (lifted to App level for persistence across tabs)
  const [streamProcessId, setStreamProcessId] = useState<string | null>(null);
  const [streamProcessState, setStreamProcessState] = useState<ProcessStatus>('idle');

  // Global stop handler for stream process
  const handleStopStream = async () => {
    if (!streamProcessId) return;

    try {
      await mrtkRelayApi.stopRelay({ process_id: streamProcessId });
      setStreamProcessState('idle');
      setStreamProcessId(null);
    } catch (err) {
      console.error('Failed to stop stream:', err);
    }
  };

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
              <Tabs.Tab
                value="stream-server"
                rightSection={
                  streamProcessState === 'running' ? (
                    <Badge color="green" size="xs" circle>
                      1
                    </Badge>
                  ) : null
                }
              >
                Stream Server
              </Tabs.Tab>
              <Tabs.Tab value="conversion">Conversion</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {/* Right Controls */}
          <Group gap="sm">
            {/* Global Stream Process Indicator */}
            {streamProcessState === 'running' && (
              <Group gap="xs">
                <Badge color="green" variant="dot" size="sm">
                  Stream Running
                </Badge>
                <ActionIcon
                  variant="filled"
                  color="red"
                  size="sm"
                  onClick={handleStopStream}
                  title="Stop stream"
                >
                  <IconPlayerStop size={14} />
                </ActionIcon>
              </Group>
            )}
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
            <Tabs.Tab
              value="stream-server"
              rightSection={
                streamProcessState === 'running' ? (
                  <Badge color="green" size="xs" circle>
                    1
                  </Badge>
                ) : null
              }
            >
              Stream
            </Tabs.Tab>
            <Tabs.Tab value="conversion">Convert</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {/* Tab Content - keep all panels mounted to preserve state */}
        <div style={{ display: activeTab === 'post-processing' ? undefined : 'none' }}>
          <PostProcessingPanel />
        </div>
        <div style={{ display: activeTab === 'stream-server' ? undefined : 'none' }}>
          <StreamServerPanel
            processId={streamProcessId}
            setProcessId={setStreamProcessId}
            processState={streamProcessState}
            setProcessState={setStreamProcessState}
          />
        </div>
        <div style={{ display: activeTab === 'conversion' ? undefined : 'none' }}>
          <ConversionPanel />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

export default App;
