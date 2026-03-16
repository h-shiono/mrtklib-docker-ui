import { useState, useEffect } from 'react';
import { Modal, Stack, Text, Group, Button, Table, UnstyledButton, useMantineColorScheme } from '@mantine/core';

/**
 * GNSS signal definitions per system and band.
 * Signal codes follow RINEX 3/4 convention: {System}{Band}{Attribute}
 */
const SIGNAL_CATALOG: Record<string, { label: string; bands: Record<string, string[]> }> = {
  G: {
    label: 'GPS',
    bands: {
      '1': ['C', 'S', 'L', 'X', 'P', 'W', 'Y', 'M', 'N'],
      '2': ['C', 'D', 'S', 'L', 'X', 'P', 'W', 'Y', 'M', 'N'],
      '5': ['I', 'Q', 'X'],
    },
  },
  R: {
    label: 'GLONASS',
    bands: {
      '1': ['C', 'P'],
      '2': ['C', 'P'],
      '3': ['I', 'Q', 'X'],
    },
  },
  E: {
    label: 'Galileo',
    bands: {
      '1': ['A', 'B', 'C', 'X', 'Z'],
      '5': ['I', 'Q', 'X'],
      '7': ['I', 'Q', 'X'],
      '8': ['I', 'Q', 'X'],
      '6': ['A', 'B', 'C', 'X', 'Z'],
    },
  },
  J: {
    label: 'QZSS',
    bands: {
      '1': ['C', 'S', 'L', 'X', 'Z'],
      '2': ['S', 'L', 'X'],
      '5': ['I', 'Q', 'X', 'D', 'P', 'Z'],
      '6': ['S', 'L', 'X', 'Z', 'E'],
    },
  },
  C: {
    label: 'BeiDou',
    bands: {
      '2': ['I', 'Q', 'X'],
      '1': ['D', 'P', 'X', 'A', 'Z'],
      '5': ['D', 'P', 'X'],
      '7': ['I', 'Q', 'X', 'D', 'P', 'Z'],
      '8': ['D', 'P', 'X'],
      '6': ['I', 'Q', 'X', 'A', 'Z'],
    },
  },
  I: {
    label: 'NavIC/IRNSS',
    bands: {
      '5': ['A', 'B', 'C', 'X'],
      '9': ['A', 'B', 'C', 'X'],
    },
  },
};

interface SignalSelectModalProps {
  opened: boolean;
  onClose: () => void;
  value: string; // comma-separated signal codes
  onChange: (value: string) => void;
}

export function SignalSelectModal({ opened, onClose, value, onChange }: SignalSelectModalProps) {
  const { colorScheme } = useMantineColorScheme();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Parse initial value
  useEffect(() => {
    if (opened) {
      const codes = value
        .replace(/,/g, ' ')
        .split(/\s+/)
        .filter((s) => s.trim())
        .map((s) => s.trim());
      setSelected(new Set(codes));
    }
  }, [opened, value]);

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const handleApply = () => {
    // Build ordered list following catalog order
    const ordered: string[] = [];
    for (const [sys, def] of Object.entries(SIGNAL_CATALOG)) {
      for (const [band, attrs] of Object.entries(def.bands)) {
        for (const attr of attrs) {
          const code = `${sys}${band}${attr}`;
          if (selected.has(code)) {
            ordered.push(code);
          }
        }
      }
    }
    onChange(ordered.join(','));
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Signal Selection"
      size="lg"
      styles={{ title: { fontSize: '14px', fontWeight: 600 } }}
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Select observation codes per GNSS system (RINEX 3/4 convention).
          Selected: {selected.size} signals
        </Text>

        <Table style={{ fontSize: '10px' }} withRowBorders={false} verticalSpacing={2}>
          <Table.Tbody>
            {Object.entries(SIGNAL_CATALOG).map(([sys, def], sysIdx) => {
              const bandEntries = Object.entries(def.bands);
              const stripeBg = sysIdx % 2 === 1
                ? (colorScheme === 'dark' ? 'var(--mantine-color-dark-5)' : 'var(--mantine-color-gray-1)')
                : undefined;
              return bandEntries.map(([band, attrs], bandIdx) => (
                <Table.Tr key={`${sys}${band}`} style={{ backgroundColor: stripeBg }}>
                  {/* System name — spans all bands for this system */}
                  {bandIdx === 0 ? (
                    <Table.Td
                      rowSpan={bandEntries.length}
                      style={{ fontSize: '11px', fontWeight: 600, verticalAlign: 'middle', width: 70, padding: '4px 8px 4px 4px', backgroundColor: stripeBg, borderRadius: bandEntries.length > 1 ? '4px 0 0 4px' : 4 }}
                    >
                      {def.label}
                    </Table.Td>
                  ) : null}
                  {/* Band label */}
                  <Table.Td style={{ width: 24, padding: '2px 4px', color: 'var(--mantine-color-dimmed)', verticalAlign: 'middle' }}>
                    {sys}{band}
                  </Table.Td>
                  {/* Signal checkboxes */}
                  <Table.Td style={{ padding: '2px 0' }}>
                    <Group gap={4} wrap="wrap">
                      {attrs.map((attr) => {
                        const code = `${sys}${band}${attr}`;
                        const isSelected = selected.has(code);
                        return (
                          <UnstyledButton
                            key={code}
                            onClick={() => toggle(code)}
                            aria-pressed={isSelected}
                            style={{
                              fontSize: '10px',
                              fontWeight: isSelected ? 600 : 400,
                              padding: '2px 6px',
                              borderRadius: 4,
                              border: `1px solid ${isSelected ? 'var(--mantine-color-blue-5)' : 'var(--mantine-color-gray-3)'}`,
                              backgroundColor: isSelected ? 'var(--mantine-color-blue-0)' : 'transparent',
                              color: isSelected ? 'var(--mantine-color-blue-7)' : 'var(--mantine-color-gray-7)',
                              lineHeight: '18px',
                              minWidth: 36,
                              textAlign: 'center',
                            }}
                          >
                            {code}
                          </UnstyledButton>
                        );
                      })}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ));
            })}
          </Table.Tbody>
        </Table>

        <Group justify="flex-end" mt="xs">
          <Button size="xs" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="xs"
            variant="light"
            onClick={() => setSelected(new Set())}
          >
            Clear All
          </Button>
          <Button size="xs" onClick={handleApply}>
            Apply ({selected.size})
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
