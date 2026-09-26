import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useCallback, useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { HighlightedText } from '@/components/combobox/HighlightedText';
import { OptionRow } from '@/components/combobox/OptionRow';
import { ResponsiveCommand } from '@/components/combobox/ResponsiveCommand';
import { InboxIcon } from '@/components/icons';
import { ProjectDot } from '@/features/projects/ProjectDot';
import { useProjects } from '@/features/projects/useProjects';
import { queryKeys } from '@/lib/queryKeys';
import { type Destination, type DestinationOption, INBOX_DESTINATION, filterDestinations } from './filterDestinations';
import { closeMovePicker } from './movePicker';
import type { LocalTask } from './taskCache';
import { useTaskActions } from './useTaskMutations';

export const MOVE_TO_TITLE = 'Move to…';
export const MOVE_TO_PLACEHOLDER = 'Type a project name';
export const NO_MATCHING_PROJECTS = 'No matching projects';

type Props = {
  workspaceId: string;
  taskId: string;
  /** The task's row: the popover sits beside it, and focus returns to it when the picker closes without a move. */
  row: HTMLElement | null;
};

const inboxIcon = <InboxIcon aria-hidden="true" className="size-4 shrink-0" />;

function optionKey(option: DestinationOption): string {
  return option.id ?? 'inbox';
}

/** The next enabled option from `from` in `step` direction (clamped at the ends), or `from` if there is none. */
function nextEnabled(options: readonly DestinationOption[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
  return from;
}

/**
 * Move to… (tasks.ui_move_picker): a search box over the Inbox and every project, the Inbox first. Typing
 * filters by name (case, accents and surrounding spaces ignored; the list renders from a deferred query so
 * typing stays responsive with 300 projects). The task's current list is marked with a check and cannot be
 * chosen. ↑/↓ move (skipping it), Enter or a click moves the task and closes; Escape clears the query, then
 * closes and returns focus to the task row. A popover beside the task on wide screens, a bottom panel on
 * phones. Lazy chunk, preloaded when a task menu opens or M is pressed.
 */
export function MoveToPicker({ workspaceId, taskId, row }: Props) {
  const queryClient = useQueryClient();
  const actions = useTaskActions(workspaceId);
  const { data: projects } = useProjects(workspaceId);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const moved = useRef(false);
  const ids = useId();
  const listboxId = `${ids}-listbox`;

  // The task's list now (read once: the picker belongs to this moment).
  const [currentListId] = useState<string | null>(() => {
    for (const [, list] of queryClient.getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(workspaceId) })) {
      const task = list?.find((item) => item.id === taskId);
      if (task) return task.projectId ?? null;
    }
    return null;
  });

  const destinations = useMemo<Destination[]>(
    () => [
      INBOX_DESTINATION,
      ...(projects?.list ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        colorKey: project.color,
        searchKey: projects!.searchKeys.get(project.id)!,
      })),
    ],
    [projects],
  );
  const options = useMemo(() => filterDestinations(destinations, deferredQuery, currentListId), [destinations, deferredQuery, currentListId]);

  // The active option: kept while it is still offered and enabled, otherwise the first enabled one.
  const activeIndex = useMemo(() => {
    const kept = options.findIndex((option) => optionKey(option) === activeKey && !option.disabled);
    return kept !== -1 ? kept : options.findIndex((option) => !option.disabled);
  }, [options, activeKey]);

  const latest = useRef({ options, activeIndex });
  useLayoutEffect(() => {
    latest.current = { options, activeIndex };
  });

  const choose = useCallback(
    (index: number) => {
      const option = latest.current.options[index];
      if (!option || option.disabled) return;
      moved.current = true;
      // Close first (the picker leaves the DOM), then act from the row: the move sends focus to the next row.
      flushSync(() => closeMovePicker());
      row?.focus();
      void actions.move(taskId, option.id);
    },
    [actions, row, taskId],
  );
  const hover = useCallback((index: number) => {
    const option = latest.current.options[index];
    if (option && !option.disabled) setActiveKey(optionKey(option));
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (activeIndex === -1) return;
      const next = nextEnabled(options, activeIndex, event.key === 'ArrowDown' ? 1 : -1);
      setActiveKey(optionKey(options[next]!));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex !== -1) choose(activeIndex);
    }
  };

  return (
    <ResponsiveCommand
      open
      onOpenChange={(open) => {
        if (!open) closeMovePicker();
      }}
      title={MOVE_TO_TITLE}
      anchor={row}
      onEscapeKeyDown={(event) => {
        // Escape clears a query first; a second Escape closes.
        if (query === '') return;
        event.preventDefault();
        setQuery('');
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (moved.current) return;
        (row?.isConnected ? row : document.getElementById('view-title'))?.focus();
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-label={MOVE_TO_TITLE}
        aria-expanded="true"
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex === -1 ? undefined : `${ids}-option-${activeIndex}`}
        autoFocus
        autoComplete="off"
        placeholder={MOVE_TO_PLACEHOLDER}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {options.length === 0 ? (
        <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {NO_MATCHING_PROJECTS}
        </p>
      ) : (
        <ul id={listboxId} role="listbox" aria-label="Lists" className="flex max-h-72 flex-col overflow-y-auto" data-move-options>
          {options.map((option, index) => (
            <OptionRow
              key={optionKey(option)}
              id={`${ids}-option-${index}`}
              index={index}
              active={index === activeIndex}
              disabled={option.disabled}
              checked={option.disabled}
              adornment={option.colorKey ? <ProjectDot color={option.colorKey} /> : inboxIcon}
              onChoose={choose}
              onHover={hover}
            >
              <HighlightedText text={option.name} query={deferredQuery} />
            </OptionRow>
          ))}
        </ul>
      )}
    </ResponsiveCommand>
  );
}
