import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { getWorkspace } from '@/lib/api';
import { isNotFoundError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';
import { type Announcer, createAnnouncer } from './announcer';
import { canEditStore } from './canEdit';
import { editGuards } from './editGuard';
import { registerWorkspaceHandlers } from './handlers';
import { LiveConnection, type LiveSnapshot } from './LiveConnection';
import { networkMonitor } from './network';

export type LiveContextValue = { connection: LiveConnection; announcer: Announcer };

const LiveContext = createContext<LiveContextValue | null>(null);

export function useLive(): LiveContextValue | null {
  return useContext(LiveContext);
}

const idleSnapshot: LiveSnapshot = { status: 'open', pausedLong: false };
const noopSubscribe = () => () => {};

/** Socket status for the workspace on screen (outside a provider: open). */
export function useLiveSnapshot(): LiveSnapshot {
  const live = useLive();
  return useSyncExternalStore(
    live?.connection.subscribe ?? noopSubscribe,
    live?.connection.getSnapshot ?? (() => idleSnapshot),
    live?.connection.getSnapshot ?? (() => idleSnapshot),
  );
}

export type LiveProviderProps = {
  workspaceId: string;
  /** False while only a placeholder (the remembered name) is on screen: no socket yet. */
  enabled?: boolean;
  /** Shown instead of the children once the socket reports the workspace is gone. */
  notFound?: ReactNode;
  children: ReactNode;
};

/** Owns exactly one live connection per workspace; remounting children never opens another. */
export function LiveProvider(props: LiveProviderProps) {
  return <WorkspaceLive key={props.workspaceId} {...props} />;
}

function WorkspaceLive({ workspaceId, enabled = true, notFound, children }: LiveProviderProps) {
  const queryClient = useQueryClient();
  const [live] = useState<LiveContextValue>(() => {
    const announcer = createAnnouncer();
    // A socket that never opened may have been refused with 404: ask over HTTP.
    const checkAccess = () =>
      getWorkspace(workspaceId).then(
        () => 'ok' as const,
        (error: unknown) => (isNotFoundError(error) ? ('not_found' as const) : ('ok' as const)),
      );
    return { announcer, connection: new LiveConnection({ workspaceId, queryClient, announcer, editGuard: editGuards, checkAccess }) };
  });

  useEffect(() => registerWorkspaceHandlers(), [workspaceId]);

  useEffect(() => {
    if (!enabled) return;
    live.connection.connect();
    return () => live.connection.close();
  }, [live, workspaceId, enabled]);

  useEffect(() => () => live.announcer.dispose(), [live]);

  // The edit gate follows this workspace's socket (not_found turns editing off).
  useEffect(() => {
    const { connection } = live;
    const sync = () => canEditStore.setSocketStatus(connection.getSnapshot().status);
    sync();
    const off = connection.subscribe(sync);
    return () => {
      off();
      canEditStore.setSocketStatus('open');
    };
  }, [live]);

  // Back online after an outage: refetch everything in this workspace once.
  useEffect(
    () => networkMonitor.onRecovered(() => void queryClient.invalidateQueries({ queryKey: queryKeys.root(workspaceId) })),
    [queryClient, workspaceId],
  );

  const status = useSyncExternalStore(live.connection.subscribe, () => live.connection.getSnapshot().status);
  if (status === 'not_found' && notFound !== undefined) return notFound;
  return <LiveContext value={live}>{children}</LiveContext>;
}
