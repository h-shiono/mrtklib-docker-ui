import { useState, useCallback } from 'react';
import {
  Card,
  Stack,
  Group,
  NumberInput,
  Text,
  Title,
  Button,
  Badge,
  Code,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import dayjs from 'dayjs';
import { IconCalendar, IconClock, IconRefresh } from '@tabler/icons-react';
import {
  utcToGpsTime,
  gpsTimeToUtc,
  gpsTimeToWeekTow,
  weekTowToGpsTime,
  gpsTimeToDoy,
  doyToGpsTime,
  hourToSession,
  getLeapSeconds,
  maxDoy,
} from '../../utils/gnssTime';
import { FONT_SIZE } from '../../utils/typography';

// DateTimePicker uses local time internally.
// We treat displayed values as GPS Time wall clock values.
function localToGpsTime(local: Date): Date {
  return new Date(Date.UTC(
    local.getFullYear(), local.getMonth(), local.getDate(),
    local.getHours(), local.getMinutes(), local.getSeconds(),
  ));
}

function gpsTimeToLocal(gpsTime: Date): Date {
  return new Date(
    gpsTime.getUTCFullYear(), gpsTime.getUTCMonth(), gpsTime.getUTCDate(),
    gpsTime.getUTCHours(), gpsTime.getUTCMinutes(), gpsTime.getUTCSeconds(),
  );
}

export function GnssTimeConverter() {
  // Internal state: GPS Time (= UTC + leap seconds offset)
  const [gpsTime, setGpsTime] = useState<Date | null>(() => utcToGpsTime(new Date()));

  const valid = gpsTime && !isNaN(gpsTime.getTime()) ? gpsTime : null;
  const wt = valid ? gpsTimeToWeekTow(valid) : null;
  const doy = valid ? gpsTimeToDoy(valid) : null;
  const utcDate = valid ? gpsTimeToUtc(valid) : null;
  const leapSec = utcDate ? getLeapSeconds(utcDate) : 37;

  const [gpsWeekErr, setGpsWeekErr] = useState(false);
  const [gpsTowErr, setGpsTowErr] = useState(false);
  const [doyYearErr, setDoyYearErr] = useState(false);
  const [doyDoyErr, setDoyDoyErr] = useState(false);
  const [doyHourErr, setDoyHourErr] = useState(false);

  const handleNow = useCallback(() => setGpsTime(utcToGpsTime(new Date())), []);

  const handleGpsWeekChange = useCallback((val: string | number) => {
    const w = Number(val);
    if (!Number.isInteger(w) || w < 0) { setGpsWeekErr(true); return; }
    setGpsWeekErr(false);
    setGpsTime(weekTowToGpsTime(w, wt?.tow ?? 0));
  }, [wt?.tow]);

  const handleGpsTowChange = useCallback((val: string | number) => {
    const t = Number(val);
    if (isNaN(t) || t < 0 || t >= 604800) { setGpsTowErr(true); return; }
    setGpsTowErr(false);
    setGpsTime(weekTowToGpsTime(wt?.week ?? 0, t));
  }, [wt?.week]);

  const handleDoyYearChange = useCallback((val: string | number) => {
    const y = Number(val);
    if (!Number.isInteger(y) || y < 1980 || y > 2100) { setDoyYearErr(true); return; }
    setDoyYearErr(false);
    setGpsTime(doyToGpsTime(y, Math.min(doy?.doy ?? 1, maxDoy(y)), doy?.hour ?? 0));
  }, [doy?.doy, doy?.hour]);

  const handleDoyDoyChange = useCallback((val: string | number) => {
    const d = Number(val);
    const year = doy?.year ?? 2024;
    if (!Number.isInteger(d) || d < 1 || d > maxDoy(year)) { setDoyDoyErr(true); return; }
    setDoyDoyErr(false);
    setGpsTime(doyToGpsTime(year, d, doy?.hour ?? 0));
  }, [doy?.year, doy?.hour]);

  const handleDoyHourChange = useCallback((val: string | number) => {
    const h = Number(val);
    if (!Number.isInteger(h) || h < 0 || h > 23) { setDoyHourErr(true); return; }
    setDoyHourErr(false);
    setGpsTime(doyToGpsTime(doy?.year ?? 2024, doy?.doy ?? 1, h));
  }, [doy?.year, doy?.doy]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: '100%' }}>
      {/* Left: Conversion inputs */}
      <Stack gap="md" style={{ minWidth: 0 }}>
        {/* Calendar (GPS Time) */}
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Group justify="space-between">
              <Title order={6} size="sm">Calendar (GPST)</Title>
              <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={handleNow}>
                Now
              </Button>
            </Group>
            <DateTimePicker
              valueFormat="YYYY/MM/DD HH:mm:ss"
              placeholder="Select date and time (GPST)"
              clearable
              leftSection={<IconCalendar size={16} />}
              value={valid ? gpsTimeToLocal(valid) : null}
              onChange={(val) => {
                if (!val) { setGpsTime(null); return; }
                const local = typeof val === 'string' ? dayjs(val, 'YYYY/MM/DD HH:mm:ss').toDate() : val;
                if (local && !isNaN(local.getTime())) {
                  setGpsTime(localToGpsTime(local));
                } else {
                  setGpsTime(null);
                }
              }}
            />
            <Text size="xs" c="dimmed">All values in GPS Time (GPST = UTC + {leapSec - 19} s)</Text>
          </Stack>
        </Card>

        {/* GPS Week / ToW */}
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Title order={6} size="sm">GPS Week / ToW</Title>
            <Group grow gap="xs">
              <NumberInput
                label="GPS Week"
                leftSection={<IconClock size={14} />}
                value={wt?.week ?? ''}
                onChange={handleGpsWeekChange}
                min={0}
                error={gpsWeekErr ? 'Invalid week' : undefined}
                hideControls
              />
              <NumberInput
                label="Time of Week (s)"
                value={wt ? Math.round(wt.tow * 1000) / 1000 : ''}
                onChange={handleGpsTowChange}
                min={0}
                max={604799.999}
                decimalScale={3}
                error={gpsTowErr ? '0 ≤ ToW < 604800' : undefined}
                hideControls
              />
            </Group>
          </Stack>
        </Card>

        {/* Day of Year (GPST) */}
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Title order={6} size="sm">Day of Year (GPST)</Title>
            <Group grow gap="xs">
              <NumberInput
                label="Year"
                value={doy?.year ?? ''}
                onChange={handleDoyYearChange}
                min={1980}
                max={2100}
                error={doyYearErr ? '1980–2100' : undefined}
                hideControls
              />
              <NumberInput
                label="DoY"
                value={doy?.doy ?? ''}
                onChange={handleDoyDoyChange}
                min={1}
                max={doy ? maxDoy(doy.year) : 366}
                error={doyDoyErr ? 'Invalid DoY' : undefined}
                hideControls
              />
              <NumberInput
                label="Hour"
                value={doy?.hour ?? ''}
                onChange={handleDoyHourChange}
                min={0}
                max={23}
                error={doyHourErr ? '0–23' : undefined}
                hideControls
              />
              <div>
                <Text size="xs" fw={500} mb={5}>Session</Text>
                <Badge size="lg" variant="light" color="gray" fullWidth>
                  {doy ? hourToSession(doy.hour) : '—'}
                </Badge>
              </div>
            </Group>
          </Stack>
        </Card>
      </Stack>

      {/* Right: Reference + Formatted Outputs */}
      <Stack gap="md" style={{ minWidth: 0 }}>
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Title order={6} size="sm">Reference</Title>
            <div>
              <Text size="xs" c="dimmed">GPST − UTC (Leap Seconds)</Text>
              <Text size="md" fw={500}>{leapSec - 19} s</Text>
              <Text size="xs" c="dimmed" mt={2}>TAI − UTC = {leapSec} s</Text>
            </div>
          </Stack>
        </Card>

        <Card withBorder p="sm">
          <Stack gap="xs">
            <Title order={6} size="sm">Formatted Outputs</Title>
            <div>
              <Text size="xs" c="dimmed" mb={2}>GPS Time String</Text>
              <Code block style={{ fontSize: FONT_SIZE.body }}>
                {wt ? `Week ${wt.week}, ToW ${(Math.round(wt.tow * 1000) / 1000).toFixed(3)} s` : '—'}
              </Code>
            </div>
            <div>
              <Text size="xs" c="dimmed" mb={2}>GPST Calendar</Text>
              <Code block style={{ fontSize: FONT_SIZE.body }}>
                {valid
                  ? `${valid.getUTCFullYear()}/${String(valid.getUTCMonth() + 1).padStart(2, '0')}/${String(valid.getUTCDate()).padStart(2, '0')} ${String(valid.getUTCHours()).padStart(2, '0')}:${String(valid.getUTCMinutes()).padStart(2, '0')}:${String(valid.getUTCSeconds()).padStart(2, '0')}`
                  : '—'}
              </Code>
            </div>
            <div>
              <Text size="xs" c="dimmed" mb={2}>UTC (= GPST − {leapSec - 19} s)</Text>
              <Code block style={{ fontSize: FONT_SIZE.body }}>
                {utcDate ? utcDate.toISOString() : '—'}
              </Code>
            </div>
            <div>
              <Text size="xs" c="dimmed" mb={2}>RINEX File Suffix</Text>
              <Code block style={{ fontSize: FONT_SIZE.body }}>
                {doy ? `${String(doy.doy).padStart(3, '0')}${hourToSession(doy.hour)}` : '—'}
              </Code>
            </div>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
