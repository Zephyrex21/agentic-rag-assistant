export type AnswerSegment =
  | { type: 'text'; content: string }
  | { type: 'citation'; sourceNumber: number };

// Custom URL scheme markdown link parsers won't try to "fix" or normalize -
// deliberately distinct from http(s):// so there's no ambiguity with a real link.
const CITATION_SCHEME = 'citation:';

// Matches a whole citation group - a single "(Source 1)" OR a
// comma-separated group like "(Source 1, Source 3)", which the generation
// prompt explicitly asks the model to use when a claim draws on more than
// one source (see llm.js's rule 3). A single-number-only regex used to miss
// grouped citations entirely, leaving them as literal unstyled
// "(Source 1, Source 2)" text instead of badges - this matches the whole
// group so every number inside it gets converted.
const CITATION_GROUP_RE = /\(Source\s+\d+(?:\s*,\s*Source\s+\d+)*\)/gi;

function extractSourceNumbers(citationGroup: string): number[] {
  return (citationGroup.match(/\d+/g) || []).map((n) => parseInt(n, 10));
}

/**
 * Splits an answer string into alternating text/citation segments, so the
 * renderer can turn each citation group into interactive badges while
 * leaving everything else as plain text.
 *
 * @deprecated for rendering - AnswerText now uses react-markdown with
 * transformCitationsToLinks below, since answers contain real markdown
 * (headers, bold, lists) that this plain-text approach doesn't handle.
 * Kept for the standalone citation-count logic that doesn't need markdown.
 */
export function parseAnswerSegments(answer: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const regex = CITATION_GROUP_RE;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(answer)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: answer.slice(lastIndex, match.index) });
    }
    for (const num of extractSourceNumbers(match[0])) {
      segments.push({ type: 'citation', sourceNumber: num });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < answer.length) {
    segments.push({ type: 'text', content: answer.slice(lastIndex) });
  }

  return segments;
}

/**
 * Transforms "(Source 1)" - or a grouped "(Source 1, Source 2)" - into one
 * or more markdown links "[1](citation:1)" BEFORE the text is handed to
 * react-markdown. react-markdown parses these as ordinary link nodes; we
 * then override the `a` component to detect the citation: scheme and
 * render a CitationBadge instead of a real anchor tag. This is what lets
 * citations coexist with proper markdown rendering (headers, bold, lists,
 * table cells) instead of the two approaches conflicting.
 */
export function transformCitationsToLinks(answer: string): string {
  return answer.replace(CITATION_GROUP_RE, (group) =>
    extractSourceNumbers(group)
      .map((n) => `[${n}](${CITATION_SCHEME}${n})`)
      .join(' ')
  );
}

export function isCitationHref(href: string | undefined): number | null {
  if (!href || !href.startsWith(CITATION_SCHEME)) return null;
  const num = parseInt(href.slice(CITATION_SCHEME.length), 10);
  return Number.isNaN(num) ? null : num;
}
