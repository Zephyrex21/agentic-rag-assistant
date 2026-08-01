/**
 * Two large, very soft, blurred gradient blobs that slowly drift behind
 * everything - one in the accent (verdigris) color, one in the highlight
 * (rust) color, echoing the two-accent citation/verification system the
 * rest of the UI uses. Pure CSS animation (see index.css) so it's cheap
 * and never re-renders. Mounted once at the app root, behind both the
 * Hero and the main app, so it never resets/flickers when switching views.
 */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div
        className="ambient-blob absolute left-[10%] top-[-10%] h-[60vmax] w-[60vmax] rounded-full opacity-[0.10] dark:opacity-[0.16]"
        style={{
          background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)',
          filter: 'blur(60px)',
          animation: 'drift-a 46s ease-in-out infinite',
        }}
      />
      <div
        className="ambient-blob absolute bottom-[-15%] right-[5%] h-[55vmax] w-[55vmax] rounded-full opacity-[0.08] dark:opacity-[0.14]"
        style={{
          background: 'radial-gradient(circle, var(--highlight) 0%, transparent 70%)',
          filter: 'blur(70px)',
          animation: 'drift-b 55s ease-in-out infinite',
        }}
      />
    </div>
  );
}
