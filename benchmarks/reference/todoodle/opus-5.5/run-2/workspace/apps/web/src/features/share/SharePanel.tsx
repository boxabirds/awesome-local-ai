import Bookmark from 'lucide-react/icons/bookmark';
import Copy from 'lucide-react/icons/copy';
import Mail from 'lucide-react/icons/mail';
import { useRef, useState } from 'react';
import { Button, buttonClasses } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useWorkspaceContext } from '@/features/workspace/WorkspaceContext';
import { ACCESS_EDIT_SENTENCE, ACCESS_KEY_SENTENCE, SAVE_WARNING } from './copy';
import { markLinkSaved } from './linkSaved';
import { platformShortcut } from './platformShortcut';
import { useCopyLink } from './useCopyLink';
import { useWorkspaceLink } from './useWorkspaceLink';

export type SharePanelMode = 'save' | 'share';

export type SharePanelProps = {
  open: boolean;
  mode: SharePanelMode;
  onOpenChange(open: boolean): void;
};

const EMAIL_SUBJECT = 'Your Todoodle link';

export function mailtoHref(link: string): string {
  return `mailto:?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(link)}`;
}

/**
 * The one link panel: 'Save your link' right after creation, 'Share' from the header button.
 * Story 4 reuses it; there is no other link UI.
 */
export function SharePanel({ open, mode, onOpenChange }: SharePanelProps) {
  const context = useWorkspaceContext();
  if (!context) throw new Error('SharePanel must be rendered inside a workspace');
  const { workspaceId } = context;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <SharePanelContent workspaceId={workspaceId} mode={mode} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function SharePanelContent(props: { workspaceId: string; mode: SharePanelMode; onClose(): void }) {
  // The panel is opened by a plain button (not a Radix Trigger), so remember what had focus when
  // it opened and hand focus back there on close.
  const [returnFocusTo] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  return (
    <DialogContent
      aria-describedby="share-panel-description"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (returnFocusTo?.isConnected) returnFocusTo.focus();
      }}
    >
      <SharePanelBody {...props} />
    </DialogContent>
  );
}

function SharePanelBody({
  workspaceId,
  mode,
  onClose,
}: {
  workspaceId: string;
  mode: SharePanelMode;
  onClose(): void;
}) {
  const { link, status, retry } = useWorkspaceLink(workspaceId, { enabled: true });
  const { copy, copied } = useCopyLink(workspaceId);
  const [bookmarkHint, setBookmarkHint] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  async function onCopy() {
    if (!link) return;
    const result = await copy(link, field.current);
    if (result === 'copied' && mode === 'save') onClose();
  }

  function onEmail() {
    markLinkSaved(workspaceId);
    // Close after the mailto navigation has been handed to the browser.
    if (mode === 'save') setTimeout(onClose, 0);
  }

  function onBookmark() {
    // On /w/:id, swap the address to the portable /w#secret form so the bookmark works anywhere.
    if (link && window.location.pathname !== '/w') {
      const secret = new URL(link).hash;
      window.history.replaceState(window.history.state, '', `/w${secret}`);
    }
    setBookmarkHint(`Press ${platformShortcut()} to bookmark this page.`);
  }

  return (
    <>
      <DialogTitle className="text-xl font-semibold">{mode === 'save' ? 'Save your link' : 'Share'}</DialogTitle>
      <DialogDescription id="share-panel-description" asChild>
        <div className="flex flex-col gap-2 text-sm">
          <p>{ACCESS_KEY_SENTENCE}</p>
          {mode === 'save' ? <p>{SAVE_WARNING}</p> : null}
          <p>{ACCESS_EDIT_SENTENCE}</p>
        </div>
      </DialogDescription>

      {status === 'ready' && link ? (
        <input
          ref={field}
          readOnly
          aria-label="Workspace link"
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground"
        />
      ) : status === 'loading' ? (
        <div aria-busy="true" aria-label="Loading the link" className="skeleton-shimmer h-10 w-full rounded-md bg-muted" />
      ) : (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">Couldn't load the link</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button className="w-full sm:w-auto" disabled={!link} onClick={onCopy}>
          <Copy aria-hidden="true" className="size-4" />
          {mode === 'save' ? 'Copy link & continue' : copied ? 'Copied' : 'Copy link'}
        </Button>
        {link ? (
          <a className={buttonClasses('secondary', 'default', 'w-full sm:w-auto')} href={mailtoHref(link)} onClick={onEmail}>
            <Mail aria-hidden="true" className="size-4" />
            Email it to me
          </a>
        ) : null}
        <Button variant="secondary" className="w-full sm:w-auto" disabled={!link} onClick={onBookmark}>
          <Bookmark aria-hidden="true" className="size-4" />
          Bookmark this page
        </Button>
      </div>
      {bookmarkHint ? (
        <p role="status" className="text-sm">
          {bookmarkHint}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="ghost" className="w-full sm:w-auto" onClick={onClose}>
          {mode === 'save' ? 'Skip for now' : 'Done'}
        </Button>
      </div>
    </>
  );
}

export default SharePanel;
