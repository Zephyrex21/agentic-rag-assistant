import { describe, it, expect } from 'vitest';
import { normalizeHtmlBreaks, BR_TOKEN } from '../lib/htmlBreaks';

describe('normalizeHtmlBreaks', () => {
  it('returns text with no <br> completely untouched (the same string) - the path almost every answer takes', () => {
    const text = '# Title\n\nSome **bold** text.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```';
    expect(normalizeHtmlBreaks(text)).toBe(text);
  });

  it('turns a <br> inside a table row into the placeholder token (a real newline would break the row)', () => {
    const out = normalizeHtmlBreaks('| Objectives | Text one<br>Text two |');
    expect(out).toBe(`| Objectives | Text one${BR_TOKEN}Text two |`);
    expect(out).not.toContain('\n');
  });

  it('accepts every common spelling: <br>, <br/>, <br />, <BR>', () => {
    for (const tag of ['<br>', '<br/>', '<br />', '<BR>', '<Br  />']) {
      expect(normalizeHtmlBreaks(`| a${tag}b |`)).toBe(`| a${BR_TOKEN}b |`);
    }
  });

  it('turns a <br> outside a table into a markdown hard break', () => {
    expect(normalizeHtmlBreaks('line one<br>line two')).toBe('line one  \nline two');
  });

  it('leaves <br> inside a fenced code block exactly as written', () => {
    const text = 'Use this:\n\n```html\n<p>one<br>two</p>\n```\n\nafter<br>that';
    expect(normalizeHtmlBreaks(text)).toBe('Use this:\n\n```html\n<p>one<br>two</p>\n```\n\nafter  \nthat');
  });

  it('leaves <br> inside inline `code` exactly as written, even in a table row', () => {
    expect(normalizeHtmlBreaks('| tag | use `<br>` for breaks<br>second |')).toBe(`| tag | use \`<br>\` for breaks${BR_TOKEN}second |`);
  });

  it('handles multiple <br> in one cell and several rows', () => {
    // Row one has two <br>, row two has one.
    const out = normalizeHtmlBreaks('| a | 1<br>2<br>3 |\n| b | 4<br>5 |');
    expect(out.split(BR_TOKEN).length - 1).toBe(3);
    expect(out).not.toMatch(/<br/i);
  });

  it('does not touch other HTML-looking text (only <br> is handled)', () => {
    const text = 'A <b>tag</b> and <br-like> and a < b comparison';
    expect(normalizeHtmlBreaks(text)).toBe(text);
  });
});
