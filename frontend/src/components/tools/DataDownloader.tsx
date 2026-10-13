import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card,
  Stack,
  Group,
  Text,
  Title,
  Button,
  TextInput,
  NumberInput,
  Select,
  SegmentedControl,
  Badge,
  Table,
  Alert,
  Loader,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconDownload,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconSatellite,
  IconKey,
  IconHistory,
  IconRefresh,
} from '@tabler/icons-react';

// ── Types ────────────────────────────────────────────────────────────────

interface CredentialStatus {
  configured: boolean;
  source: string | null;
}

interface CredentialsMap {
  earthdata: CredentialStatus;
  gsi: CredentialStatus;
}

interface DownloadHistoryEntry {
  id: string;
  filename: string;
  url: string;
  dest: string;
  status: 'completed' | 'downloading' | 'failed' | 'skipped';
  size_bytes: number;
  timestamp: string;
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const API_BASE = '/api/downloader';

/** UTC year and day of year, `daysAgo` days before today (UTC). Archives are
 *  organised by GPS/UTC day, and a product for today does not exist yet. */
function utcYearDoy(daysAgo: number): { year: number; doy: number } {
  const now = new Date();
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * 86_400_000;
  const year = new Date(day).getUTCFullYear();
  return { year, doy: Math.round((day - Date.UTC(year, 0, 1)) / 86_400_000) + 1 };
}

// Default dates: L6 archives and GSI CORS lag by about a day; IGS final
// orbits/clocks by about two weeks.
const L6_DEFAULT_DAYS_AGO = 1;
const GSI_DEFAULT_DAYS_AGO = 1;
const IGS_DEFAULT_DAYS_AGO = 14;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <IconCheck size={14} color="green" />;
    case 'downloading':
      return <Loader size={14} color="blue" />;
    case 'failed':
      return <IconX size={14} color="red" />;
    case 'skipped':
      return <Text size="xs" c="dimmed">--</Text>;
    default:
      return null;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'green';
    case 'downloading': return 'blue';
    case 'failed': return 'red';
    case 'skipped': return 'gray';
    default: return 'gray';
  }
}

const SESSION_OPTIONS = [
  { value: '*', label: '* (All)' },
  ...Array.from({ length: 24 }, (_, i) => {
    const c = String.fromCharCode(97 + i);
    return { value: c, label: c };
  }),
];

const PRN_OPTIONS = [
  { value: 'all', label: 'all' },
  ...Array.from({ length: 7 }, (_, i) => {
    const prn = `Q${String(i + 1).padStart(2, '0')}`;
    return { value: prn, label: prn };
  }),
];

const PRODUCT_TYPE_OPTIONS = [
  { value: 'brdc', label: 'brdc' },
  { value: 'sp3', label: 'sp3' },
  { value: 'clk', label: 'clk' },
  { value: 'erp', label: 'erp' },
];

const AC_OPTIONS = [
  { value: 'IGS', label: 'IGS' },
  { value: 'GFZ', label: 'GFZ' },
  { value: 'COD', label: 'COD' },
  { value: 'JPL', label: 'JPL' },
  { value: 'ESA', label: 'ESA' },
];

const MONO_FONT = 'IBM Plex Mono, monospace';

// ── Component ────────────────────────────────────────────────────────────

