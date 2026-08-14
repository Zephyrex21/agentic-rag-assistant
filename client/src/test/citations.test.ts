import { describe, it, expect } from 'vitest';
import { parseAnswerSegments, transformCitationsToLinks, isCitationHref } from '../lib/citations';

describe('parseAnswerSegments', () => {
  it('splits text around a single citation', () => {
    const segments = parseAnswerSegments('Cryptex uses rate limiting. (Source 1)');
    expect(segments).toEqual([
      { type: 'text', content: 'Cryptex uses rate limiting. ' },
      { type: 'citation', sourceNumber: 1 },
    ]);
  });

  it('handles multiple citations in one answer', () => {
    const segments = parseAnswerSegments('It has rate limiting (Source 1) and CORS (Source 2).');
    const citationNumbers = segments.filter((s) => s.type === 'citation').map((s) => s.sourceNumber);
    expect(citationNumbers).toEqual([1, 2]);
  });

  it('returns a single text segment when there are no citations', () => {
    const segments = parseAnswerSegments("I don't have enough information to answer that.");
    expect(segments).toEqual([{ type: 'text', content: "I don't have enough information to answer that." }]);
  });

  it('handles a citation appearing at the very start of the answer', () => {
    const segments = parseAnswerSegments('(Source 1) confirms this directly.');
    expect(segments[0]).toEqual({ type: 'citation', sourceNumber: 1 });
  });

  it('tolerates extra whitespace inside the citation marker', () => {
    const segments = parseAnswerSegments('This is covered too (Source   3).');
    const citation = segments.find((s) => s.type === 'citation');
    expect(citation).toEqual({ type: 'citation', sourceNumber: 3 });
  });

  it('handles an empty string without crashing', () => {
    expect(parseAnswerSegments('')).toEqual([]);
  });

  it('splits a grouped multi-source citation into multiple citation segments', () => {
    const segments = parseAnswerSegments('This spans several sources (Source 1, Source 3).');
    const citationNumbers = segments.filter((s) => s.type === 'citation').map((s) => s.sourceNumber);
    expect(citationNumbers).toEqual([1, 3]);
  });
});

describe('transformCitationsToLinks', () => {
  it('converts a citation marker into a markdown link with the citation: scheme', () => {
    expect(transformCitationsToLinks('See (Source 2) for details.')).toBe('See [2](citation:2) for details.');
  });

  it('converts multiple citations independently', () => {
    const result = transformCitationsToLinks('(Source 1) and (Source 2)');
    expect(result).toBe('[1](citation:1) and [2](citation:2)');
  });

  it('leaves text with no citations completely unchanged', () => {
    const text = 'Plain answer with **markdown** and a [real link](https://example.com).';
    expect(transformCitationsToLinks(text)).toBe(text);
  });

  it('is case-insensitive on the word "Source"', () => {
    expect(transformCitationsToLinks('(source 5)')).toBe('[5](citation:5)');
  });

  it('converts a grouped multi-source citation into multiple badge links - the regression case', () => {
    // Before this fix, "(Source 1, Source 2)" matched nothing at all (the
    // old regex only handled a single number) and rendered as ugly literal
    // parenthetical text instead of citation badges - this is exactly the
    // shape the generation prompt asks the model to use when a claim draws
    // on more than one source (llm.js rule 3).
    const result = transformCitationsToLinks('This is covered broadly (Source 1, Source 2).');
    expect(result).toBe('This is covered broadly [1](citation:1) [2](citation:2).');
  });

  it('converts a three-way grouped citation correctly', () => {
    const result = transformCitationsToLinks('(Source 2, Source 5, Source 6)');
    expect(result).toBe('[2](citation:2) [5](citation:5) [6](citation:6)');
  });

  it('handles a mix of single and grouped citations in the same answer', () => {
    const result = transformCitationsToLinks('First point (Source 1). Second point (Source 2, Source 3).');
    expect(result).toBe('First point [1](citation:1). Second point [2](citation:2) [3](citation:3).');
  });
});

describe('isCitationHref', () => {
  it('extracts the source number from a citation: href', () => {
    expect(isCitationHref('citation:3')).toBe(3);
  });

  it('returns null for a real http(s) link', () => {
    expect(isCitationHref('https://example.com')).toBeNull();
  });

  it('returns null for undefined (react-markdown can pass this)', () => {
    expect(isCitationHref(undefined)).toBeNull();
  });

  it('returns null for a malformed citation scheme with no number', () => {
    expect(isCitationHref('citation:')).toBeNull();
  });

  it('returns null for a citation scheme with a non-numeric suffix', () => {
    expect(isCitationHref('citation:abc')).toBeNull();
  });
});
