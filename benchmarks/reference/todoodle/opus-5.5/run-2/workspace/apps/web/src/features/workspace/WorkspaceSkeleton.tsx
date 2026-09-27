const bar = 'skeleton-shimmer rounded bg-muted';

const skeleton = (
  <div aria-busy="true" aria-label="Loading workspace" className="flex min-h-screen flex-col" data-testid="workspace-skeleton">
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
      <div className={`${bar} h-6 w-48`} />
      <div className={`${bar} h-9 w-20`} />
    </header>
    <div className="flex flex-1">
      <aside className="hidden w-60 flex-col gap-3 border-r border-border p-4 sm:flex">
        <div className={`${bar} h-5 w-32`} />
        <div className={`${bar} h-5 w-24`} />
        <div className={`${bar} h-5 w-28`} />
      </aside>
      <main className="flex flex-1 flex-col gap-4 p-6">
        <div className={`${bar} h-5 w-3/4`} />
        <div className={`${bar} h-5 w-2/3`} />
        <div className={`${bar} h-5 w-5/6`} />
        <div className={`${bar} h-5 w-1/2`} />
        <div className={`${bar} h-5 w-3/5`} />
      </main>
    </div>
  </div>
);

/** Grey shapes in the final positions of the header, sidebar (3 rows) and list (5 rows). */
export function WorkspaceSkeleton() {
  return skeleton;
}
