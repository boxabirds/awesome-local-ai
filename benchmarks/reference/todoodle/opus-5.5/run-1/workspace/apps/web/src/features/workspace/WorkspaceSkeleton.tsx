import type { ReactNode } from 'react';

const bar = 'rounded bg-muted motion-safe:animate-pulse';

const rows = (
  <div aria-busy="true" aria-label="Loading tasks" className="flex flex-1 flex-col gap-3 p-4">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className={`${bar} h-8 w-full`} />
    ))}
  </div>
);

const nameBar = <div className={`${bar} h-6 w-48`} />;

const body = (
  <div className="flex flex-1">
    <aside className="hidden w-56 flex-col gap-3 border-r border-border p-4 md:flex">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${bar} h-5 w-full`} />
      ))}
    </aside>
    {rows}
  </div>
);

function layout(name: ReactNode) {
  return (
    <div aria-busy="true" aria-label="Loading workspace" className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
        {name}
        <div className={`${bar} h-9 w-20`} />
      </header>
      {body}
    </div>
  );
}

// Static placeholder shapes in the final positions of header, sidebar and list (rendering-hoist-jsx).
const skeleton = layout(nameBar);

/**
 * Shown while a workspace loads. No blank page and no lone spinner. With `name` (known from this
 * browser's remembered list, story 3) the header shows it instead of a grey bar.
 */
export function WorkspaceSkeleton({ name }: { name?: string } = {}) {
  if (!name) return skeleton;
  return layout(<p className="min-w-0 flex-1 truncate px-2 py-1 text-lg font-semibold">{name}</p>);
}

/** Only the list area's placeholder rows (the header is already known, e.g. from the remembered list). */
export function WorkspaceSkeletonRows() {
  return rows;
}
