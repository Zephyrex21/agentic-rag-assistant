/**
 * Abstract mark built from a quotation-mark motif (since citations are the
 * app's whole signature element) rendered in the accent gradient. Simple
 * and geometric so it reads cleanly at small sizes.
 */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="var(--color-highlight)" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="7" fill="url(#logo-gradient)" opacity="0.14" />
      <path
        d="M8.2 15.6c1.4 0 2.4-1.15 2.4-2.65 0-1.3-0.95-2.35-2.15-2.35-0.25 0-0.45 0.03-0.65 0.08 0.2-1.2 1.1-2.25 2.4-2.7l-0.5-1.05C7.6 7.6 6.1 9.5 6.1 11.9c0 2.25 0.95 3.7 2.1 3.7Zm7.2 0c1.4 0 2.4-1.15 2.4-2.65 0-1.3-0.95-2.35-2.15-2.35-0.25 0-0.45 0.03-0.65 0.08 0.2-1.2 1.1-2.25 2.4-2.7l-0.5-1.05c-2.15 0.7-3.65 2.6-3.65 5 0 2.25 0.95 3.7 2.15 3.7Z"
        fill="url(#logo-gradient)"
      />
    </svg>
  );
}
