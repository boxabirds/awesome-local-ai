import Share2 from 'lucide-react/icons/share-2';
import { Button } from '@/components/ui/button';
import { preloadSharePanel } from '@/features/share/SharePanelLazy';
import { UnsavedLinkBanner } from '@/features/share/UnsavedLinkBanner';
import { WorkspaceNameEditor } from './WorkspaceNameEditor';

type Props = {
  name: string;
  canEdit: boolean;
  onRename: (name: string) => Promise<unknown>;
  onShare: () => void;
};

/** Workspace name (editable), the single Share button, and the unsaved-link reminder under them. */
export function WorkspaceHeader({ name, canEdit, onRename, onShare }: Props) {
  return (
    <header className="border-b border-border">
      <div className="flex h-14 items-center gap-3 px-4">
        {/* Edit gate: only editable content goes inside; Share stays usable offline. */}
        <fieldset disabled={!canEdit} className="contents">
          <WorkspaceNameEditor name={name} onRename={onRename} />
        </fieldset>
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
