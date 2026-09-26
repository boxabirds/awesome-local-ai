import { createContext, useContext } from 'react';

export type WorkspaceContextValue = {
  workspaceId: string;
  /** Present only on the /w#<secret> route. On /w/:id no secret reaches JS unless the user asks for the link. */
  secretFromHash?: string;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** The current workspace. Stories 3 to 8 read it; it throws outside a workspace view. */
export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspaceContext must be used inside a workspace view');
  return value;
}
