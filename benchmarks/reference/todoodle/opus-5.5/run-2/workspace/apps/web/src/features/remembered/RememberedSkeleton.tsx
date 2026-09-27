const row = (
  <li className="flex flex-col gap-2 rounded-md px-3 py-2">
    <div className="skeleton-shimmer h-5 w-40 rounded bg-muted" />
    <div className="skeleton-shimmer h-4 w-24 rounded bg-muted" />
  </li>
);

const skeleton = (
  <ul aria-busy="true" aria-label="Loading your workspaces" className="flex flex-col gap-1" data-testid="remembered-skeleton">
    {row}
    {row}
    {row}
  </ul>
);

/** Three grey placeholder rows while the remembered list loads. */
export function RememberedSkeleton() {
  return skeleton;
}
