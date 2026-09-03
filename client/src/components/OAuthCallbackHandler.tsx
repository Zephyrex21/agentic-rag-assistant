import { useEffect, useState } from 'react';
import { setSessionToken } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AuthModal } from './auth/AuthModal';

/**
 * Renders nothing in the common case - only does anything on the one
 * render right after a completed OAuth round trip lands the browser back
 * here (see server/src/routes/oauth.js's final redirect), which shows up
 * as `#oauth_token=...` or `#oauth_error=...` in the URL hash. Mounted
 * once, globally, in App.tsx - same pattern as AccessKeyGate/GuestLimitGate
 * right next to it.
 *
 * The hash (not a query param) is deliberate: it never leaves the
 * browser - not sent to any server on the next request, not logged by
 * Vercel/any CDN/analytics the way a query param would be - for something
 * that's briefly a live bearer token.
 */
export function OAuthCallbackHandler() {
  const [open, setOpen] = useState(false);
  const { setAuthError } = useAuth();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('oauth_token');
    const error = params.get('oauth_error');
    if (!token && !error) return;

    // Stripped regardless of outcome, and BEFORE acting on it - so a
    // manual refresh a moment later never replays a stale token/error from
    // browser history, and so the reload below (on the success path)
    // doesn't just re-trigger this same effect in a loop.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (token) {
      setSessionToken(token);
      // Full reload, same as AuthContext.verifyOtp's own success path (see
      // its comment for why - guarantees no stale guest/account state
      // lingers anywhere in memory) and for consistency: this should feel
      // like the OTP flow completing, not a different mechanism.
      window.location.reload();
    } else if (error) {
      setAuthError(error);
      setOpen(true);
    }
    // Deliberately runs once on mount only - re-reading location.hash on
    // every render would re-fire this after the replaceState above anyway
    // finds nothing left to act on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthModal open={open} onOpenChange={setOpen} />;
}
