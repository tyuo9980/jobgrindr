import { useCallback, useEffect, useState } from 'react';
import { request, SignedOutError } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'signedOut'; googleClientId: string; message?: string }
  | { status: 'signedIn'; user: User; googleClientId: string | null };

// The parts of Google Identity Services this app uses.
interface GoogleId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    auto_select?: boolean;
  }): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
  prompt(): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let gsiLoading: Promise<GoogleId> | null = null;

/** Loads Google's sign-in script once. */
export function loadGoogleIdentity(): Promise<GoogleId> {
  gsiLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in failed to load')));
    script.onerror = () => {
      gsiLoading = null;
      reject(new Error('Google sign-in failed to load'));
    };
    document.head.appendChild(script);
  });
  return gsiLoading;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        const { googleClientId } = await request<{ googleClientId: string | null }>('GET', '/config');
        try {
          const user = await request<User>('GET', '/me');
          setState({ status: 'signedIn', user, googleClientId });
        } catch (err) {
          if (err instanceof SignedOutError && googleClientId) setState({ status: 'signedOut', googleClientId });
          else throw err;
        }
      } catch (err) {
        setState({ status: 'error', message: (err as Error).message });
      }
    })();
  }, []);

  // Stable, so the sign-in screen initializes Google only once.
  const signIn = useCallback(async (credential: string) => {
    try {
      const user = await request<User>('POST', '/session', { credential });
      setState((s) => (s.status === 'signedOut' ? { status: 'signedIn', user, googleClientId: s.googleClientId } : s));
    } catch (err) {
      // Without this, an account the server refuses gets auto-selected again.
      window.google?.accounts.id.disableAutoSelect();
      const message = (err as Error).message;
      setState((s) => (s.status === 'signedOut' ? { ...s, message } : s));
    }
  }, []);

  /** The server says the session is gone (expired, or signed out elsewhere). */
  const sessionEnded = useCallback(() => {
    setState((s) =>
      s.status === 'signedIn' && s.googleClientId
        ? { status: 'signedOut', googleClientId: s.googleClientId, message: 'Your session ended. Sign in again.' }
        : s,
    );
  }, []);

  const signOut = useCallback(async () => {
    if (state.status !== 'signedIn' || !state.googleClientId) return;
    await request('DELETE', '/session').catch(() => undefined);
    // Otherwise Google signs the same account straight back in.
    window.google?.accounts.id.disableAutoSelect();
    setState({ status: 'signedOut', googleClientId: state.googleClientId });
  }, [state]);

  return { state, signIn, signOut, sessionEnded };
}
