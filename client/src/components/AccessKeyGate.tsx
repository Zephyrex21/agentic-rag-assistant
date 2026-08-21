import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound } from 'lucide-react';
import { getAccessKey, onAccessRequired, setAccessKey } from '../lib/api';

/**
 * Renders nothing by default - this only appears when the backend has
 * APP_ACCESS_KEY set AND a request came back 401 (see
 * lib/api.ts's onAccessRequired/notifyAccessRequired). For a local dev
 * setup, or any deployment that hasn't opted into the access key, this
 * component is permanently invisible and inert - no polling, no
 * pre-flight check, nothing that could slow down or block normal use.
 *
 * On submit, the entered key is stored in localStorage and every
 * subsequent request (see authHeaders() in lib/api.ts) picks it up
 * automatically - whatever the person was doing when the 401 happened
 * (sending a message, uploading a document) can just be retried once the
 * modal closes.
 */
export function AccessKeyGate() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    return onAccessRequired(() => setOpen(true));
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setAccessKey(trimmed);
    setValue('');
    setOpen(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 3000);
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[300] flex items-center justify-center p-4"
            style={{ background: 'color-mix(in srgb, var(--ink) 45%, transparent)' }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-sm rounded-2xl border p-6 shadow-xl"
              style={{ background: 'var(--surface)', borderColor: 'var(--border-color)' }}
            >
              <div className="mb-3 flex items-center gap-2.5 text-accent">
                <KeyRound size={18} />
                <h2 className="text-[15px] font-semibold text-ink">Access key required</h2>
              </div>
              <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
                This assistant is protected by an access key. Enter it below to continue - it's remembered on this
                device for next time.
              </p>
              <form onSubmit={submit} className="flex flex-col gap-3">
                <input
                  type="password"
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  defaultValue={getAccessKey()}
                  placeholder="Access key"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:outline-none"
                  style={{ boxShadow: 'none' }}
                  onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)')}
                  onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
                />
                <button
                  type="submit"
                  disabled={!value.trim()}
                  className="w-full rounded-xl py-2.5 text-[14px] font-medium text-accent-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
                >
                  Continue
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {justSaved && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-full px-4 py-2 text-xs shadow-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', color: 'var(--ink-muted)' }}
          >
            Access key saved — please retry your last action.
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
