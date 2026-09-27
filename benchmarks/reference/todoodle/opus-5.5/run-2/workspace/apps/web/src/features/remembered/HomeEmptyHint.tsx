export const EMPTY_HINT = 'Have a link? Open it to get back in.';

const hint = <p className="text-muted-foreground">{EMPTY_HINT}</p>;

/** First visit (or cleared site data): the only way back into an existing workspace is its link. */
export function HomeEmptyHint() {
  return hint;
}
