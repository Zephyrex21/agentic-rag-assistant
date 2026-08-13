import { useEffect, useId, useState } from 'react';

// Lazy-loaded so mermaid's (sizeable) bundle only downloads for people who
// actually see a diagram in an answer, not on every page load - most
// answers won't have one, per the generation prompt's guidance that
// diagrams are a sparingly-used option, not a default.
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid');
  return mermaidPromise;
}

let initialized = false;
function ensureInitialized(mermaid: typeof import('mermaid')['default']) {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      // Pulled from the Ledger design tokens (index.css) so a diagram reads
      // as part of the app's own visual language, not a generic mermaid demo.
      primaryColor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
      primaryTextColor: 'var(--ink)',
      primaryBorderColor: 'var(--accent)',
      lineColor: 'var(--ink-muted)',
      secondaryColor: 'var(--surface)',
      tertiaryColor: 'var(--surface-raised)',
      fontSize: '13px',
    },
    securityLevel: 'strict',
  });
  initialized = true;
}

/**
 * Renders a mermaid code block as an actual diagram. Falls back to a plain
 * (unrendered) code block on any parse/render error - a malformed diagram
 * from the model should never break the surrounding message, it should
 * just degrade to showing the raw mermaid source, same fail-soft
 * philosophy as the rest of this codebase's LLM-output-facing code.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const rawId = useId().replace(/:/g, '-');
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    loadMermaid()
      .then(async ({ default: mermaid }) => {
        ensureInitialized(mermaid);
        const { svg: rendered } = await mermaid.render(`mermaid-${rawId}`, code.trim());
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [code, rawId]);

  if (failed) {
    return (
      <pre className="mb-3 overflow-x-auto rounded-xl bg-surface-raised p-3 font-mono text-[13px] text-ink last:mb-0">
        <code>{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return <div className="mb-3 h-28 animate-pulse rounded-xl bg-surface-raised last:mb-0" aria-label="Rendering diagram" />;
  }

  return (
    <div
      className="mb-3 flex justify-center overflow-x-auto rounded-xl border border-border bg-surface-raised p-4 last:mb-0 [&_svg]:max-w-full"
      // Safe here specifically because this HTML is mermaid's OWN sanitized
      // SVG output (securityLevel: 'strict' above), not raw model text -
      // the model only ever supplies the mermaid source text, never HTML.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
