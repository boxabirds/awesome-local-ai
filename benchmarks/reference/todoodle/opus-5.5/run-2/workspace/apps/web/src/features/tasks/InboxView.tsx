import { QUICK_ADD_KEY } from '@todoodle/shared/limits';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { FloatingAddButton } from '@/features/workspace/FloatingAddButton';
import { useIsNarrow } from '@/features/workspace/useIsNarrow';
import { useGlobalShortcut } from '@/lib/shortcuts';
import { useHoverNone } from '@/lib/useHoverNone';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import type { QuickAddTarget } from './DestinationChip';
import { EmptyInbox } from './EmptyInbox';
import { QuickAdd, type QuickAddHandle } from './QuickAdd';
import { tasksQuery } from './queries';
import { TaskActionsContext } from './TaskActionsContext';
import { TaskList, type TaskListStatus } from './TaskList';
import { useCreateTask } from './useCreateTask';

const INBOX: QuickAddTarget = { kind: 'inbox' };

type QuickAddState = { open: false } | { open: true; mode: 'inline' | 'docked'; returnTo: HTMLElement | null };

/**
 * The Inbox: heading, task list, and quick add. The quick-add open state and where focus returns
 * on close live here, shared by the Q shortcut, the "+ Add task" button and (on phones and touch
 * screens, instead of that button) the floating add button, which opens it docked.
 */
export function InboxView({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const query = useQuery(tasksQuery(workspaceId, 'inbox'));
  // Cached rows win over a failed background refetch; the error shows only with nothing to show.
  const status: TaskListStatus = query.data ? 'ready' : query.isError ? 'error' : 'loading';

  const [quickAdd, setQuickAdd] = useState<QuickAddState>({ open: false });
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  // Phones (narrow) and touch screens (no hover) get the floating button instead of "+ Add task".
  const narrow = useIsNarrow();
  const touch = useHoverNone();
  const showFab = narrow || touch;
  const quickAddRef = useRef<QuickAddHandle>(null);

  const openQuickAdd = useCallback((mode: 'inline' | 'docked', opener: Element | null) => {
    if (quickAddRef.current) {
      quickAddRef.current.focusName();
      return;
    }
    const returnTo = opener instanceof HTMLElement && opener !== document.body ? opener : null;
    setQuickAdd({ open: true, mode, returnTo });
  }, []);

  const closeQuickAdd = useCallback(() => {
    const returnTo = quickAdd.open ? quickAdd.returnTo : null;
    // Commit first so the "+ Add task" button is visible again before it takes focus.
    flushSync(() => setQuickAdd({ open: false }));
    (returnTo?.isConnected ? returnTo : (addButtonRef.current ?? fabRef.current))?.focus();
  }, [quickAdd]);

  const dockedOpen = quickAdd.open && quickAdd.mode === 'docked';
  useKeyboardInset(dockedOpen);

  useGlobalShortcut(QUICK_ADD_KEY, () => openQuickAdd('inline', document.activeElement), {
    description: 'Add task',
    group: 'Tasks',
    enabled: canEdit,
  });

  // Stable: rows get their callbacks from one context value, never from inline lambdas.
  const { createTask, retry, discard } = useCreateTask(workspaceId);
  const rowActions = useMemo(() => ({ retry, discard }), [retry, discard]);

  const inlineOpen = quickAdd.open && quickAdd.mode === 'inline';
  return (
    <TaskActionsContext value={rowActions}>
      <h1 id="view-title" tabIndex={-1} className="text-lg font-semibold focus:outline-none">
        Inbox
      </h1>
      <TaskList
        tasks={query.data ?? []}
        status={status}
        onRetry={() => void query.refetch()}
        empty={<EmptyInbox touch={showFab} />}
        fallbackFocus={() => addButtonRef.current ?? fabRef.current}
      />
      {quickAdd.open ? (
        <QuickAdd ref={quickAddRef} target={INBOX} mode={quickAdd.mode} onCreate={createTask} onClose={closeQuickAdd} />
      ) : null}
      {showFab ? (
        <FloatingAddButton ref={fabRef} hidden={dockedOpen} onPress={(button) => openQuickAdd('docked', button)} />
      ) : (
        <Button
          ref={addButtonRef}
          variant="ghost"
          className="self-start text-muted-foreground hover:text-foreground"
          hidden={inlineOpen}
          onClick={(event) => openQuickAdd('inline', event.currentTarget)}
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          Add task
        </Button>
      )}
    </TaskActionsContext>
  );
}
