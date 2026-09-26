// Search normalisation shared by the client (Move to…, story 7) and later the server (story 11's Finder), so
// both match text the same way.

const COMBINING_MARKS = /\p{M}+/gu;
const WHITESPACE_RUN = /\s+/gu;

/**
 * Text as search compares it: compatibility-decomposed (NFKD) with combining marks stripped (so 'é' matches
 * 'e'), lower-cased without locale rules, runs of whitespace collapsed to one space, ends trimmed.
 * 'Café' -> 'cafe'; 'ÅNGSTRÖM' -> 'angstrom'; 'a   b' -> 'a b'; '' -> ''.
 */
export function normaliseForSearch(s: string): string {
  return s.normalize('NFKD').replace(COMBINING_MARKS, '').toLocaleLowerCase('und').replace(WHITESPACE_RUN, ' ').trim();
}
