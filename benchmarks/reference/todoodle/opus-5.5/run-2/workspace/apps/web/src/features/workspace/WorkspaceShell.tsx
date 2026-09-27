import { useState } from 'react';
import { useCanEdit } from '@/features/live/canEdit';
import { LiveAnnouncer } from '@/features/live/LiveAnnouncer';
import { LiveStatus } from '@/features/live/LiveStatus';
import { WorkspaceContext, type WorkspaceContextValue } from './WorkspaceContext';
import { AppShell } from './AppShell';

// Hoisted: the live region never re-renders with the shell.
const liveAnnouncer = <LiveAnnouncer />;
const liveStatus = <LiveStatus />;

/**
 * The workspace screen: the polite live region for others' changes, the live status, and the app
 * shell (header, sidebar and the view inside the edit gate).
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
      {liveAnnouncer}
      {liveStatus}
      <AppShell workspaceId={workspaceId} name={name} canEdit={canEdit} loading={loading} />
    </WorkspaceContext>
  );
}
