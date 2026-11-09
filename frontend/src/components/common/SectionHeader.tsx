import type { ReactNode } from 'react';
import { Box, Divider, Group, Text } from '@mantine/core';

/** Heading of a form section: title, hairline, and help or actions at the right. */
export function SectionHeader({ title, help, mt }: {
  title: string;
  /** The `?` help control, and any section actions. */
  help?: ReactNode;
  mt?: number;
}) {
  return (
    <Box mt={mt}>
      <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
        <Text size="sm" fw={500}>{title}</Text>
        {help && <Group gap={4} wrap="nowrap">{help}</Group>}
      </Group>
      <Divider mb={4} />
    </Box>
  );
}
