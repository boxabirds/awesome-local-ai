const bar = 'rounded bg-muted motion-safe:animate-pulse';

// Static placeholder rows, hoisted out of render (rendering-hoist-jsx).
const skeleton = (
  <ul aria-busy="true" aria-label="Loading your workspaces" className="flex flex-col gap-2">
    {[0, 1, 2].map((i) => (
      <li key={i} data-testid="remembered-skeleton-row" className="flex h-12 items-center gap-3 px-3">
        <div className={`${bar} h-5 flex-1`} />
        <div className={`${bar} h-4 w-20`} />
      </li>
    ))}
  </ul>
);

/** Three grey rows while the remembered list loads. */
export function RememberedSkeleton() {
  return skeleton;
}
