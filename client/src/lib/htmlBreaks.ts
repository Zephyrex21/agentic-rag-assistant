import { Children, cloneElement, createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Models often write "<br>" for a line break - especially inside markdown
 * table cells, where a real newline isn't allowed. react-markdown (rightly)
 * does not render raw HTML, so the tag showed up as literal "<br>" text.
 *
 * Rather than enabling raw HTML (a new dependency and a wider security
 * surface for model-written content), this handles ONLY <br>:
 *   - inside a table row it becomes BR_TOKEN, which the table cell / paragraph
 *     / list-item components below turn into a real <br /> element;
 *   - anywhere else it becomes a normal markdown hard break ("  \n");
 *   - inside fenced code blocks and `inline code` it is left exactly as
 *     written (an answer explaining HTML must still show "<br>" literally).
 * Text containing no <br> at all is returned untouched (same string).
 */

// Private-use code point: never appears in real text, and markdown treats it
// as an ordinary character (it is not whitespace, punctuation or a `|`).
export const BR_TOKEN = '\uE000';

const BR_RE = /<br\s*\/?>/gi;

export function normalizeHtmlBreaks(markdown: string): string {
  if (!/<br/i.test(markdown)) return markdown;

  let fenceMarker: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const fence = /^\s*(```|~~~)/.exec(line);
      if (fence) {
        if (fenceMarker === null) fenceMarker = fence[1];
        else if (fence[1] === fenceMarker) fenceMarker = null;
        return line;
      }
      if (fenceMarker !== null) return line;

      const replacement = line.trimStart().startsWith('|') ? BR_TOKEN : '  \n';
      // Odd-numbered pieces are `inline code` spans - leave those alone.
      return line
        .split(/(`[^`]*`)/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(BR_RE, replacement)))
        .join('');
    })
    .join('\n');
}

/** Replaces BR_TOKEN inside rendered markdown children with real <br /> elements. */
export function renderBreaks(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      if (!child.includes(BR_TOKEN)) return child;
      return child.split(BR_TOKEN).flatMap((part, i) => (i === 0 ? [part] : [createElement('br', { key: `br-${i}` }), part]));
    }
    if (isValidElement(child)) {
      const element = child as ReactElement<{ children?: ReactNode }>;
      if (element.props.children === undefined || element.props.children === null) return child;
      return cloneElement(element, undefined, renderBreaks(element.props.children));
    }
    return child;
  });
}
