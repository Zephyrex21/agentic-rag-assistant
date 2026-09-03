import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  getMe,
  logout as apiLogout,
  requestOtp as apiRequestOtp,
  verifyOtp as apiVerifyOtp,
  type AccountUser,
  type OAuthProviders,
} from '../lib/api';
import { withRetry } from '../lib/retry';

const NO_OAUTH_PROVIDERS: OAuthProviders = { google: false, github: false };

interface AuthContextValue {
  user: AccountUser | null;
  loading: boolean;
  authError: string | null;
  // null for a signed-in user; for a guest, how many free questions remain.
  // Set once from GET /api/auth/me on load, then kept live by
  // ConversationsContext feeding each answer's guestQueriesRemaining back
  // in via setGuestQueriesRemaining - see its sendMessage.
  guestQueriesRemaining: number | null;
  guestQueryLimit: number | null;
  setGuestQueriesRemaining: (remaining: number | null) => void;
  // Which "Continue with X" buttons AuthModal should actually render - see
  // getMe()'s own comment. Defaults to all-false until the initial getMe()
  // resolves, so no button flashes into existence only to disappear.
  oauthProviders: OAuthProviders;
  requestOtp: (email: string) => Promise<{ expiresInSeconds: number }>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  // Public setter, not just clearAuthError - lets OAuthCallbackHandler.tsx
  // surface a provider-side failure (e.g. "sign-in was cancelled") the
  // same way a failed OTP attempt does, without that component needing
  // its own separate error-display mechanism.
  setAuthError: (message: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [guestQueriesRemaining, setGuestQueriesRemaining] = useState<number | null>(null);
  const [guestQueryLimit, setGuestQueryLimit] = useState<number | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviders>(NO_OAUTH_PROVIDERS);

  useEffect(() => {
    // One retry after a short delay - same startup-race smoothing every
    // other boot-time fetch in this app uses (see lib/retry.ts). A guest
    // (no session cookie) resolves to user: null here just as validly as
    // an actual failure would look, so there's nothing further to surface
    // to the person if this never succeeds - it just quietly stays a guest.
    withRetry(getMe)
      .then(({ user, guestQueriesRemaining, guestQueryLimit, oauthProviders }) => {
        setUser(user);
        setGuestQueriesRemaining(guestQueriesRemaining);
        setGuestQueryLimit(guestQueryLimit);
        setOauthProviders(oauthProviders ?? NO_OAUTH_PROVIDERS);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Step 1 of OTP sign-in - sends a fresh 6-digit code to this email (see
  // server/src/routes/auth.js's /otp/request). Never creates an account by
  // itself and never says whether this email already has one - that only
  // happens (implicitly) on a successful verifyOtp below, so there's
  // nothing here for an attacker to enumerate.
  async function requestOtp(email: string) {
    setAuthError(null);
    try {
      const { expiresInSeconds } = await apiRequestOtp(email);
      return { expiresInSeconds };
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not send a code to that email.');
      throw err;
    }
  }

  // Step 2 - deliberately a full reload on success, rather than trying to
  // refetch every piece of state (documents, conversations, active thread,
  // cached content) by hand. This is a security boundary, not just a UI
  // refresh - a full reload guarantees there is no possible leftover state
  // from a different account/guest session anywhere in memory, which
  // piecemeal refetching would need to get perfectly right in every
  // context to match. OAuthCallbackHandler.tsx's success path follows the
  // exact same reload pattern for the same reason.
  async function verifyOtp(email: string, code: string) {
    setAuthError(null);
    try {
      await apiVerifyOtp(email, code);
      window.location.reload();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'That code didn\'t work.');
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
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        guestQueriesRemaining,
        guestQueryLimit,
        setGuestQueriesRemaining,
        oauthProviders,
        requestOtp,
        verifyOtp,
        logout,
        clearAuthError,
        setAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
