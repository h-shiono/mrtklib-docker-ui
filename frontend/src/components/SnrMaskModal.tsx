import { useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Button,
  Checkbox,
  Table,
  NumberInput,
  Text,
} from '@mantine/core';
import type { SnrMaskConfig } from '../types/rnx2rtkpConfig';

interface SnrMaskModalProps {
  opened: boolean;
  onClose: () => void;
  value: SnrMaskConfig;
  onChange: (config: SnrMaskConfig) => void;
}

const ELEVATION_BINS = ['<5', '15', '25', '35', '45', '55', '65', '75', '>85'];
const FREQUENCIES = ['L1', 'L2', 'L5'];

export function SnrMaskModal({ opened, onClose, value, onChange }: SnrMaskModalProps) {
  const [localConfig, setLocalConfig] = useState<SnrMaskConfig>(value);

  const handleSave = () => {
    onChange(localConfig);
    onClose();
  };

  const handleCancel = () => {
    setLocalConfig(value); // Reset to original
    onClose();
  };

  const handleMaskChange = (freqIndex: number, binIndex: number, newValue: number | string) => {
    const newMask = localConfig.mask.map((row, i) =>
      i === freqIndex ? row.map((val, j) => (j === binIndex ? Number(newValue) : val)) : row
    );
    setLocalConfig({ ...localConfig, mask: newMask });
  };

  return (
    <Modal
      opened={opened}
      onClose={handleCancel}
      title="SNR Mask Configuration"
      size="xl"
      styles={{
        title: { fontWeight: 600, fontSize: '14px' },
      }}
    >
      <Stack gap="md">
        {/* Enable Checkboxes */}
        <Group gap="md">
          <Checkbox
            size="xs"
            label="Rover"
            checked={localConfig.enableRover}
            onChange={(e) =>
              setLocalConfig({ ...localConfig, enableRover: e.currentTarget.checked })
            }
            styles={{ label: { fontSize: '11px' } }}
          />
          <Checkbox
            size="xs"
            label="Base Station"
            checked={localConfig.enableBase}
            onChange={(e) =>
              setLocalConfig({ ...localConfig, enableBase: e.currentTarget.checked })
            }
            styles={{ label: { fontSize: '11px' } }}
          />
        </Group>

        {/* SNR Mask Matrix */}
        <div>
          <Text size="xs" fw={500} mb="xs" style={{ fontSize: '10px' }}>
            SNR Mask (dBHz) - Elevation Angle (deg)
          </Text>
          <Table
            striped
            withTableBorder
            withColumnBorders
            style={{ fontSize: '10px' }}
            styles={{
              th: { fontSize: '10px', padding: '4px 6px', textAlign: 'center' },
              td: { padding: '2px' },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Freq</Table.Th>
                {ELEVATION_BINS.map((bin) => (
                  <Table.Th key={bin}>{bin}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {FREQUENCIES.map((freq, freqIndex) => (
                <Table.Tr key={freq}>
                  <Table.Td style={{ fontWeight: 500, textAlign: 'center' }}>{freq}</Table.Td>
                  {ELEVATION_BINS.map((_, binIndex) => (
                    <Table.Td key={binIndex}>
                      <NumberInput
                        size="xs"
                        value={localConfig.mask[freqIndex][binIndex]}
                        onChange={(val) => handleMaskChange(freqIndex, binIndex, val)}
                        min={0}
                        max={60}
                        step={1}
                        hideControls
                        styles={{
                          input: {
                            fontSize: '10px',
                            padding: '2px 4px',
                            minHeight: '24px',
                            textAlign: 'center',
                          },
                        }}
                      />
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>

        {/* Action Buttons */}
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="xs" onClick={handleSave}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
