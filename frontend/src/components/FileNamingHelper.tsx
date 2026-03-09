import { ActionIcon, Popover, Stack, Text, Group, Code, ScrollArea } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { FILE_NAMING_KEYWORDS } from '../types/streamConfig';

interface FileNamingHelperProps {
  onKeywordClick?: (keyword: string) => void;
}

export function FileNamingHelper({ onKeywordClick }: FileNamingHelperProps) {
  return (
    <Popover width={400} position="bottom-end" shadow="md" withArrow>
      <Popover.Target>
        <ActionIcon variant="subtle" size="sm" aria-label="Show file naming keywords">
          <IconInfoCircle size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            RTKLIB File Naming Keywords
          </Text>
          <Text size="xs" c="dimmed">
            Click a keyword to insert it into the file path
          </Text>
          <ScrollArea h={300}>
            <Stack gap="xs">
              {FILE_NAMING_KEYWORDS.map((item) => (
                <Group
                  key={item.keyword}
                  gap="xs"
                  style={{
                    cursor: onKeywordClick ? 'pointer' : 'default',
                    padding: '4px',
                    borderRadius: '4px',
                  }}
                  onClick={() => onKeywordClick?.(item.keyword)}
                  onMouseEnter={(e) => {
                    if (onKeywordClick) {
                      e.currentTarget.style.backgroundColor = 'var(--mantine-color-gray-1)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <Code
                    style={{ minWidth: '40px', textAlign: 'center' }}
                    c="blue"
                  >
                    {item.keyword}
                  </Code>
                  <Stack gap={0} style={{ flex: 1 }}>
                    <Text size="xs">{item.description}</Text>
                    <Text size="xs" c="dimmed">
                      e.g., {item.example}
                    </Text>
                  </Stack>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
