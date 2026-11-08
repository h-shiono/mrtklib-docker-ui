/**
 * Position scatter plot showing ENU deviations from mean position.
 * 1:1 aspect ratio enforced, points colored by solution quality.
 */

import { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Text, Group, Badge, useMantineColorScheme } from '@mantine/core';
import { qualityColor, qualityLabel } from '../utils/quality';

export interface PositionPoint {
  lat: number;
  lon: number;
  height: number;
  quality: number;
  timestamp: string;
}

const DEG_TO_M_LAT = 111320;

interface PositionScatterProps {
  points: PositionPoint[];
  maxPoints?: number;
}

export function PositionScatter({ points, maxPoints = 3600 }: PositionScatterProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  const { datasets, range } = useMemo(() => {
    const valid = points.filter(p => p.lat !== 0 || p.lon !== 0);
    const recent = valid.slice(-maxPoints);
    if (recent.length === 0) return { datasets: {}, range: 1 };

    const meanLat = recent.reduce((s, p) => s + p.lat, 0) / recent.length;
    const meanLon = recent.reduce((s, p) => s + p.lon, 0) / recent.length;
    const cosLat = Math.cos(meanLat * Math.PI / 180);

    // Group by quality
    const grouped: Record<number, { e: number; n: number }[]> = {};
    let maxDev = 1; // minimum ±1m

    for (const p of recent) {
      const e = (p.lon - meanLon) * DEG_TO_M_LAT * cosLat;
      const n = (p.lat - meanLat) * DEG_TO_M_LAT;
      maxDev = Math.max(maxDev, Math.abs(e), Math.abs(n));
      const q = p.quality;
      if (!grouped[q]) grouped[q] = [];
      grouped[q].push({ e, n });
    }

    const r = Math.ceil(maxDev * 1.2 * 100) / 100;
    return { datasets: grouped, range: r };
  }, [points, maxPoints]);

  if (Object.keys(datasets).length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 120 }}>
        <Text size="sm" c="dimmed">No position data yet</Text>
      </div>
    );
  }

  // Sort quality keys for consistent rendering order
  const qualityKeys = Object.keys(datasets).map(Number).sort();

  return (
    <div style={{ width: '100%', maxWidth: 400, aspectRatio: '1', margin: '0 auto' }}>
      {/* Quality legend */}
      <Group gap={8} justify="center" mb={4}>
        {qualityKeys.map(q => (
          <Badge
            key={q}
            size="xs"
            variant="dot"
            color={qualityColor(q)}
          >
            {qualityLabel(q)} ({datasets[q]?.length || 0})
          </Badge>
        ))}
      </Group>

      <ResponsiveContainer width="100%" height="90%">
        <ScatterChart margin={{ top: 5, right: 15, bottom: 20, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#444' : '#ddd'} />
          <XAxis
            type="number"
            dataKey="e"
            name="East"
            domain={[-range, range]}
            tick={{ fontSize: 9 }}
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{ value: 'East (m)', position: 'bottom', fontSize: 9, offset: 5 }}
          />
          <YAxis
            type="number"
            dataKey="n"
            name="North"
            domain={[-range, range]}
            tick={{ fontSize: 9 }}
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{ value: 'North (m)', angle: -90, position: 'insideLeft', fontSize: 9 }}
          />
          <Tooltip
            formatter={(value: unknown) => `${Number(value).toFixed(3)} m`}
            labelFormatter={() => ''}
            contentStyle={{
              fontSize: '10px',
              backgroundColor: isDark ? '#1a1b2e' : '#fff',
              border: `1px solid ${isDark ? '#444' : '#ddd'}`,
            }}
          />
          {qualityKeys.map(q => (
            <Scatter
              key={q}
              name={qualityLabel(q)}
              data={datasets[q]}
              fill={qualityColor(q)}
              fillOpacity={0.8}
              isAnimationActive={false}
              legendType="none"
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
