import type { ReactNode } from 'react';
import { StartButton } from '@/features/workspace/StartButton';

/**
 * Shown for any link that doesn't open a workspace (malformed, unknown, deleted, empty hash) and
 * as the router catch-all. It shows nothing from the failed request. Story 3 fills `recovery`.
 */
export function NotFound({ recovery }: { recovery?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6">
      <title>Todoodle - Workspace not found</title>
      <h1 className="text-muted-foreground text-lg font-semibold">
        <a href="/" className="hover:underline">
          Todoodle
        </a>
      </h1>
      <section aria-labelledby="not-found-heading" className="flex flex-col gap-4">
        <h2 id="not-found-heading" className="text-3xl font-bold tracking-tight">
          Workspace not found
        </h2>
        <p className="text-muted-foreground" data-testid="not-found-tip">
          Links are long — check it wasn't cut off when it was copied.
        </p>
        {recovery}
        <StartButton />
      </section>
    </main>
  );
}
