import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidElement } from 'react';
import type { Components } from 'react-markdown';
import { transformCitationsToLinks, isCitationHref } from '../../lib/citations';
import { CitationBadge } from './CitationBadge';
import { MermaidDiagram } from './MermaidDiagram';
import type { Source } from '../../lib/types';

/**
 * react-markdown sanitizes link URLs against a small protocol allowlist
 * (http/https/irc/mailto/xmpp) by default and silently empties anything
 * else - including our custom "citation:" scheme. Without this override,
 * every citation link renders as a dead `href=""` anchor that LOOKS like a
 * numbered link (same underline styling) but does nothing when clicked -
 * an easy bug to miss visually since the broken state isn't obviously
 * broken. Caught by an automated test, not by eye.
 */
function urlTransform(url: string): string {
  return isCitationHref(url) !== null ? url : defaultUrlTransform(url);
}

export function AnswerText({
  content,
  sources,
  animateCitations = true,
}: {
  content: string;
  sources?: Source[] | null;
  animateCitations?: boolean;
}) {
  const sourceByNumber = new Map((sources || []).map((s) => [s.sourceNumber, s]));
  const transformed = transformCitationsToLinks(content);

  const components: Components = {
    // Citation links get intercepted here; a genuine external link (unlikely
    // given our prompt constraints, but handled gracefully) renders normally.
    a: ({ href, children }) => {
      const citationNumber = isCitationHref(href);
      if (citationNumber !== null) {
        return <CitationBadge source={sourceByNumber.get(citationNumber)} animate={animateCitations} />;
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
          {children}
        </a>
      );
    },
    h1: ({ children }) => <h3 className="mb-2 mt-4 font-serif text-xl text-ink first:mt-0">{children}</h3>,
    h2: ({ children }) => <h4 className="mb-2 mt-4 font-serif text-lg text-ink first:mt-0">{children}</h4>,
    h3: ({ children }) => <h5 className="mb-1.5 mt-3 text-[15px] font-semibold text-ink first:mt-0">{children}</h5>,
    p: ({ children }) => <p className="mb-3 text-[15px] leading-relaxed text-ink last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => <ul className="mb-3 ml-1 list-disc space-y-1 pl-4 text-[15px] text-ink last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-3 ml-1 list-decimal space-y-1 pl-4 text-[15px] text-ink last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    code: ({ className, children }) => {
      // Fenced ```mermaid blocks get rendered as an actual diagram instead
      // of a plain code block - inline code (no className) and every other
      // fenced language fall through to the normal styling below.
      if (typeof className === 'string' && className.includes('language-mermaid')) {
        return <MermaidDiagram code={String(children)} />;
      }
      return <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>;
    },
    pre: ({ children }) => {
      // A mermaid code block's own `code` override above already renders a
      // fully-styled diagram container - skip the monospace <pre> box in
      // that one case so a diagram isn't nested inside code-block chrome.
      const soleChild = Array.isArray(children) ? children[0] : children;
      const isMermaidBlock =
        isValidElement(soleChild) &&
        typeof (soleChild.props as { className?: string }).className === 'string' &&
        (soleChild.props as { className: string }).className.includes('language-mermaid');
      if (isMermaidBlock) return <>{children}</>;
      return (
        <pre className="mb-3 overflow-x-auto rounded-xl bg-surface-raised p-3 font-mono text-[13px] text-ink last:mb-0">
          {children}
        </pre>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="mb-3 border-l-2 border-accent/40 pl-3 text-ink-muted last:mb-0">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-border" />,
    table: ({ children }) => (
      <div className="mb-3 overflow-x-auto last:mb-0">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-border px-2 py-1.5 text-left font-semibold text-ink">{children}</th>,
    td: ({ children }) => <td className="border-b border-border px-2 py-1.5 text-ink">{children}</td>,
  };

  return (
    <div className="max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
