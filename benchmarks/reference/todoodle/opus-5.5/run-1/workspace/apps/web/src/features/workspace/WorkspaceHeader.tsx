import type { ReactNode } from 'react';
import Share2 from 'lucide-react/icons/share-2';
import { Button } from '@/components/ui/button';
import { preloadSharePanel } from '@/features/share/SharePanelLazy';
import { UnsavedLinkBanner } from '@/features/share/UnsavedLinkBanner';
import { WorkspaceSwitcher } from '@/features/remembered/WorkspaceSwitcher';
import { useWorkspaceContext } from './WorkspaceContext';
import { WorkspaceNameEditor } from './WorkspaceNameEditor';

type Props = {
  name: string;
  canEdit: boolean;
  onRename: (name: string) => Promise<unknown>;
  onShare: () => void;
  /** Story 5 phone layout: the ☰ button that opens the navigation drawer. */
  navButton?: ReactNode;
  /** Trailing actions before Share (story 11's search), at every width. */
  actions?: ReactNode;
};

/** Workspace name (editable), the workspace switcher, the single Share button, and the unsaved-link reminder under them. */
export function WorkspaceHeader({ name, canEdit, onRename, onShare, navButton = null, actions = null }: Props) {
  const { workspaceId } = useWorkspaceContext();
  return (
    <header className="border-b border-border">
      <div className="flex h-14 items-center gap-3 px-4">
        {navButton}
        {/* Edit gate: only editable content goes inside; Share stays usable offline. */}
        <fieldset disabled={!canEdit} className="contents">
          <WorkspaceNameEditor name={name} canEdit={canEdit} onRename={onRename} />
        </fieldset>
        {/* Story 3: switch between this browser's remembered workspaces (works offline too). */}
        <WorkspaceSwitcher currentId={workspaceId} currentName={name} />
        {actions}
        <Button variant="outline" data-share-trigger onClick={onShare} onPointerEnter={preloadSharePanel} onFocus={preloadSharePanel}>
          <Share2 aria-hidden="true" />
          Share
        </Button>
      </div>
      {/* Outside the edit fieldset: copying the link must keep working when editing is disabled. */}
      <UnsavedLinkBanner onOpenShare={onShare} />
    </header>
  );
}
