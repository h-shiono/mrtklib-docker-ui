/**
 * Time series chart for quality, satellite count, and AR ratio.
 */

import { useMemo } from 'react';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Area, ComposedChart,
} from 'recharts';
import { Text, useMantineColorScheme } from '@mantine/core';
import { FONT_SIZE } from '../utils/typography';

export interface TimeSeriesPoint {
  timestamp: string;
  quality: number;
  ns: number;
  ratio: number;
}

interface TimeSeriesChartProps {
  points: TimeSeriesPoint[];
  maxPoints?: number;
}

export function TimeSeriesChart({ points, maxPoints = 300 }: TimeSeriesChartProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  const data = useMemo(() => {
    const recent = points.slice(-maxPoints);
    return recent.map((p, i) => ({
      idx: i,
      time: p.timestamp.split(' ').pop()?.slice(0, 8) || '',
      quality: p.quality,
      ns: p.ns,
      ratio: Math.min(p.ratio, 100), // cap ratio display at 100
    }));
  }, [points, maxPoints]);

  if (data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 120 }}>
        <Text size="sm" c="dimmed">No data yet</Text>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#555' : '#ddd'} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: FONT_SIZE.caption }}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: FONT_SIZE.caption }}
          domain={[0, 'auto']}
          label={{ value: 'Q / NS', angle: -90, position: 'insideLeft', fontSize: FONT_SIZE.label }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: FONT_SIZE.caption }}
          domain={[0, 'auto']}
          label={{ value: 'Ratio', angle: 90, position: 'insideRight', fontSize: FONT_SIZE.label }}
        />
        <Tooltip
          contentStyle={{
            fontSize: FONT_SIZE.label,
            backgroundColor: isDark ? '#2c2e33' : '#fff',
            border: `1px solid ${isDark ? '#555' : '#ddd'}`,
          }}
        />
        <Legend wrapperStyle={{ fontSize: FONT_SIZE.label }} />
        <Line
          yAxisId="left"
          type="stepAfter"
          dataKey="quality"
          name="Quality"
          stroke="#fa5252"
          dot={false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="ns"
          name="Satellites"
          stroke="#40c057"
          dot={false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Area
          yAxisId="right"
          type="monotone"
          dataKey="ratio"
          name="AR Ratio"
          stroke="#339af0"
          fill="#339af0"
          fillOpacity={0.1}
          strokeWidth={1}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
