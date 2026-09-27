import { useState } from 'react';
import { useCanEdit } from '@/features/live/canEdit';
import { LiveAnnouncer } from '@/features/live/LiveAnnouncer';
import { LiveStatus } from '@/features/live/LiveStatus';
import { WorkspaceContext, type WorkspaceContextValue } from './WorkspaceContext';
import { WorkspaceHeader } from './WorkspaceHeader';

// Hoisted: the live region never re-renders with the shell.
const liveAnnouncer = <LiveAnnouncer />;
const liveStatus = <LiveStatus />;

const bar = 'skeleton-shimmer rounded bg-muted';
const bodySkeleton = (
  <main aria-busy="true" aria-label="Loading tasks" className="flex flex-1 flex-col gap-4 p-6" data-testid="workspace-body-skeleton">
    <div className={`${bar} h-5 w-3/4`} />
    <div className={`${bar} h-5 w-2/3`} />
    <div className={`${bar} h-5 w-5/6`} />
  </main>
);

/**
 * The workspace screen: header, the polite live region for others' changes, and the edit gate
 * (`<fieldset disabled>`) around everything that edits. Share and navigation stay outside it.
 */
export function WorkspaceShell({
  workspaceId,
  name,
  secretFromHash,
  loading = false,
}: {
  workspaceId: string;
  name: string;
  secretFromHash?: string;
  /** Showing the remembered name only: nothing is editable and the body is a skeleton. */
  loading?: boolean;
}) {
  const liveCanEdit = useCanEdit();
  const canEdit = liveCanEdit && !loading;
  const [context] = useState<WorkspaceContextValue>(() => ({ workspaceId, secretFromHash }));
  return (
    <WorkspaceContext value={context}>
      <title>{`Todoodle - ${name}`}</title>
      <div className="flex min-h-screen flex-col">
        {liveAnnouncer}
        {liveStatus}
        <WorkspaceHeader workspaceId={workspaceId} name={name} canEdit={canEdit} />
        <div className="flex flex-1">
          <nav aria-label="Lists" className="hidden w-60 flex-col gap-1 border-r border-border p-3 sm:flex">
            <span aria-current="page" className="rounded-md bg-muted px-3 py-2 text-sm font-medium">
              Inbox
            </span>
          </nav>
          <fieldset disabled={!canEdit} className="contents">
            <legend className="sr-only">Inbox</legend>
            {loading ? (
              bodySkeleton
            ) : (
              <main className="flex flex-1 flex-col gap-2 p-6">
                <h2 className="text-lg font-semibold">Inbox</h2>
                <p className="text-muted-foreground">Nothing here yet.</p>
              </main>
            )}
          </fieldset>
        </div>
      </div>
    </WorkspaceContext>
  );
}
