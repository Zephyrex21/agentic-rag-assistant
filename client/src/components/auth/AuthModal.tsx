import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ShieldCheck, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 45; // mirrors server/src/routes/auth.js's RESEND_COOLDOWN_MS

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When true: no "Continue as guest" escape hatch, and Escape/outside-click
  // no longer close the modal - used when a guest has hit the free-question
  // limit (see GuestLimitGate.tsx) and signing in is no longer optional for
  // that session. Purely a UI presentation choice - the actual enforcement
  // lives server-side (guestQueryLimit.js keeps blocking with a 403
  // regardless of what the client does), so this never needs to be treated
  // as a security boundary on its own.
  forced?: boolean;
}

/**
 * Passwordless: two steps, always the same two steps whether this is
 * someone's first time or their hundredth - request a code, enter the
 * code. There's no separate "sign up" flow because there's no password to
 * set; a first-time email's successful verify transparently becomes an
 * account server-side (see server/src/routes/auth.js's /otp/verify).
 *
 * Guest mode needs none of this - this modal is purely opt-in, reachable
 * from Sidebar's "Sign in" affordance (or forced open by GuestLimitGate).
 * Signing in scopes future documents/conversations to the account;
 * everything already in the guest pool stays exactly where it was, visible
 * again the moment someone logs back out.
 */
export function AuthModal({ open, onOpenChange, forced = false }: AuthModalProps) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { requestOtp, verifyOtp, authError, clearAuthError } = useAuth();

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
  // step one with a clean slate - carrying over a half-entered code from a
  // previous attempt would be confusing, not convenient.
  useEffect(() => {
    if (open) {
      setStep('email');
      setDigits(Array(CODE_LENGTH).fill(''));
      setResendCooldown(0);
    }
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

  // When forced, swallow the interactions Radix's Dialog would otherwise
  // use to close itself - the only way out is actually signing in.
  const preventIfForced = (e: { preventDefault: () => void }) => {
    if (forced) e.preventDefault();
  };

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
                      {forced ? "You're out of free questions" : 'Sign in'}
                    </Dialog.Title>
                    <p className="mt-1.5 text-[13px] text-ink-muted">
                      {forced
                        ? "Guest mode is limited to a couple of questions. Enter your email and we'll send you a one-time code - your guest history stays right where it is."
                        : "No password to remember - enter your email and we'll send you a 6-digit code."}
                    </p>

                    <form onSubmit={sendCode} className="mt-5 flex flex-col gap-3">
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
                    <p className="mt-1.5 text-[13px] text-ink-muted">
                      We sent a 6-digit code to <span className="text-ink">{email.trim()}</span>. It expires in 10 minutes.
                    </p>

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
