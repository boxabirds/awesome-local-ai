import type { Workspace as WorkspaceData } from '@todoodle/shared/schemas';
import { Suspense, use, useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useCanEdit } from '@/features/live/canEditStore';
import { SharePanelLazy } from '@/features/share/SharePanelLazy';
import { type OpenResult, getOpen, retryOpen } from '@/features/workspace/bootOpen';
import { WorkspaceContext, type WorkspaceContextValue } from '@/features/workspace/WorkspaceContext';
import { WorkspaceHeader } from '@/features/workspace/WorkspaceHeader';
import { WorkspaceLoadFailed } from '@/features/workspace/WorkspaceLoadFailed';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';
import { useRenameWorkspace } from '@/features/workspace/useRenameWorkspace';
import { useWorkspace } from '@/features/workspace/useWorkspace';
import { isNotFoundError } from '@/lib/api';
import { NotFound } from './NotFound.tsx';

type PanelState = { open: boolean; mode: 'save' | 'share' };

function isJustCreated(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'justCreated' in state && state.justCreated === true;
}

/** The workspace itself: header, sidebar and the (empty, until story 5) Inbox. */
function WorkspaceView({ workspace, secretFromHash }: { workspace: WorkspaceData; secretFromHash?: string }) {
  const canEdit = useCanEdit();
  const location = useLocation();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<PanelState>(() => ({ open: isJustCreated(location.state), mode: 'save' }));
  const { mutateAsync: rename } = useRenameWorkspace(workspace.id);
  // Failures are handled by the mutation (rollback + toast); the editor only needs to know it settled.
  const onRename = useCallback((name: string) => rename(name).catch(() => undefined), [rename]);
  const context = useMemo<WorkspaceContextValue>(
    () => ({ workspaceId: workspace.id, secretFromHash }),
    [workspace.id, secretFromHash],
  );

  const onPanelOpenChange = (open: boolean) => {
    setPanel((current) => ({ ...current, open }));
    // Clear justCreated (keeping the hash) so a reload does not show 'Save your link' again.
    if (!open && isJustCreated(location.state)) {
      navigate({ pathname: location.pathname, hash: location.hash }, { replace: true, state: {} });
    }
  };

  return (
    <WorkspaceContext value={context}>
      <title>{`Todoodle - ${workspace.name}`}</title>
      <div className="flex min-h-svh flex-col">
        <WorkspaceHeader
          name={workspace.name}
          canEdit={canEdit}
          onRename={onRename}
          onShare={() => setPanel({ open: true, mode: 'share' })}
        />
        <div className="flex flex-1">
          <aside className="hidden w-56 border-r border-border p-4 sm:block">
            <nav aria-label="Lists">
              <span aria-current="page" className="block rounded-md bg-muted px-3 py-2 text-sm font-medium">
                Inbox
              </span>
            </nav>
          </aside>
          <main className="flex-1 p-4">
            <fieldset disabled={!canEdit} className="contents">
              <h2 className="text-xl font-semibold">Inbox</h2>
              <p className="mt-2 text-muted-foreground">Your Inbox is empty.</p>
            </fieldset>
          </main>
        </div>
      </div>
      {/* Outside the edit fieldset: sharing works even when editing is disabled. */}
      <SharePanelLazy open={panel.open} mode={panel.mode} onOpenChange={onPanelOpenChange} />
    </WorkspaceContext>
  );
}

/** /w#<secret> once open has settled. The name comes from the query cache (kept fresh by refetch). */
function OpenedWorkspace({ promise, secret, onRetry }: { promise: Promise<OpenResult>; secret: string; onRetry: () => void }) {
  const result = use(promise);
  if (result.status === 'not_found') return <NotFound />;
  if (result.status === 'failed') return <WorkspaceLoadFailed onRetry={onRetry} />;
  return <HashWorkspaceReady opened={result.workspace} secret={secret} />;
}

function HashWorkspaceReady({ opened, secret }: { opened: WorkspaceData; secret: string }) {
  const { data } = useWorkspace(opened.id);
  return <WorkspaceView workspace={data ?? opened} secretFromHash={secret} />;
}

function HashWorkspace({ secret }: { secret: string }) {
  // The boot promise (started in main.tsx), a primed one after create, or a fresh open.
  const [promise, setPromise] = useState(() => getOpen(secret));
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <OpenedWorkspace promise={promise} secret={secret} onRetry={() => setPromise(retryOpen(secret))} />
    </Suspense>
  );
}

/** /w/:workspaceId: entered from this browser's remembered list (story 3). No secret reaches JS. */
function IdWorkspace({ id }: { id: string }) {
  const query = useWorkspace(id);
  if (query.data) return <WorkspaceView workspace={query.data} />;
  if (query.isPending) return <WorkspaceSkeleton />;
  if (isNotFoundError(query.error)) return <NotFound />;
  return <WorkspaceLoadFailed onRetry={() => void query.refetch()} />;
}

/** Routes /w (secret in the fragment) and /w/:workspaceId. The fragment is never removed or rewritten. */
export default function Workspace() {
  const { workspaceId } = useParams();
  const { hash } = useLocation();
  if (workspaceId) return <IdWorkspace key={workspaceId} id={workspaceId} />;
  // Derived during render (rerender-derived-state-no-effect).
  const secret = hash.replace(/^#/, '');
  if (!secret) return <NotFound />;
  return <HashWorkspace key={secret} secret={secret} />;
}
