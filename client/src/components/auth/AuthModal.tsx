import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ShieldCheck, AlertCircle, ArrowLeft, Coffee } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getOAuthUrl } from '../../lib/api';
import { GoogleIcon, GithubIcon } from '../icons/BrandIcons';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 45; // mirrors server/src/routes/auth.js's RESEND_COOLDOWN_MS
// Same idea and same default as ConversationsContext.tsx's cold-start
// detection (see ColdStartNotice.tsx) - a request taking meaningfully
// longer than a warm server ever would, without yet being an outright
// failure, most likely means Render's free tier is waking a spun-down
// instance back up. Read lazily (a function, not a module-level const) so
// a test's vi.stubEnv override is picked up when the effect runs, not
// captured too early at import time.
function getColdStartThresholdMs() {
  return Number(import.meta.env.VITE_COLD_START_THRESHOLD_MS) || 2500;
}

export type AuthMode = 'signin' | 'signup';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Which of the two entry points opened the modal - purely a copy/label
  // choice (see MODE_COPY below). The underlying request/verify calls are
  // byte-for-byte identical either way: there's no separate "create
  // account" endpoint, because a first-time email's successful verify
  // transparently becomes an account server-side (see
  // server/src/routes/auth.js's /otp/verify). A person can freely switch
  // between the two via the toggle link at the bottom of step one - it
  // only changes what's on screen, never what request gets sent.
  initialMode?: AuthMode;
  // When true: no "Continue as guest" escape hatch, and Escape/outside-click
  // no longer close the modal - used when a guest has hit the free-question
  // limit (see GuestLimitGate.tsx) and signing in is no longer optional for
  // that session. Purely a UI presentation choice - the actual enforcement
  // lives server-side (guestQueryLimit.js keeps blocking with a 403
  // regardless of what the client does), so this never needs to be treated
  // as a security boundary on its own.
  forced?: boolean;
}

const MODE_COPY: Record<AuthMode, { title: string; subtitle: string; codeSubtitle: (email: string) => string; toggleLabel: string }> = {
  signin: {
    title: 'Sign in',
    subtitle: "No password to remember - enter your email and we'll send you a 6-digit code.",
    codeSubtitle: (email) => `We sent a 6-digit code to ${email}. It expires in 10 minutes.`,
    toggleLabel: 'New here? Create an account',
  },
  signup: {
    title: 'Create your account',
    subtitle: "No password to set - enter your email and we'll send a 6-digit code to verify it.",
    codeSubtitle: (email) => `We sent a 6-digit code to ${email} to finish creating your account.`,
    toggleLabel: 'Already have an account? Sign in',
  },
};

/**
 * Passwordless, and deliberately ONE flow under the hood (request a code,
 * verify it) - but presented as the two entry points people expect (Sign
 * in / Sign up), toggleable from either side, since that's the mental
 * model most people bring in even when the backend has no reason to
 * distinguish them. See MODE_COPY above for exactly what differs (labels
 * only) and server/src/routes/auth.js for why nothing else needs to.
 *
 * Guest mode needs none of this - this modal is purely opt-in, reachable
 * from Sidebar's "Sign in"/"Sign up" affordances (or forced open by
 * GuestLimitGate). Signing in scopes future documents/conversations to the
 * account; everything already in the guest pool stays exactly where it
 * was, visible again the moment someone logs back out.
 */
