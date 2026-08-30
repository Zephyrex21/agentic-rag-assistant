import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, LogIn, UserPlus, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Guest mode needs none of this - this modal is purely opt-in, reachable
 * from Sidebar's "Sign in" affordance. Signing up/in scopes future
 * documents/conversations to the new account (see server/src/routes/auth.js);
 * everything already in the guest pool stays exactly where it was, visible
 * again the moment someone logs back out.
 */
export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, signup, authError, clearAuthError } = useAuth();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await signup(email.trim(), password);
      // On success, login/signup reload the page - nothing left to do here.
    } catch {
      setSubmitting(false); // stays open so the person can see authError and retry
    }
  };

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next);
    clearAuthError();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="signal-theme font-signal-body fixed left-1/2 top-[16vh] z-[101] w-[92vw] max-w-sm -translate-x-1/2 rounded-2xl p-6"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-xl)' }}
              >
                <Dialog.Title className="font-signal-display text-2xl italic text-ink">
                  {mode === 'login' ? 'Welcome back' : 'Create an account'}
                </Dialog.Title>
                <p className="mt-1.5 text-[13px] text-ink-muted">
                  {mode === 'login'
                    ? 'Sign in to see your own documents and conversation history.'
                    : 'Your documents and conversations stay private to your account.'}
                </p>

                <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
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
                  <div className="relative">
                    <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
                    <input
                      type="password"
                      required
                      minLength={mode === 'signup' ? 8 : undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'signup' ? 'Password (min. 8 characters)' : 'Password'}
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
                    disabled={submitting || !email.trim() || !password}
                    className="mt-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-medium text-accent-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
                  >
                    {mode === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
                    {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                </form>

                <p className="mt-4 text-center text-[13px] text-ink-muted">
                  {mode === 'login' ? (
                    <>
                      Don't have an account?{' '}
                      <button type="button" onClick={() => switchMode('signup')} className="cursor-pointer font-medium text-accent">
                        Sign up
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <button type="button" onClick={() => switchMode('login')} className="cursor-pointer font-medium text-accent">
                        Sign in
                      </button>
                    </>
                  )}
                </p>

                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-3 w-full cursor-pointer text-center text-[12px] text-ink-muted hover:text-ink"
                >
                  Continue as guest
                </button>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
