import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useWorkspaceContext } from '@/features/workspace/WorkspaceContext';
import { getWorkspaceLink } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { type CopyResult, copyText } from './copyText';
import { markLinkSaved, snooze, useLinkReminderVisible } from './linkSaved';
import { linkFromSecret } from './useWorkspaceLink';

const buttonClass = 'w-full sm:w-auto';

/**
 * Reminder shown until this browser has copied or emailed the link. 'Remind me later' hides it for this
 * tab session only; there is no way to dismiss it for good without saving the link.
 */
export function UnsavedLinkBanner({ onOpenShare }: { onOpenShare: () => void }) {
  const { workspaceId, secretFromHash } = useWorkspaceContext();
  const visible = useLinkReminderVisible(workspaceId);
  const queryClient = useQueryClient();
  if (!visible) return null;

  async function onCopy() {
    let result: CopyResult;
    if (secretFromHash) {
      result = await copyText(linkFromSecret(secretFromHash));
    } else if (typeof ClipboardItem === 'undefined') {
      // No way to copy a link that is still being fetched: let the panel fetch it for a manual copy.
      result = 'fallback';
    } else {
      result = await copyText(
        queryClient.fetchQuery({
          queryKey: queryKeys.link(workspaceId),
          queryFn: () => getWorkspaceLink(workspaceId),
          staleTime: 0,
          gcTime: 0,
        }),
      );
    }
    if (result === 'copied') markLinkSaved(workspaceId);
    else onOpenShare();
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 border-t border-border bg-warning/15 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p>Your link isn't saved yet — you'll lose access if you clear this browser.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="sm" className={buttonClass} onClick={onCopy}>
          Copy link
        </Button>
        <Button size="sm" variant="ghost" className={buttonClass} onClick={() => snooze(workspaceId)}>
          Remind me later
        </Button>
      </div>
    </div>
  );
}
