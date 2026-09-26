import { normaliseForSearch } from '@todoodle/shared/search';
import { memo } from 'react';

/**
 * Where `query` matches `text` under normaliseForSearch, as [start, end) in `text`'s own indexes, or null.
 * Each character is normalised on its own, so an index map leads back from the normalised text.
 */
export function matchRange(text: string, query: string): [number, number] | null {
  const needle = normaliseForSearch(query);
  if (needle === '') return null;
  let normalised = '';
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    // Single characters: no whitespace collapsing, so a space stays one space.
    const part = char.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase('und');
    for (let i = 0; i < part.length; i++) origin.push(index);
    normalised += part;
    index += char.length;
  }
  const at = normalised.indexOf(needle);
  if (at === -1) return null;
  const start = origin[at]!;
  const lastOrigin = origin[at + needle.length - 1]!;
  const end = lastOrigin + (text.codePointAt(lastOrigin)! > 0xffff ? 2 : 1);
  return [start, end];
}

/**
 * `text` with the part matching `query` wrapped in <mark> (bold plus a background, so the match never relies
 * on colour alone). Shared by Move to… and story 11's Finder.
 */
export const HighlightedText = memo(function HighlightedText({ text, query }: { text: string; query: string }) {
  const range = matchRange(text, query);
  if (!range) return <>{text}</>;
  const [start, end] = range;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-muted font-semibold text-foreground">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
});
