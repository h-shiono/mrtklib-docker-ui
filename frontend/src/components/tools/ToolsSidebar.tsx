import { Stack, Group, Text, ScrollArea, UnstyledButton } from '@mantine/core';
import { IconClock, IconDownload, IconTools, IconDatabase, IconSparkles, IconSettings, IconCheck, IconAlertCircle } from '@tabler/icons-react';

interface ToolsSidebarProps {
  selected: string;
  onSelect: (id: string) => void;
  aiConfigured?: boolean;
}

function SidebarGroup({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <Group
        gap={6}
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: '10px',
          padding: '12px 8px 4px',
          userSelect: 'none',
          color: 'var(--mantine-color-dimmed)',
        }}
      >
        {icon}
        <Text size="xs" fw={600} c="dimmed" style={{ fontSize: '10px' }}>{label}</Text>
      </Group>
      {children}
    </>
  );
}

function SidebarItem({ label, icon, section, active, onClick }: {
  label: string;
  icon: React.ReactNode;
  section: string;
  active: string;
  onClick: (s: string) => void;
}) {
  const isActive = active === section;
  return (
    <UnstyledButton
      onClick={() => onClick(section)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 8px',
        fontSize: '11px',
        borderLeft: isActive ? '2px solid var(--mantine-primary-color-filled)' : '2px solid transparent',
        backgroundColor: isActive ? 'var(--mantine-color-default-hover)' : undefined,
        color: isActive ? 'var(--mantine-color-text)' : 'var(--mantine-color-dimmed)',
        fontWeight: isActive ? 500 : 400,
      }}
    >
      {icon}
      {label}
    </UnstyledButton>
  );
}

export function ToolsSidebar({ selected, onSelect, aiConfigured }: ToolsSidebarProps) {
  return (
    <ScrollArea style={{ width: '100%', height: '100%' }}>
      <Stack gap={0}>
        <SidebarGroup label="UTILITIES" icon={<IconTools size={12} />}>
          <SidebarItem label="Time Converter" icon={<IconClock size={14} />} section="time-converter" active={selected} onClick={onSelect} />
        </SidebarGroup>
        <SidebarGroup label="DATA" icon={<IconDatabase size={12} />}>
          <SidebarItem label="Downloader" icon={<IconDownload size={14} />} section="downloader" active={selected} onClick={onSelect} />
        </SidebarGroup>
        <SidebarGroup label="AI" icon={<IconSparkles size={12} />}>
          <UnstyledButton
            onClick={() => onSelect('ai-settings')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              width: '100%',
              padding: '6px 8px',
              fontSize: '11px',
              borderLeft: selected === 'ai-settings' ? '2px solid var(--mantine-primary-color-filled)' : '2px solid transparent',
              backgroundColor: selected === 'ai-settings' ? 'var(--mantine-color-default-hover)' : undefined,
              color: selected === 'ai-settings' ? 'var(--mantine-color-text)' : 'var(--mantine-color-dimmed)',
              fontWeight: selected === 'ai-settings' ? 500 : 400,
            }}
          >
            <Group gap={8} style={{ flex: 1 }}>
              <IconSettings size={14} />
              AI Settings
            </Group>
            {aiConfigured
              ? <IconCheck size={12} color="var(--mantine-color-green-6)" />
              : <IconAlertCircle size={12} color="var(--mantine-color-orange-6)" />
            }
          </UnstyledButton>
        </SidebarGroup>
      </Stack>
    </ScrollArea>
  );
}
