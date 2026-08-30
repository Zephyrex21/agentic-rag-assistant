import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getMe, login as apiLogin, logout as apiLogout, signup as apiSignup, type AccountUser } from '../lib/api';
import { withRetry } from '../lib/retry';

interface AuthContextValue {
  user: AccountUser | null;
  loading: boolean;
  authError: string | null;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // One retry after a short delay - same startup-race smoothing every
    // other boot-time fetch in this app uses (see lib/retry.ts). A guest
    // (no session cookie) resolves to user: null here just as validly as
    // an actual failure would look, so there's nothing further to surface
    // to the person if this never succeeds - it just quietly stays a guest.
    withRetry(getMe)
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Deliberately a full reload after any account-state change (signup,
  // login, logout), rather than trying to refetch every piece of state
  // (documents, conversations, active thread, cached content) by hand.
  // This is a security boundary, not just a UI refresh - a full reload
  // guarantees there is no possible leftover state from a different
  // account/guest session anywhere in memory, which piecemeal refetching
  // would need to get perfectly right in every context to match.
  async function signup(email: string, password: string) {
    setAuthError(null);
    try {
      await apiSignup(email, password);
      window.location.reload();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not create your account.');
      throw err;
    }
  }

  async function login(email: string, password: string) {
    setAuthError(null);
    try {
      await apiLogin(email, password);
      window.location.reload();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not sign you in.');
      throw err;
    }
  }

  async function logout() {
    setAuthError(null);
    try {
      await apiLogout();
    } finally {
      // Reload regardless of whether the request itself succeeded - the
      // whole point is to guarantee no account-scoped state lingers, and
      // even if clearing the cookie server-side failed for some reason,
      // reloading at least resets every in-memory piece of state here.
      window.location.reload();
    }
  }

  function clearAuthError() {
    setAuthError(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, authError, signup, login, logout, clearAuthError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
