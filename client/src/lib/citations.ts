export type AnswerSegment =
  | { type: 'text'; content: string }
  | { type: 'citation'; sourceNumber: number };

// Custom URL scheme markdown link parsers won't try to "fix" or normalize -
// deliberately distinct from http(s):// so there's no ambiguity with a real link.
const CITATION_SCHEME = 'citation:';

// Matches a whole citation group. Accepts the shapes the generation prompt
// asks for - a single "(Source 1)" OR a comma-separated "(Source 1, Source 3)"
// (see llm.js's rule 3) - plus the variants models produce anyway:
// "(Sources 1, 2)", "(Sources 1 and 2)", and ranges like "(Sources 1-3)"
// (also with an en/em dash or "to"). A single-number-only regex used to miss
// grouped citations entirely, and a "Source"-singular-only one still missed
// "(Sources 1-3)" - both left literal unstyled "(Sources 1-3)" text in the
// answer instead of badges. This matches the whole group so every number
// inside it gets converted.
// NOTE: server/src/services/rag.js keeps its own copy of this pattern (it
// decides which sources count as "cited") - keep the two in step.
const CITATION_GROUP_RE = /\(Sources?\s+\d+(?:\s*(?:,|&|and|-|\u2013|\u2014|to)\s*(?:Sources?\s+)?\d+)*\)/gi;

// A range like 1-3 expands to 1,2,3. Capped so a malformed "(Sources 1-999)"
// can never flood the answer with hundreds of badges.
const MAX_CITATION_RANGE = 12;

function extractSourceNumbers(citationGroup: string): number[] {
  const numbers: number[] = [];
  const re = /(\d+)(?:\s*(?:-|\u2013|\u2014|\bto\b)\s*(?:Sources?\s+)?(\d+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(citationGroup)) !== null) {
    const start = parseInt(m[1], 10);
    if (m[2] === undefined) {
      numbers.push(start);
      continue;
    }
    const end = parseInt(m[2], 10);
    if (end >= start && end - start < MAX_CITATION_RANGE) {
      for (let n = start; n <= end; n++) numbers.push(n);
    } else {
      numbers.push(start, end);
    }
  }
  return numbers;
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
