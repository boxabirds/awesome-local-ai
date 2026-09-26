import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useCreateWorkspace } from '@/features/workspace/useCreateWorkspace';

/**
 * Shown for any link that matches no workspace (malformed, unknown, deleted, empty) and as the router
 * catch-all. It renders nothing from the failed request, so it reveals nothing about other workspaces.
 * Story 3 passes this browser's remembered workspaces as `recovery`.
 */
export function NotFound({ recovery }: { recovery?: ReactNode }) {
  const create = useCreateWorkspace();
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 px-6">
      <title>Todoodle</title>
      <h1 className="text-3xl font-bold tracking-tight">Workspace not found</h1>
      <p className="text-muted-foreground">Links are long — check it wasn't cut off when it was copied.</p>
      {recovery}
      <div className="flex flex-col items-start gap-2">
        <Button size="lg" disabled={create.isPending} onClick={() => create.mutate()}>
          Start a new list
        </Button>
        {create.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't create your list — try again
          </p>
        ) : null}
      </div>
    </main>
  );
}
