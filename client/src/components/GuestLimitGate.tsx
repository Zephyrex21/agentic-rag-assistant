import { useEffect, useState } from 'react';
import { onGuestLimitReached } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AuthModal } from './auth/AuthModal';

/**
 * Renders nothing by default - opens (in forced mode) the moment a guest's
 * question comes back 403 GUEST_LIMIT_REACHED (see
 * server/src/middleware/guestQueryLimit.js and lib/api.ts's
 * onGuestLimitReached). Mounted once, globally, in App.tsx - same pattern as
 * AccessKeyGate right above it.
 *
 * Once open, this stays open until an actual sign-in/sign-up succeeds:
 * AuthModal's `forced` prop disables both its "Continue as guest" escape
 * hatch and Escape/outside-click dismissal. That's a UI nicety, not the
 * actual guarantee - the real backstop is that the server keeps returning
 * 403 for every further guest question regardless of what the client does,
 * so even a person who found a way to force this modal closed (or never
 * loaded this component at all) still can't get another guest answer.
 */
export function GuestLimitGate() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    return onGuestLimitReached(() => setOpen(true));
  }, []);

  // Belt-and-suspenders: if signing in ever resolves without the usual
  // full-page reload (see AuthContext's verifyOtp), don't leave a
  // forced modal stuck open in front of an now-signed-in person.
  useEffect(() => {
    if (user) setOpen(false);
  }, [user]);

  return <AuthModal open={open} onOpenChange={setOpen} forced />;
}
