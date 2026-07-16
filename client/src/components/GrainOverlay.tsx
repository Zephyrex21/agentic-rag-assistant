/**
 * A fixed, full-viewport, very low-opacity noise texture. Applied once at
 * the app root. This is the kind of detail that's easy to overdo - kept
 * deliberately subtle (2-3% opacity) so it reads as "premium paper grain"
 * rather than a visible visual artifact.
 */
export function GrainOverlay() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 z-[9999] h-full w-full opacity-[0.025] mix-blend-overlay"
      aria-hidden="true"
    >
      <filter id="grain-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain-noise)" />
    </svg>
  );
}
