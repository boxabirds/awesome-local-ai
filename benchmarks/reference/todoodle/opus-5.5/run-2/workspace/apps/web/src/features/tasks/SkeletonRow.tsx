const skeletonRow = (
  <li className="flex min-h-11 items-center gap-3 px-2 py-2" aria-hidden="true">
    <span className="skeleton-shimmer size-5 shrink-0 rounded-full bg-muted" />
    <span className="skeleton-shimmer h-4 w-2/3 rounded bg-muted" />
  </li>
);

/** A grey placeholder row in the shape of a TaskRow. */
export function SkeletonRow() {
  return skeletonRow;
}
