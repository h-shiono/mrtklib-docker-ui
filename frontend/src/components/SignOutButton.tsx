import { ActionIcon, Tooltip } from '@mantine/core';
import { IconLogout } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useAuth } from '../hooks/useAuth';

/**
 * Header button that ends this browser's session. Shown only when the server
 * asks for an access token (#86). Running processes are not stopped.
 */
export function SignOutButton() {
  const { required, signOut } = useAuth();
  if (!required) return null;

  const handleClick = () => {
    signOut().catch(() => {
      notifications.show({ title: 'Error', message: 'Sign out failed', color: 'red' });
    });
  };

  return (
    <Tooltip label="Sign out">
      <ActionIcon variant="default" size="lg" onClick={handleClick} aria-label="Sign out">
        <IconLogout size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
