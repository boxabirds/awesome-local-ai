import type { Workspace as WorkspaceData } from '@todoodle/shared/schemas';
import { Component, type ReactNode, Suspense, use, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { useCanEdit } from '@/features/live/canEditStore';
import { useTouchRemembered } from '@/features/remembered/useTouchRemembered';
import { discardOpen, knownWorkspaceId, openForRoute } from '@/features/workspace/bootOpen';
import { useWorkspace } from '@/features/workspace/useWorkspace';
import { WorkspaceContext, type WorkspaceContextValue } from '@/features/workspace/WorkspaceContext';
import { WorkspaceHeader } from '@/features/workspace/WorkspaceHeader';
import { WorkspaceLoadFailed } from '@/features/workspace/WorkspaceLoadFailed';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';
import { isNotFoundError } from '@/lib/api';
import { NotFoundPage } from './NotFoundPage';

/** `/w#<secret>`: the link entry. The fragment is never removed, so reload and bookmarks work. */
export function WorkspaceByLink() {
  const { hash } = useLocation();
  const secret = hash.slice(1);
  if (!secret) return <NotFoundPage />;
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
    if (isNotFoundError(error)) return <NotFoundPage />;
    return <WorkspaceLoadFailed onRetry={this.props.onRetry} />;
  }
}

/** `/w/:workspaceId`: entry from this browser's remembered workspaces (story 3). No secret in JS. */
export function WorkspaceByIdRoute() {
  const { workspaceId = '' } = useParams();
  return <RememberedWorkspace key={workspaceId} workspaceId={workspaceId} />;
}

/**
 * Opening from the remembered list, Continue or the switcher: the touch (recency) runs alongside
 * the workspace GET. A touch 404 means this browser can't open it any more.
 */
function RememberedWorkspace({ workspaceId }: { workspaceId: string }) {
  const touch = useTouchRemembered(workspaceId);
  if (isNotFoundError(touch.error)) return <NotFoundPage />;
  return <WorkspaceById workspaceId={workspaceId} />;
}

/**
 * One workspace by id, from the query cache or GET. Opened from this browser's list, the query's
 * placeholder (the remembered name) shows the header at once while the body stays a skeleton.
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
  if (query.data) {
    return (
      <WorkspaceView
        workspaceId={workspaceId}
        name={query.data.name}
        secretFromHash={secretFromHash}
        loading={query.isPlaceholderData}
      />
    );
  }
  if (query.isPending) return <WorkspaceSkeleton />;
  if (isNotFoundError(query.error)) return <NotFoundPage />;
  return <WorkspaceLoadFailed onRetry={() => void query.refetch()} />;
}

const bar = 'skeleton-shimmer rounded bg-muted';
const bodySkeleton = (
  <main aria-busy="true" aria-label="Loading tasks" className="flex flex-1 flex-col gap-4 p-6" data-testid="workspace-body-skeleton">
    <div className={`${bar} h-5 w-3/4`} />
    <div className={`${bar} h-5 w-2/3`} />
    <div className={`${bar} h-5 w-5/6`} />
  </main>
);

function WorkspaceView({
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

export default function Workspace() {
  const { workspaceId } = useParams();
  return workspaceId ? <WorkspaceByIdRoute /> : <WorkspaceByLink />;
}
