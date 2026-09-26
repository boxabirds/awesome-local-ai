import { INBOX_SCOPE } from '@/lib/queryKeys';
import type { QuickAddTarget } from './DestinationChip';
import { EmptyInbox } from './EmptyInbox';
import { TaskListView } from './TaskListView';

// Hoisted (rendering-hoist-jsx): stable references, so the list view never re-renders for them.
const emptyInbox = <EmptyInbox />;
const INBOX: QuickAddTarget = { kind: 'inbox' };
const heading = (
  <h1 id="view-title" tabIndex={-1} className="text-xl font-semibold outline-none">
    Inbox
  </h1>
);

/** The Inbox: every task with no project, oldest first, with quick add at the bottom. */
export function InboxView({ workspaceId }: { workspaceId: string }) {
  return <TaskListView workspaceId={workspaceId} scope={INBOX_SCOPE} heading={heading} empty={emptyInbox} target={INBOX} />;
}
