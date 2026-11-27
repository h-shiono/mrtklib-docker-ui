import { createContext, useContext } from 'react';

export interface AuthContextValue {
  /** The server asks for an access token (MRTK_AUTH_TOKEN is set). */
  required: boolean;
  /** Drop this browser's session and return to the sign-in screen. */
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  required: false,
  signOut: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
