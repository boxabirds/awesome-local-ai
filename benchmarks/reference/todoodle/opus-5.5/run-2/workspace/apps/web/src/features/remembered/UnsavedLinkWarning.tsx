import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/features/share/copyText';
import { markLinkSaved } from '@/features/share/linkSaved';
import { useWorkspaceLink } from '@/features/share/useWorkspaceLink';

export const UNSAVED_WARNING = "You haven't saved this link. If you forget it here, you may lose access.";
export const LINK_COPIED = 'Link copied — you can forget it safely.';

type CopyState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'error' }
  | { kind: 'manual'; link: string }
  | { kind: 'copied' };

/** Focuses and selects the whole link once the manual-copy field appears. */
const selectOnMount = (field: HTMLInputElement | null) => {
  if (field) {
    field.focus();
    field.select();
  }
};

/**
 * Shown in the forget dialog while this browser has never copied or emailed the link. The link is
 * fetched only when Copy link is pressed (the cookie entry that authorises it still exists then).
 */
export function UnsavedLinkWarning({
  workspaceId,
  onPendingChange,
}: {
  workspaceId: string;
  onPendingChange(pending: boolean): void;
}) {
  const { refetch } = useWorkspaceLink(workspaceId, { enabled: false });
  const [state, setState] = useState<CopyState>({ kind: 'idle' });

  async function onCopy() {
    setState({ kind: 'pending' });
    onPendingChange(true);
    let link: string;
    try {
      link = await refetch();
    } catch {
      setState({ kind: 'error' });
      return;
    } finally {
      onPendingChange(false);
    }
    if ((await copyText(link)) === 'copied') {
      markLinkSaved(workspaceId);
      setState({ kind: 'copied' });
    } else {
      setState({ kind: 'manual', link });
    }
  }

  if (state.kind === 'copied') {
    return (
      <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
        {LINK_COPIED}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-warning-surface p-3 text-sm">
      <p>{UNSAVED_WARNING}</p>
      {state.kind === 'manual' ? (
        <div className="flex flex-col gap-1">
          <input
            ref={selectOnMount}
            readOnly
            aria-label="Workspace link"
            value={state.link}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
          <p>Copy it manually</p>
        </div>
      ) : state.kind === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-destructive">Couldn't get the link</p>
          <Button variant="secondary" size="sm" onClick={onCopy}>
            Retry
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={state.kind === 'pending'}
          onClick={onCopy}
        >
          Copy link
        </Button>
      )}
    </div>
  );
}
