import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { transformCitationsToLinks, isCitationHref } from '../../lib/citations';
import { CitationBadge } from './CitationBadge';
import type { Source } from '../../lib/types';

export function AnswerText({ content, sources }: { content: string; sources?: Source[] | null }) {
  const sourceByNumber = new Map((sources || []).map((s) => [s.sourceNumber, s]));
  const transformed = transformCitationsToLinks(content);

  const components: Components = {
    // Citation links get intercepted here; a genuine external link (unlikely
    // given our prompt constraints, but handled gracefully) renders normally.
    a: ({ href, children }) => {
      const citationNumber = isCitationHref(href);
      if (citationNumber !== null) {
        return <CitationBadge source={sourceByNumber.get(citationNumber)} />;
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
    code: ({ children }) => (
      <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>
    ),
    pre: ({ children }) => (
      <pre className="mb-3 overflow-x-auto rounded-xl bg-surface-raised p-3 font-mono text-[13px] text-ink last:mb-0">
        {children}
      </pre>
    ),
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
