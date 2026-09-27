import Share2 from 'lucide-react/icons/share-2';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import type { SharePanelMode } from '@/features/share/SharePanel';
import { preloadSharePanel, SharePanelLazy } from '@/features/share/SharePanelLazy';
import { WorkspaceSwitcher } from '@/features/remembered/WorkspaceSwitcher';
import { UnsavedLinkBanner } from '@/features/share/UnsavedLinkBanner';
import { WorkspaceNameEditor } from './WorkspaceNameEditor';

type PanelState = { open: boolean; mode: SharePanelMode };

/**
 * Name editor (inside the edit gate), the single Share button and the unsaved-link banner
 * (both outside it, so they keep working when editing is disabled).
 */
export function WorkspaceHeader({
  workspaceId,
  name,
  canEdit,
}: {
  workspaceId: string;
  name: string;
  canEdit: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated === true;
  const [panel, setPanel] = useState<PanelState>(() => ({ open: justCreated, mode: 'save' }));

  function onOpenChange(open: boolean) {
    setPanel((current) => ({ ...current, open }));
    if (!open && justCreated) {
      // Keep the hash (the link) but drop justCreated so a reload doesn't reopen the panel.
      navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: {} });
    }
  }

  return (
    <>
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-1">
          <fieldset disabled={!canEdit} className="contents">
            <legend className="sr-only">Workspace</legend>
            <WorkspaceNameEditor workspaceId={workspaceId} name={name} />
          </fieldset>
          <WorkspaceSwitcher currentId={workspaceId} currentName={name} />
        </div>
        <Button
          variant="secondary"
          onClick={() => setPanel({ open: true, mode: 'share' })}
          onPointerEnter={preloadSharePanel}
          onFocus={preloadSharePanel}
        >
          <Share2 aria-hidden="true" className="size-4" />
          Share
        </Button>
      </header>
      <UnsavedLinkBanner onNeedPanel={() => setPanel({ open: true, mode: 'share' })} />
      <SharePanelLazy open={panel.open} mode={panel.mode} onOpenChange={onOpenChange} />
    </>
  );
}
