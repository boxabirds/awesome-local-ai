const bar = 'rounded bg-muted motion-safe:animate-pulse';

// Static placeholder shapes in the final positions of header, sidebar and list (rendering-hoist-jsx).
const skeleton = (
  <div aria-busy="true" aria-label="Loading workspace" className="flex min-h-svh flex-col">
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
      <div className={`${bar} h-6 w-48`} />
      <div className={`${bar} h-9 w-20`} />
    </header>
    <div className="flex flex-1">
      <aside className="hidden w-56 flex-col gap-3 border-r border-border p-4 sm:flex">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${bar} h-5 w-full`} />
        ))}
      </aside>
      <main className="flex flex-1 flex-col gap-3 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`${bar} h-8 w-full`} />
        ))}
      </main>
    </div>
  </div>
);

/** Shown while a workspace loads. No blank page and no lone spinner. */
export function WorkspaceSkeleton() {
  return skeleton;
}