export function DataDownloader() {
  // Credential state
  const [credentials, setCredentials] = useState<CredentialsMap | null>(null);
  const [earthdataUser, setEarthdataUser] = useState('');
  const [earthdataPass, setEarthdataPass] = useState('');
  const [gsiUser, setGsiUser] = useState('');
  const [gsiPass, setGsiPass] = useState('');
  const [savingCred, setSavingCred] = useState<string | null>(null);

  // QZSS state
  const [qzssType, setQzssType] = useState<string>('CLAS');
  const [qzssYear, setQzssYear] = useState<number>(() => utcYearDoy(L6_DEFAULT_DAYS_AGO).year);
  const [qzssDoy, setQzssDoy] = useState<number>(() => utcYearDoy(L6_DEFAULT_DAYS_AGO).doy);
  const [qzssSession, setQzssSession] = useState<string>('a');
  const [qzssPrn, setQzssPrn] = useState<string>('Q01');
  const [qzssDestDir, setQzssDestDir] = useState<string>(
    '/workspace/downloads/clas'
  );
  const [qzssLoading, setQzssLoading] = useState(false);

  // IGS state
  const [igsProductType, setIgsProductType] = useState<string>('brdc');
  const [igsAc, setIgsAc] = useState<string>('IGS');
  const [igsYear, setIgsYear] = useState<number>(() => utcYearDoy(IGS_DEFAULT_DAYS_AGO).year);
  const [igsDoy, setIgsDoy] = useState<number>(() => utcYearDoy(IGS_DEFAULT_DAYS_AGO).doy);
  const [igsDestDir, setIgsDestDir] = useState('/workspace/downloads/igs');
  const [igsLoading, setIgsLoading] = useState(false);
  const [atxLoading, setAtxLoading] = useState(false);

  // GSI state
  const [gsiStation, setGsiStation] = useState('');
  const [gsiYear, setGsiYear] = useState<number>(() => utcYearDoy(GSI_DEFAULT_DAYS_AGO).year);
  const [gsiDoy, setGsiDoy] = useState<number>(() => utcYearDoy(GSI_DEFAULT_DAYS_AGO).doy);
  const [gsiDestDir, setGsiDestDir] = useState('/workspace/downloads/gsi');
  const [gsiLoading, setGsiLoading] = useState(false);

  // History state
  const [history, setHistory] = useState<DownloadHistoryEntry[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update QZSS dest dir when type changes
  useEffect(() => {
    setQzssDestDir(
      qzssType === 'CLAS'
        ? '/workspace/downloads/clas'
        : '/workspace/downloads/madoca'
    );
  }, [qzssType]);

  // ── API helpers ──────────────────────────────────────────────────────

  const fetchCredentials = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/credentials`);
      if (resp.ok) {
        const data: CredentialsMap = await resp.json();
        setCredentials(data);
      }
    } catch {
      // silent
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/status`);
      if (resp.ok) {
        const data: DownloadHistoryEntry[] = await resp.json();
        setHistory(data);
      }
    } catch {
      // silent
    }
  }, []);

  // Fetch credentials on mount
  useEffect(() => {
    fetchCredentials();
    fetchHistory();
  }, [fetchCredentials, fetchHistory]);

  // Poll history while any download is active
  useEffect(() => {
    const hasActive = history.some((h) => h.status === 'downloading');
    if (hasActive && !pollingRef.current) {
      pollingRef.current = setInterval(fetchHistory, 3000);
    } else if (!hasActive && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [history, fetchHistory]);

  // ── Credential save ────────────────────────────────────────────────

  const handleSaveCredential = async (service: 'earthdata' | 'gsi') => {
    const user = service === 'earthdata' ? earthdataUser : gsiUser;
    const pass = service === 'earthdata' ? earthdataPass : gsiPass;
    if (!user || !pass) {
      notifications.show({
        title: 'Missing fields',
        message: 'Please enter both username and password.',
        color: 'yellow',
      });
      return;
    }
    setSavingCred(service);
    try {
      const resp = await fetch(`${API_BASE}/credentials/${service}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      if (resp.ok) {
        notifications.show({
          title: 'Saved',
          message: `${service === 'earthdata' ? 'NASA Earthdata' : 'GSI CORS'} credentials saved.`,
          color: 'green',
          icon: <IconCheck size={16} />,
        });
        await fetchCredentials();
        if (service === 'earthdata') {
          setEarthdataUser('');
          setEarthdataPass('');
        } else {
          setGsiUser('');
          setGsiPass('');
        }
      } else {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        notifications.show({
          title: 'Failed to save',
          message: typeof err.detail === 'string' ? err.detail : 'Save failed',
          color: 'red',
          icon: <IconX size={16} />,
        });
      }
    } catch (e) {
      notifications.show({
        title: 'Network error',
        message: String(e),
        color: 'red',
      });
    } finally {
      setSavingCred(null);
    }
  };

  // ── Download handlers ──────────────────────────────────────────────

  const handleQzssDownload = async () => {
    setQzssLoading(true);
    try {
      const endpoint =
        qzssType === 'CLAS' ? '/qzss/clas' : '/qzss/madoca';
      const body: Record<string, unknown> = {
        year: qzssYear,
        doy: qzssDoy,
        session: qzssSession,
        dest_dir: qzssDestDir,
      };
      if (qzssType === 'MADOCA') {
        body.prn = qzssPrn;
      }
      const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const results: DownloadHistoryEntry[] = await resp.json();
        const completed = results.filter((r) => r.status === 'completed').length;
        const skipped = results.filter((r) => r.status === 'skipped').length;
        notifications.show({
          title: 'QZSS Download Complete',
          message: `${completed} downloaded, ${skipped} skipped, ${results.length - completed - skipped} failed`,
          color: 'green',
        });
      } else {
        const err = await resp.json().catch(() => ({ detail: 'Download failed' }));
        notifications.show({
          title: 'Download failed',
          message: typeof err.detail === 'string' ? err.detail : 'Error',
          color: 'red',
        });
      }
    } catch (e) {
      notifications.show({
        title: 'Network error',
        message: String(e),
        color: 'red',
      });
    } finally {
      setQzssLoading(false);
      fetchHistory();
    }
  };

  const handleAtxDownload = async () => {
    setAtxLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/igs/atx`, { method: 'POST' });
      if (resp.ok) {
        notifications.show({
          title: 'igs20.atx',
          message: 'Downloaded successfully.',
          color: 'green',
        });
      } else {
        notifications.show({
          title: 'Failed',
          message: 'Could not download igs20.atx',
          color: 'red',
        });
      }
    } catch (e) {
      notifications.show({
        title: 'Network error',
        message: String(e),
        color: 'red',
      });
    } finally {
      setAtxLoading(false);
      fetchHistory();
    }
  };

  const handleIgsDownload = async () => {
    setIgsLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/igs/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: igsYear,
          doy: igsDoy,
          product_type: igsProductType,
          analysis_center: igsAc,
          dest_dir: igsDestDir,
        }),
      });
      if (resp.ok) {
        notifications.show({
          title: 'IGS Download Complete',
          message: `Product downloaded to ${igsDestDir}`,
          color: 'green',
        });
      } else {
        const err = await resp.json().catch(() => ({ detail: 'Download failed' }));
        notifications.show({
          title: 'Download failed',
          message: typeof err.detail === 'string' ? err.detail : 'Error',
          color: 'red',
        });
      }
    } catch (e) {
      notifications.show({
        title: 'Network error',
        message: String(e),
        color: 'red',
      });
    } finally {
      setIgsLoading(false);
      fetchHistory();
    }
  };

  const handleGsiDownload = async () => {
    setGsiLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/gsi/cors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station: gsiStation,
          year: gsiYear,
          doy: gsiDoy,
          dest_dir: gsiDestDir,
        }),
      });
      if (resp.ok) {
        notifications.show({
          title: 'GSI CORS Download Complete',
          message: `Data downloaded to ${gsiDestDir}`,
          color: 'green',
        });
      } else {
        const err = await resp.json().catch(() => ({ detail: 'Download failed' }));
        notifications.show({
          title: 'Download failed',
          message: typeof err.detail === 'string' ? err.detail : 'Error',
          color: 'red',
        });
      }
    } catch (e) {
      notifications.show({
        title: 'Network error',
        message: String(e),
        color: 'red',
      });
    } finally {
      setGsiLoading(false);
      fetchHistory();
    }
  };

  // ── File count estimate ────────────────────────────────────────────

  const qzssFileCount = (() => {
    const sessionCount = qzssSession === '*' ? 24 : 1;
    if (qzssType === 'MADOCA') {
      const prnCount = qzssPrn === 'all' ? 7 : 1;
      return sessionCount * prnCount;
    }
    return sessionCount;
  })();

  // ── Credential booleans ────────────────────────────────────────────

  const earthdataConfigured = credentials?.earthdata?.configured ?? false;
  const gsiConfigured = credentials?.gsi?.configured ?? false;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Stack gap="md">
      {/* ── Credentials ─────────────────────────────────────────── */}
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconKey size={18} />
            <Title order={5}>Credentials</Title>
          </Group>

          {credentials === null ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">Loading credential status...</Text>
            </Group>
          ) : (
            <Stack gap="sm">
              {/* NASA Earthdata */}
              <Group gap="sm" align="center">
                <Badge
                  color={earthdataConfigured ? 'green' : 'red'}
                  variant="dot"
                  size="lg"
                >
                  NASA Earthdata
                </Badge>
                {earthdataConfigured && (
                  <Text size="xs" c="dimmed">
                    (source: {credentials.earthdata.source})
                  </Text>
                )}
              </Group>
              {!earthdataConfigured && (
                <Group gap="xs" align="flex-end">
                  <TextInput
                    size="sm"
                    label="Username"
                    placeholder="Earthdata username"
                    value={earthdataUser}
                    onChange={(e) => setEarthdataUser(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    size="sm"
                    label="Password"
                    type="password"
                    placeholder="Earthdata password"
                    value={earthdataPass}
                    onChange={(e) => setEarthdataPass(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSaveCredential('earthdata')}
                    loading={savingCred === 'earthdata'}
                  >
                    Save
                  </Button>
                </Group>
              )}

              {/* GSI CORS */}
              <Group gap="sm" align="center">
                <Badge
                  color={gsiConfigured ? 'green' : 'red'}
                  variant="dot"
                  size="lg"
                >
                  GSI CORS
                </Badge>
                {gsiConfigured && (
                  <Text size="xs" c="dimmed">
                    (source: {credentials.gsi.source})
                  </Text>
                )}
              </Group>
              {!gsiConfigured && (
                <Group gap="xs" align="flex-end">
                  <TextInput
                    size="sm"
                    label="Username"
                    placeholder="GSI username"
                    value={gsiUser}
                    onChange={(e) => setGsiUser(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    size="sm"
                    label="Password"
                    type="password"
                    placeholder="GSI password"
                    value={gsiPass}
                    onChange={(e) => setGsiPass(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSaveCredential('gsi')}
                    loading={savingCred === 'gsi'}
                  >
                    Save
                  </Button>
                </Group>
              )}
            </Stack>
          )}
        </Stack>
      </Card>

      {/* ── QZSS L6 Files ──────────────────────────────────────── */}
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconSatellite size={18} />
            <Title order={5}>QZSS L6 Files</Title>
          </Group>

          <SegmentedControl
            size="sm"
            value={qzssType}
            onChange={setQzssType}
            data={['CLAS', 'MADOCA']}
          />

          <Group gap="sm" grow>
            <NumberInput
              size="sm"
              label="Year"
              value={qzssYear}
              onChange={(v) => setQzssYear(typeof v === 'number' ? v : new Date().getFullYear())}
              min={2020}
              max={2099}
            />
            <NumberInput
              size="sm"
              label="DoY"
              value={qzssDoy}
              onChange={(v) => setQzssDoy(typeof v === 'number' ? v : 1)}
              min={1}
              max={366}
            />
            <Select
              size="sm"
              label="Session"
              data={SESSION_OPTIONS}
              value={qzssSession}
              onChange={(v) => setQzssSession(v ?? 'a')}
            />
            {qzssType === 'MADOCA' && (
              <Select
                size="sm"
                label="PRN"
                data={PRN_OPTIONS}
                value={qzssPrn}
                onChange={(v) => setQzssPrn(v ?? 'Q01')}
              />
            )}
          </Group>

          <TextInput
            size="sm"
            label="Destination directory"
            value={qzssDestDir}
            onChange={(e) => setQzssDestDir(e.currentTarget.value)}
            styles={{ input: { fontFamily: MONO_FONT } }}
          />

          <Group gap="sm" justify="space-between">
            <Text size="xs" c="dimmed">
              {qzssFileCount} file{qzssFileCount !== 1 ? 's' : ''} to download
            </Text>
            <Button
              size="sm"
              leftSection={<IconDownload size={16} />}
              onClick={handleQzssDownload}
              loading={qzssLoading}
            >
              Download
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* ── IGS Products ───────────────────────────────────────── */}
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group gap="xs" justify="space-between">
            <Group gap="xs">
              <IconDownload size={18} />
              <Title order={5}>IGS Products</Title>
            </Group>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              onClick={handleAtxDownload}
              loading={atxLoading}
            >
              Update igs20.atx
            </Button>
          </Group>

          <Group gap="sm" grow>
            <Select
              size="sm"
              label="Product type"
              data={PRODUCT_TYPE_OPTIONS}
              value={igsProductType}
              onChange={(v) => setIgsProductType(v ?? 'brdc')}
            />
            <Select
              size="sm"
              label="Analysis center"
              data={AC_OPTIONS}
              value={igsAc}
              onChange={(v) => setIgsAc(v ?? 'IGS')}
            />
          </Group>

          <Group gap="sm" grow>
            <NumberInput
              size="sm"
              label="Year"
              value={igsYear}
              onChange={(v) => setIgsYear(typeof v === 'number' ? v : new Date().getFullYear())}
              min={1994}
              max={2099}
            />
            <NumberInput
              size="sm"
              label="DoY"
              value={igsDoy}
              onChange={(v) => setIgsDoy(typeof v === 'number' ? v : 1)}
              min={1}
              max={366}
            />
          </Group>

          <TextInput
            size="sm"
            label="Destination directory"
            value={igsDestDir}
            onChange={(e) => setIgsDestDir(e.currentTarget.value)}
            styles={{ input: { fontFamily: MONO_FONT } }}
          />

          {!earthdataConfigured && (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="yellow"
              variant="light"
              title="Credentials required"
            >
              NASA Earthdata credentials must be configured before downloading IGS products from CDDIS.
            </Alert>
          )}

          <Group gap="sm" justify="flex-end">
            <Button
              size="sm"
              leftSection={<IconDownload size={16} />}
              onClick={handleIgsDownload}
              loading={igsLoading}
              disabled={!earthdataConfigured}
            >
              Download
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* ── GSI CORS ───────────────────────────────────────────── */}
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconSatellite size={18} />
            <Title order={5}>GSI CORS</Title>
          </Group>

          <Group gap="sm" grow>
            <TextInput
              size="sm"
              label="Station (4 digits)"
              placeholder="e.g. 0200"
              value={gsiStation}
              onChange={(e) => setGsiStation(e.currentTarget.value)}
              maxLength={4}
            />
            <NumberInput
              size="sm"
              label="Year"
              value={gsiYear}
              onChange={(v) => setGsiYear(typeof v === 'number' ? v : new Date().getFullYear())}
              min={2000}
              max={2099}
            />
            <NumberInput
              size="sm"
              label="DoY"
              value={gsiDoy}
              onChange={(v) => setGsiDoy(typeof v === 'number' ? v : 1)}
              min={1}
              max={366}
            />
          </Group>

          <TextInput
            size="sm"
            label="Destination directory"
            value={gsiDestDir}
            onChange={(e) => setGsiDestDir(e.currentTarget.value)}
            styles={{ input: { fontFamily: MONO_FONT } }}
          />

          {!gsiConfigured && (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="yellow"
              variant="light"
              title="Credentials required"
            >
              GSI CORS FTP credentials must be configured before downloading.
            </Alert>
          )}

          <Group gap="sm" justify="flex-end">
            <Button
              size="sm"
              leftSection={<IconDownload size={16} />}
              onClick={handleGsiDownload}
              loading={gsiLoading}
              disabled={!gsiConfigured || gsiStation.length < 4}
            >
              Download
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* ── Download History ───────────────────────────────────── */}
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group gap="xs" justify="space-between">
            <Group gap="xs">
              <IconHistory size={18} />
              <Title order={5}>Download History</Title>
            </Group>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              onClick={fetchHistory}
            >
              Refresh
            </Button>
          </Group>

          {history.length === 0 ? (
            <Text size="sm" c="dimmed">No downloads yet.</Text>
          ) : (
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
              fz="xs"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 30 }}></Table.Th>
                  <Table.Th>Filename</Table.Th>
                  <Table.Th style={{ width: 80 }}>Size</Table.Th>
                  <Table.Th style={{ width: 90 }}>Status</Table.Th>
                  <Table.Th style={{ width: 170 }}>Time</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.slice(0, 30).map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td style={{ textAlign: 'center' }}>
                      {statusIcon(entry.status)}
                    </Table.Td>
                    <Table.Td style={{ fontFamily: MONO_FONT }}>
                      {entry.filename}
                    </Table.Td>
                    <Table.Td style={{ fontFamily: MONO_FONT }}>
                      {entry.size_bytes > 0 ? formatBytes(entry.size_bytes) : '-'}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color={statusColor(entry.status)}
                      >
                        {entry.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td style={{ fontFamily: MONO_FONT, fontSize: 11 }}>
                      {new Date(entry.timestamp).toLocaleString()}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
