import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useWorkspaceContext } from '@/features/workspace/WorkspaceContext';
import { getWorkspaceLink } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { copyText } from './copyText';
import { markLinkSaved, snooze, useLinkReminderVisible } from './linkSaved';
import { linkFromSecret } from './useWorkspaceLink';

/**
 * Reminder under the header until this browser has copied or emailed the link. 'Remind me later'
 * hides it for this tab session only; there is no way to dismiss it for good without saving.
 */
export function UnsavedLinkBanner({ onNeedPanel }: { onNeedPanel(): void }) {
  const context = useWorkspaceContext();
  const client = useQueryClient();
  const workspaceId = context?.workspaceId ?? '';
  const visible = useLinkReminderVisible(workspaceId);
  if (!context || !visible) return null;
  const { secretFromHash } = context;

  async function onCopy() {
    const text = secretFromHash
      ? linkFromSecret(secretFromHash)
      : client.fetchQuery({
          queryKey: queryKeys.link(workspaceId),
          queryFn: () => getWorkspaceLink(workspaceId),
          staleTime: 0,
          gcTime: 0,
        });
    const result = await copyText(text);
    if (result === 'copied') markLinkSaved(workspaceId);
    else onNeedPanel();
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 border-b border-border bg-warning-surface px-4 py-2 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
    >
      <p>Your link isn't saved yet — you'll lose access if you clear this browser.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="sm" className="w-full sm:w-auto" onClick={onCopy}>
          Copy link
        </Button>
        <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => snooze(workspaceId)}>
          Remind me later
        </Button>
      </div>
    </div>
  );
}
