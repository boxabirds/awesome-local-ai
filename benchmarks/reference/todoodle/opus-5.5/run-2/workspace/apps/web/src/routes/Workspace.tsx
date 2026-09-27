import type { Workspace as WorkspaceData } from '@todoodle/shared/schemas';
import { Component, type ReactNode, Suspense, use, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { useCanEdit } from '@/features/live/canEditStore';
import { discardOpen, knownWorkspaceId, openForRoute } from '@/features/workspace/bootOpen';
import { useWorkspace } from '@/features/workspace/useWorkspace';
import { WorkspaceContext, type WorkspaceContextValue } from '@/features/workspace/WorkspaceContext';
import { WorkspaceHeader } from '@/features/workspace/WorkspaceHeader';
import { WorkspaceLoadFailed } from '@/features/workspace/WorkspaceLoadFailed';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';
import { isNotFoundError } from '@/lib/api';
import { NotFound } from './NotFound';

/** `/w#<secret>`: the link entry. The fragment is never removed, so reload and bookmarks work. */
export function WorkspaceByLink() {
  const { hash } = useLocation();
  const secret = hash.slice(1);
  if (!secret) return <NotFound />;
  return <OpenByLink key={secret} secret={secret} />;
}

function OpenByLink({ secret }: { secret: string }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <OpenErrorBoundary
      key={attempt}
      onRetry={() => {
        discardOpen(secret);
        setAttempt((n) => n + 1);
      }}
    >
      <Suspense fallback={<WorkspaceSkeleton />}>
        <OpenedWorkspace secret={secret} />
      </Suspense>
    </OpenErrorBoundary>
  );
}

function OpenedWorkspace({ secret }: { secret: string }) {
  // Just created (or opened earlier in this page session): the cache is primed, so no open and
  // no skeleton. Otherwise suspend on the boot open (or a fresh one after client-side navigation).
  const workspaceId = knownWorkspaceId(secret) ?? use(openForRoute(secret)).workspace.id;
  return <WorkspaceById workspaceId={workspaceId} secretFromHash={secret} />;
}

type BoundaryProps = { onRetry(): void; children: ReactNode };

/** Turns a failed open into NotFound (404/400) or the retryable load-failed state (anything else). */
class OpenErrorBoundary extends Component<BoundaryProps, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (isNotFoundError(error)) return <NotFound />;
    return <WorkspaceLoadFailed onRetry={this.props.onRetry} />;
  }
}

/** `/w/:workspaceId`: entry from this browser's remembered workspaces (story 3). No secret in JS. */
export function WorkspaceByIdRoute() {
  const { workspaceId = '' } = useParams();
  return <WorkspaceById key={workspaceId} workspaceId={workspaceId} />;
}

/**
 * One workspace by id, from the query cache or GET. Story 3 passes `placeholderData` from its
 * remembered entry so the name shows before GET returns.
 */
export function WorkspaceById({
  workspaceId,
  secretFromHash,
  placeholderData,
}: {
  workspaceId: string;
  secretFromHash?: string;
  placeholderData?: WorkspaceData;
}) {
  const query = useWorkspace(workspaceId, { placeholderData });
  if (query.data) return <WorkspaceView workspaceId={workspaceId} name={query.data.name} secretFromHash={secretFromHash} />;
  if (query.isPending) return <WorkspaceSkeleton />;
  if (isNotFoundError(query.error)) return <NotFound />;
  return <WorkspaceLoadFailed onRetry={() => void query.refetch()} />;
}

function WorkspaceView({
  workspaceId,
  name,
  secretFromHash,
}: {
  workspaceId: string;
  name: string;
  secretFromHash?: string;
}) {
  const canEdit = useCanEdit();
  const [context] = useState<WorkspaceContextValue>(() => ({ workspaceId, secretFromHash }));
  return (
    <WorkspaceContext value={context}>
      <title>{`Todoodle - ${name}`}</title>
      <div className="flex min-h-screen flex-col">
        <WorkspaceHeader workspaceId={workspaceId} name={name} canEdit={canEdit} />
        <div className="flex flex-1">
          <nav aria-label="Lists" className="hidden w-60 flex-col gap-1 border-r border-border p-3 sm:flex">
            <span aria-current="page" className="rounded-md bg-muted px-3 py-2 text-sm font-medium">
              Inbox
            </span>
          </nav>
          <fieldset disabled={!canEdit} className="contents">
            <legend className="sr-only">Inbox</legend>
            <main className="flex flex-1 flex-col gap-2 p-6">
              <h2 className="text-lg font-semibold">Inbox</h2>
              <p className="text-muted-foreground">Nothing here yet.</p>
            </main>
          </fieldset>
        </div>
      </div>
    </WorkspaceContext>
  );
}

export default function Workspace() {
  const { workspaceId } = useParams();
  return workspaceId ? <WorkspaceByIdRoute /> : <WorkspaceByLink />;
}
