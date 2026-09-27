import { createContext, useContext } from 'react';

/** The workspace being viewed. `secretFromHash` is set only on the /w#secret route. */
export type WorkspaceContextValue = { workspaceId: string; secretFromHash?: string };

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceContext(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
