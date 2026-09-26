import type { Workspace as WorkspaceData } from '@todoodle/shared/schemas';
import { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useCanEdit } from '@/features/live/canEdit';
import { LiveAnnouncer } from '@/features/live/LiveAnnouncer';
import { LiveProvider } from '@/features/live/LiveProvider';
import { OfflineBanner } from '@/features/live/OfflineBanner';
import { ReconnectingPill } from '@/features/live/ReconnectingPill';
import { SharePanelLazy } from '@/features/share/SharePanelLazy';
import { type OpenResult, getOpen, retryOpen } from '@/features/workspace/bootOpen';
import { AppShell } from '@/features/workspace/AppShell';
import { InboxView } from '@/features/tasks/InboxView';
import { WorkspaceContext, type WorkspaceContextValue } from '@/features/workspace/WorkspaceContext';
import { WorkspaceHeader } from '@/features/workspace/WorkspaceHeader';
import { WorkspaceLoadFailed } from '@/features/workspace/WorkspaceLoadFailed';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';
import { useRenameWorkspace } from '@/features/workspace/useRenameWorkspace';
import { useWorkspace } from '@/features/workspace/useWorkspace';
import { useTouchRemembered } from '@/features/remembered/useTouchRemembered';
import { isNotFoundError } from '@/lib/api';
import { WorkspaceSkeletonRows } from '@/features/workspace/WorkspaceSkeleton';
import { RecoverableNotFound as NotFound } from './RecoverableNotFound.tsx';
import { workspaceLoader } from './workspaceLoader.ts';

type PanelState = { open: boolean; mode: 'save' | 'share' };

function isJustCreated(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'justCreated' in state && state.justCreated === true;
}

/** The workspace itself: header, sidebar and the Inbox (story 5's app shell). */
function WorkspaceView({
  workspace,
  secretFromHash,
  placeholder = false,
}: {
  workspace: WorkspaceData;
  secretFromHash?: string;
  /** Only the name is known yet (story 3 instant name): body skeleton, editing off until real data. */
  placeholder?: boolean;
}) {
  const canEdit = useCanEdit() && !placeholder;
  const location = useLocation();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<PanelState>(() => ({ open: isJustCreated(location.state), mode: 'save' }));
  const { mutateAsync: rename } = useRenameWorkspace(workspace.id);
  // Failures are handled by the mutation (rollback + toast); the editor also learns whether it saved
  // (story 4's edit guard needs to know).
  const onRename = useCallback((name: string) => rename(name), [rename]);
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
      {/* Polite summary of other people's changes for screen readers (story 4). */}
      <LiveAnnouncer />
      <AppShell
        workspaceId={workspace.id}
        canEdit={canEdit}
        // Story 4: saves can't reach Todoodle. Editing is off below; typed text stays in its field.
        banner={<OfflineBanner />}
        renderHeader={({ navButton, actions }) => (
          <WorkspaceHeader
            name={workspace.name}
            canEdit={canEdit}
            onRename={onRename}
            onShare={() => setPanel({ open: true, mode: 'share' })}
            navButton={navButton}
            actions={actions}
          />
        )}
      >
        {placeholder ? <WorkspaceSkeletonRows /> : <InboxView workspaceId={workspace.id} />}
      </AppShell>
      {/* Live updates paused but saving works: a small pill, editing stays on. */}
      <ReconnectingPill />
      {/* Outside the edit fieldset: sharing works even when editing is disabled. */}
      <SharePanelLazy open={panel.open} mode={panel.mode} onOpenChange={onPanelOpenChange} />
    </WorkspaceContext>
  );
}

/** /w#<secret> once open has settled. The name comes from the query cache (kept fresh by refetch). */
function OpenedWorkspace({ promise, secret, onRetry }: { promise: Promise<OpenResult>; secret: string; onRetry: () => void }) {
  const result = use(promise);
  // 404: Not Found, and no LiveProvider, so no socket is ever attempted.
  if (result.status === 'not_found') return <NotFound />;
  if (result.status === 'failed') return <WorkspaceLoadFailed onRetry={onRetry} />;
  return <HashWorkspaceReady opened={result.workspace} secret={secret} />;
}

/**
 * Open has resolved, so the id is known: the data queries and the live socket start now, in parallel.
 * (Open itself can only overlap the route chunk load: the id comes from its response.)
 */
function HashWorkspaceReady({ opened, secret }: { opened: WorkspaceData; secret: string }) {
  const { data } = useWorkspace(opened.id);
  return (
    <LiveProvider key={opened.id} workspaceId={opened.id} notFound={<NotFound />}>
      <WorkspaceView workspace={data ?? opened} secretFromHash={secret} />
    </LiveProvider>
  );
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
  // In-app navigation without a hover/focus prefetch: start the Inbox list and counts now (no-op when fresh).
  useEffect(() => void workspaceLoader({ params: { workspaceId: id } }), [id]);
  const touch = useTouchRemembered(id);
  const query = useWorkspace(id);
  // Not remembered here (or no longer opens): NotFound, whichever request learns it first.
  if (isNotFoundError(touch.error) || isNotFoundError(query.error)) return <NotFound />;
  // A placeholder (name from the cached remembered list) renders the header at once; the body waits.
  if (query.data) {
    return (
      <LiveProvider workspaceId={id} notFound={<NotFound />}>
        <WorkspaceView workspace={query.data} placeholder={query.isPlaceholderData} />
      </LiveProvider>
    );
  }
  if (query.isPending) return <WorkspaceSkeleton />;
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
