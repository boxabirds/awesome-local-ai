/** A grey placeholder the size and shape of a TaskRow. */
export function SkeletonRow() {
  return (
    <div data-skeleton-row className="flex min-h-11 items-center gap-3 px-2 py-2">
      <div className="size-5 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
    </div>
  );
}
