export type AnswerSegment =
  | { type: 'text'; content: string }
  | { type: 'citation'; sourceNumber: number };

/**
 * Splits an answer string into alternating text/citation segments, so the
 * renderer can turn each "(Source N)" into an interactive badge while
 * leaving everything else as plain text.
 *
 * @deprecated for rendering - AnswerText now uses react-markdown with
 * transformCitationsToLinks below, since answers contain real markdown
 * (headers, bold, lists) that this plain-text approach doesn't handle.
 * Kept for the standalone citation-count logic that doesn't need markdown.
 */
export function parseAnswerSegments(answer: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const regex = /\(Source\s+(\d+)\)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(answer)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: answer.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'citation', sourceNumber: parseInt(match[1], 10) });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < answer.length) {
    segments.push({ type: 'text', content: answer.slice(lastIndex) });
  }

  return segments;
}

// Custom URL scheme markdown link parsers won't try to "fix" or normalize -
// deliberately distinct from http(s):// so there's no ambiguity with a real link.
const CITATION_SCHEME = 'citation:';

/**
 * Transforms "(Source 1)" into a markdown link "[1](citation:1)" BEFORE the
 * text is handed to react-markdown. react-markdown parses this as an
 * ordinary link node; we then override the `a` component to detect the
 * citation: scheme and render a CitationBadge instead of a real anchor tag.
 * This is what lets citations coexist with proper markdown rendering
 * (headers, bold, lists) instead of the two approaches conflicting.
 */
export function transformCitationsToLinks(answer: string): string {
  return answer.replace(/\(Source\s+(\d+)\)/gi, (_match, num) => `[${num}](${CITATION_SCHEME}${num})`);
}

export function isCitationHref(href: string | undefined): number | null {
  if (!href || !href.startsWith(CITATION_SCHEME)) return null;
  const num = parseInt(href.slice(CITATION_SCHEME.length), 10);
  return Number.isNaN(num) ? null : num;
}