export function AuthModal({ open, onOpenChange, initialMode = 'signin', forced = false }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [isColdStarting, setIsColdStarting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { requestOtp, verifyOtp, authError, clearAuthError, oauthProviders } = useAuth();

  // Arms only while a request is actually in flight - see apiFetch's own
  // 75s hard timeout in lib/api.ts for what happens if this never
  // resolves at all. This is purely the "still waiting, and here's
  // probably why" reassurance in between: without it, the button just
  // reads "Sending..."/"Verifying..." with zero explanation for however
  // long a real cold start takes.
  useEffect(() => {
    if (!submitting) {
      setIsColdStarting(false);
      return;
    }
    const timer = setTimeout(() => setIsColdStarting(true), getColdStartThresholdMs());
    return () => clearTimeout(timer);
  }, [submitting]);

  // Counts down once a code has been sent - blocks a second /otp/request
  // for the same email before the server's own cooldown would reject it
  // anyway (see RESEND_COOLDOWN_SECONDS above), so "Resend code" simply
  // isn't clickable during that window instead of round-tripping to a 429.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Every open (including a re-open after a previous close) starts back at
  // step one, in whichever mode it was opened with, with a clean slate -
  // carrying over a half-entered code or a stale mode from a previous
  // attempt would be confusing, not convenient.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setStep('email');
      setDigits(Array(CODE_LENGTH).fill(''));
      setResendCooldown(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await requestOtp(email.trim());
      setDigits(Array(CODE_LENGTH).fill(''));
      setStep('code');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setTimeout(() => digitRefs.current[0]?.focus(), 50);
    } catch {
      // authError is already set by requestOtp - stays on step 'email' so
      // the person can see it and fix the address.
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async (code: string) => {
    if (code.length !== CODE_LENGTH || submitting) return;
    setSubmitting(true);
    try {
      await verifyOtp(email.trim(), code);
      // On success, verifyOtp reloads the page - nothing left to do here.
    } catch {
      setSubmitting(false); // stays open so the person can see authError and retry
      setDigits(Array(CODE_LENGTH).fill(''));
      digitRefs.current[0]?.focus();
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    const clean = value.replace(/\D/g, '');
    if (!clean) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }
    const next = [...digits];
    next[index] = clean[clean.length - 1]; // last typed char wins if more than one somehow lands here
    setDigits(next);
    if (index < CODE_LENGTH - 1) digitRefs.current[index + 1]?.focus();
    if (next.every((d) => d !== '')) submitCode(next.join(''));
  };

  const handleDigitKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(CODE_LENGTH).fill('');
    pasted.split('').forEach((d, i) => (next[i] = d));
    setDigits(next);
    const lastFilled = Math.min(pasted.length, CODE_LENGTH) - 1;
    digitRefs.current[lastFilled]?.focus();
    if (pasted.length === CODE_LENGTH) submitCode(pasted);
  };

  const goBackToEmail = () => {
    setStep('email');
    setDigits(Array(CODE_LENGTH).fill(''));
    clearAuthError();
  };

  const toggleMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    clearAuthError();
  };

  // When forced, swallow the interactions Radix's Dialog would otherwise
  // use to close itself - the only way out is actually signing in.
  const preventIfForced = (e: { preventDefault: () => void }) => {
    if (forced) e.preventDefault();
  };

  const copy = MODE_COPY[mode];

  return (
    <Dialog.Root open={open} onOpenChange={forced ? undefined : onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="signal-theme fixed inset-0 z-[100] bg-overlay"
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              aria-describedby={undefined}
              onEscapeKeyDown={preventIfForced}
              onPointerDownOutside={preventIfForced}
              onInteractOutside={preventIfForced}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="signal-theme font-signal-body fixed left-1/2 top-[16vh] z-[101] w-[92vw] max-w-sm -translate-x-1/2 rounded-2xl p-6"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-xl)' }}
              >
                {step === 'email' ? (
                  <>
                    <Dialog.Title className="font-signal-display text-2xl italic text-ink">
                      {forced ? "You're out of free questions" : copy.title}
                    </Dialog.Title>
                    <p className="mt-1.5 text-[13px] text-ink-muted">
                      {forced
                        ? "Guest mode is limited to a couple of questions. Enter your email and we'll send you a one-time code - your guest history stays right where it is."
                        : copy.subtitle}
                    </p>

                    {(oauthProviders.google || oauthProviders.github) && (
                      <>
                        <div className="mt-5 flex flex-col gap-2">
                          {oauthProviders.google && (
                            <button
                              type="button"
                              onClick={() => (window.location.href = getOAuthUrl('google'))}
                              className="flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-border bg-background py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-surface"
                            >
                              <GoogleIcon size={16} />
                              Continue with Google
                            </button>
                          )}
                          {oauthProviders.github && (
                            <button
                              type="button"
                              onClick={() => (window.location.href = getOAuthUrl('github'))}
                              className="flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-border bg-background py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-surface"
                            >
                              <GithubIcon size={16} />
                              Continue with GitHub
                            </button>
                          )}
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[11px] uppercase tracking-wide text-ink-muted">or</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      </>
                    )}

                    <form onSubmit={sendCode} className="mt-4 flex flex-col gap-3">
                      <div className="relative">
                        <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
                        <input
                          type="email"
                          autoFocus
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Email"
                          className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-3.5 text-[14px] text-ink placeholder:text-ink-muted focus:outline-none"
                          onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)')}
                          onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
                        />
                      </div>

                      {authError && (
                        <div
                          className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] text-highlight"
                          style={{ background: 'color-mix(in srgb, var(--highlight) 8%, transparent)' }}
                        >
                          <AlertCircle size={13} className="mt-0.5 shrink-0" />
                          {authError}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={submitting || !email.trim()}
                        className="mt-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-medium text-accent-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
                      >
                        <Mail size={15} />
                        {submitting ? 'Sending...' : 'Send code'}
                      </button>
                    </form>

                    {isColdStarting && (
                      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-ink-muted">
                        <Coffee size={12} className="shrink-0" />
                        Waking up the server - free hosting naps when idle, this can take up to a minute.
                      </p>
                    )}

                    <p className="mt-4 text-center text-[13px] text-ink-muted">
                      <button type="button" onClick={toggleMode} className="cursor-pointer font-medium text-accent">
                        {copy.toggleLabel}
                      </button>
                    </p>

                    {!forced && (
                      <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="mt-3 w-full cursor-pointer text-center text-[12px] text-ink-muted hover:text-ink"
                      >
                        Continue as guest
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={goBackToEmail}
                      className="mb-3 flex cursor-pointer items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
                    >
                      <ArrowLeft size={12} />
                      Change email
                    </button>

                    <Dialog.Title className="font-signal-display text-2xl italic text-ink">Enter your code</Dialog.Title>
                    <p className="mt-1.5 text-[13px] text-ink-muted">{copy.codeSubtitle(email.trim())}</p>

                    <div className="mt-5 flex justify-between gap-2">
                      {digits.map((d, i) => (
                        <input
                          key={i}
                          ref={(el) => { digitRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          autoComplete={i === 0 ? 'one-time-code' : 'off'}
                          maxLength={1}
                          value={d}
                          autoFocus={i === 0}
                          disabled={submitting}
                          onChange={(e) => handleDigitChange(i, e.target.value)}
                          onKeyDown={(e) => handleDigitKeyDown(i, e)}
                          onPaste={handlePaste}
                          className="size-11 rounded-xl border border-border bg-background text-center text-[18px] font-medium text-ink focus:outline-none disabled:opacity-50"
                          onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)')}
                          onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
                        />
                      ))}
                    </div>

                    {authError && (
                      <div
                        className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] text-highlight"
                        style={{ background: 'color-mix(in srgb, var(--highlight) 8%, transparent)' }}
                      >
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        {authError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => submitCode(digits.join(''))}
                      disabled={submitting || digits.some((d) => !d)}
                      className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-medium text-accent-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
                    >
                      <ShieldCheck size={15} />
                      {submitting ? 'Verifying...' : 'Verify & continue'}
                    </button>

                    {isColdStarting && (
                      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-ink-muted">
                        <Coffee size={12} className="shrink-0" />
                        Waking up the server - free hosting naps when idle, this can take up to a minute.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => sendCode()}
                      disabled={resendCooldown > 0 || submitting}
                      className="mt-3 w-full cursor-pointer text-center text-[12px] text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Didn't get it? Resend code"}
                    </button>
                  </>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
