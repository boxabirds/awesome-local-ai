import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, use, useEffect, useState, useSyncExternalStore } from 'react';
import { workspaceExists } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { canEditStore } from './canEdit';
import { registerWorkspaceHandlers } from './handlers';
import { LiveConnection, type LiveSnapshot } from './LiveConnection';
import { networkMonitor } from './network';

const LiveContext = createContext<LiveConnection | null>(null);

type Props = {
  workspaceId: string;
  children: ReactNode;
  /** Shown instead of the workspace when the live endpoint says it no longer exists here. */
  notFound: ReactNode;
};

/**
 * Owns exactly one LiveConnection for the workspace; re-rendering its children never opens another
 * socket. Mount it with key={workspaceId} so switching workspaces gets a fresh connection.
 */
export function LiveProvider({ workspaceId, children, notFound }: Props) {
  const queryClient = useQueryClient();
  const [connection] = useState(
    () =>
      new LiveConnection({ workspaceId, queryClient, network: networkMonitor, checkExists: () => workspaceExists(workspaceId) }),
  );
  // Handlers first (effects run in order), so the first frame already has somewhere to go.
  useEffect(() => registerWorkspaceHandlers(), [workspaceId]);
  useEffect(() => {
    connection.connect();
    const detachGate = canEditStore.setConnection(connection);
    // Back online after an outage: refetch everything this workspace shows, once.
    const stopHealing = networkMonitor.onRecover(() => void queryClient.invalidateQueries({ queryKey: queryKeys.root(workspaceId) }));
    return () => {
      stopHealing();
      detachGate();
      connection.disconnect();
    };
  }, [connection, queryClient, workspaceId]);
  const isNotFound = useSyncExternalStore(connection.subscribe, () => connection.getSnapshot().status === 'not_found');
  if (isNotFound) return notFound;
  return <LiveContext value={connection}>{children}</LiveContext>;
}

/** The workspace's live connection (inside LiveProvider). */
export function useLiveConnection(): LiveConnection {
  const connection = use(LiveContext);
  if (!connection) throw new Error('useLiveConnection must be used inside LiveProvider');
  return connection;
}

/** Socket status and pausedLong of the current workspace's connection. */
export function useLiveSnapshot(): LiveSnapshot {
  const connection = useLiveConnection();
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}
