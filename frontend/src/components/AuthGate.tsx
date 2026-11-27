import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Center, Code, Group, Paper, PasswordInput, Stack, Text } from '@mantine/core';
import { IconSatellite } from '@tabler/icons-react';
import * as authApi from '../api/auth';
import { AuthContext, type AuthContextValue } from '../hooks/useAuth';
import { FONT_SIZE } from '../utils/typography';

/**
 * - `checking`: the first status request is out; nothing is shown
 * - `ready`: the app may run (no token configured, signed in, or the server
 *   did not answer, in which case the app reports that itself)
 * - `sign-in`: the server refused this browser; the app is not mounted
 */
type Phase = 'checking' | 'ready' | 'sign-in';

/** How often a page with a token in use asks whether its session still holds. */
const SESSION_CHECK_MS = 20_000;

/**
 * Mounts the app only once this browser may use the API (#86).
 *
 * The app opens its WebSockets and starts polling on mount, so it must not
 * mount while the server would refuse them. When a session ends later (a 401
 * from any request), the app is unmounted again, which also stops its
 * reconnect loops against a server that refuses the handshake.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [required, setRequired] = useState(false);

  useEffect(() => {
    let active = true;
    let tokenInUse = false;
    const check = () => {
      authApi.getAuthStatus().then(
        (status) => {
          if (!active) return;
          tokenInUse = status.required;
          setRequired(status.required);
          setPhase(status.required && !status.authenticated ? 'sign-in' : 'ready');
        },
        () => {
          // Server unreachable: let the app show its own "API" state. If it
          // comes back asking for a token, the first refused request brings
          // us here again.
          if (active) setPhase((current) => (current === 'checking' ? 'ready' : current));
        },
      );
    };
    // An idle page sends no request that could come back 401: the live views
    // are WebSockets, and a refused handshake tells the page nothing. So ask
    // again now and then, and when the tab comes back into view.
    const recheck = () => {
      if (tokenInUse && document.visibilityState === 'visible') check();
    };
    authApi.installUnauthorizedHook();
    const unsubscribe = authApi.onUnauthorized(check);
    const timer = window.setInterval(recheck, SESSION_CHECK_MS);
    document.addEventListener('visibilitychange', recheck);
    check();
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);

  const auth = useMemo<AuthContextValue>(
    () => ({
      required,
      signOut: async () => {
        await authApi.signOut();
        setPhase('sign-in');
      },
    }),
    [required],
  );

  if (phase === 'checking') return null;
  if (phase === 'sign-in') return <SignIn onSignedIn={() => setPhase('ready')} />;
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await authApi.signIn(token.trim())) {
        onSignedIn();
        return;
      }
      setError('Wrong access token.');
    } catch {
      setError('The server did not answer. Check that it is running.');
    }
    setBusy(false);
  };

  return (
    <Center mih="100dvh" p="md">
      <Paper component="form" onSubmit={submit} p="lg" w={360} maw="100%">
        <Stack gap="md">
          <Group gap={9} wrap="nowrap">
            <IconSatellite size={22} />
            <Text component="h1" fw={600} size="sm" m={0}>
              MRTKLIB Console
            </Text>
          </Group>
          <Text c="dimmed" style={{ fontSize: FONT_SIZE.body }}>
            This server asks for an access token: the value of{' '}
            <Code style={{ fontSize: FONT_SIZE.label }}>MRTK_AUTH_TOKEN</Code> where it runs.
          </Text>
          {/* Lets a password manager file the token under a name */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value="mrtklib-web-ui"
            readOnly
            hidden
          />
          <PasswordInput
            aria-label="Access token"
            placeholder="Access token"
            name="token"
            autoComplete="current-password"
            autoFocus
            value={token}
            onChange={(event) => {
              setToken(event.currentTarget.value);
              setError(null);
            }}
            error={error}
            // Mantine's error text is 10px here; a sentence is at least Label size
            styles={{ error: { fontSize: FONT_SIZE.label } }}
          />
          <Button type="submit" size="xs" loading={busy} disabled={!token.trim()}>
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
