// Static, hoisted out of render (rendering-hoist-jsx).
const hint = <p className="text-sm text-muted-foreground">Have a link? Open it to get back in.</p>;

/** Home with nothing remembered on this browser (first visit, or site data cleared). */
export function HomeEmptyHint() {
  return hint;
}
