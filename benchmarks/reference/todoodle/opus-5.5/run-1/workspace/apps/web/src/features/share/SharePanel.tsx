import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useWorkspaceContext } from '@/features/workspace/WorkspaceContext';
import { SAVE_ONLY_WAY_BACK_TEXT, SHARE_ACCESS_TEXT, SHARE_KEY_TEXT } from './copy';
import { markLinkSaved } from './linkSaved';
import { platformShortcut } from './platformShortcut';
import { useCopyLink } from './useCopyLink';
import { useWorkspaceLink } from './useWorkspaceLink';

export type SharePanelMode = 'save' | 'share';

export type SharePanelProps = { open: boolean; mode: SharePanelMode; onOpenChange(open: boolean): void };

const EMAIL_SUBJECT = 'Your Todoodle link';

function mailtoHref(link: string): string {
  return `mailto:?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(link)}`;
}

const fullWidthOnMobile = 'w-full sm:w-auto';

/**
 * The one panel for the workspace link: 'Save your link' right after creation, 'Share' from the header.
 * Story 4 reuses it; there is no separate Link control.
 */
export default function SharePanel({ open, mode, onOpenChange }: SharePanelProps) {
  const { workspaceId, secretFromHash } = useWorkspaceContext();
  const { link, status, retry } = useWorkspaceLink(workspaceId, { enabled: open });
  const { copy, copied } = useCopyLink(workspaceId);
  const field = useRef<HTMLInputElement>(null);
  // Radix only restores focus to its own Dialog.Trigger, and this panel is opened from outside one, so
  // focus goes back by hand: to the header's Share button (as a Trigger would), else whatever opened it.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const save = mode === 'save';

  async function onCopy() {
    if (!link) return;
    const result = await copy(link, field.current);
    if (result === 'copied' && save) onOpenChange(false);
  }

  function onEmail() {
    markLinkSaved(workspaceId);
    // Close after the click finishes: a disconnected <a> would not open the mail app.
    if (save) setTimeout(() => onOpenChange(false), 0);
  }

  function onBookmark() {
    // On /w/:id make the address bar portable first (keeps router state; no navigation).
    if (!secretFromHash && link) {
      window.history.replaceState(window.history.state, '', `/w${new URL(link).hash}`);
    }
    setShortcut(platformShortcut());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={() => {
          const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          returnFocusTo.current = document.querySelector<HTMLElement>('[data-share-trigger]') ?? opener;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <DialogTitle className="text-lg font-semibold">{save ? 'Save your link' : 'Share'}</DialogTitle>

        {status === 'ready' && link ? (
          <input
            ref={field}
            readOnly
            aria-label="Workspace link"
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm pointer-coarse:min-h-11"
          />
        ) : status === 'error' ? (
          <div role="alert" className="flex items-center gap-3 text-sm">
            <span>Couldn't load the link</span>
            <Button variant="outline" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading link" className="h-9 w-full rounded-md bg-muted motion-safe:animate-pulse" />
        )}

        <DialogDescription className="flex flex-col gap-1 text-sm">
          <span>{SHARE_KEY_TEXT}</span>
          {save ? <span>{SAVE_ONLY_WAY_BACK_TEXT}</span> : null}
          <span>{SHARE_ACCESS_TEXT}</span>
        </DialogDescription>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button className={fullWidthOnMobile} disabled={!link} onClick={onCopy}>
            {save ? 'Copy link & continue' : copied ? 'Copied' : 'Copy link'}
          </Button>
          {link ? (
            <a
              href={mailtoHref(link)}
              onClick={onEmail}
              className="inline-flex h-9 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto pointer-coarse:min-h-11"
            >
              Email it to me
            </a>
          ) : null}
          <Button variant="outline" className={fullWidthOnMobile} disabled={!link} onClick={onBookmark}>
            Bookmark this page
          </Button>
        </div>
        {shortcut ? (
          <p role="status" className="text-sm">
            Press {shortcut} to bookmark this page.
          </p>
        ) : null}

        <DialogClose asChild>
          <Button variant="ghost" className={`${fullWidthOnMobile} self-end`}>
            {save ? 'Skip for now' : 'Done'}
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
