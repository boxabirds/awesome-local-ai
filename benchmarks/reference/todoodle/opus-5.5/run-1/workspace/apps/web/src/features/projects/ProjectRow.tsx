import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HINT_VISIBLE_MS, TASK_ROW_INTRINSIC_HEIGHT_PX } from '@todoodle/shared/limits';
import type { Counts } from '@todoodle/shared/schemas';
import { createContext, memo, use, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { EllipsisIcon, PencilIcon, TrashIcon } from '@/components/icons';
import { NAME_EMPTY_TEXT } from '@/components/NameField';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { countsQuery, tasksQuery } from '@/features/tasks/queries';
import { navItemName } from '@/features/workspace/SidebarNavItem';
import { useHoverNone } from '@/lib/useHoverNone';
import { cn } from '@/lib/utils';
import { preloadProjectView } from '@/routes/lazy';
import { ProjectDot } from './ProjectDot';
import { RenameProjectInline } from './RenameProjectInline';

/** Row callbacks, shared through context (stable functions), so rows only take primitive props. */
export type ProjectRowActions = {
  open: (id: string) => void;
  rename: (id: string, name: string) => void;
  /** '…' > Delete: the confirmation dialog; focus returns to `trigger` when it closes. */
  requestDelete: (id: string, trigger: HTMLElement | null) => void;
  /** The '…' menu opened: warm what its items need (the delete dialog chunk). */
  onMenuOpen: () => void;
};

const noop = () => {};

export const ProjectRowActionsContext = createContext<ProjectRowActions>({ open: noop, rename: noop, requestDelete: noop, onMenuOpen: noop });

/** Test hook: counts ProjectRow renders per project id (TC-64). Never read by the app. */
export const projectRowRenders = new Map<string, number>();

/** Module-level (hoisted): one count source per row, bound to the row's id with useCallback. */
export function selectOpenCount(counts: Counts, projectId: string): number | undefined {
  return counts.projects?.[projectId]?.open;
}

/**
 * Off-screen rows (up to MAX_PROJECTS_PER_WORKSPACE) skip layout and paint. Per row, never on the list.
 * A CSSOM style (allowed by the CSP, unlike a style attribute).
 */
const ROW_STYLE = { contentVisibility: 'auto', containIntrinsicSize: `auto ${TASK_ROW_INTRINSIC_HEIGHT_PX}px` } as const;

type Props = { wid: string; id: string; name: string; colorKey: string; isActive: boolean };

type MenuChoice = 'rename' | 'delete';

/**
 * One project in the sidebar: colour dot, name (truncated, full name on hover), open-task count (hidden at 0)
 * and a '…' menu (Rename, Delete). The '…' button shows on row hover or keyboard focus with a mouse, and always
 * on touch screens; rows, '…' and every control are at least 44x44. Memoised with primitive props: the count is
 * read here from the counts query (never passed in), so a count change re-renders only its own row. Hover or
 * focus warms the project view chunk and the project's task list.
 */
export const ProjectRow = memo(function ProjectRow({ wid, id, name, colorKey, isActive }: Props) {
  projectRowRenders.set(id, (projectRowRenders.get(id) ?? 0) + 1);
  const actions = use(ProjectRowActionsContext);
  const queryClient = useQueryClient();
  const selectCount = useCallback((counts: Counts) => selectOpenCount(counts, id), [id]);
  const { data: openCount } = useQuery({ ...countsQuery(wid), select: selectCount });
  const touch = useHoverNone();
  const [editing, setEditing] = useState(false);
  // Bumped for every refused blank rename, so the hint's timer restarts each time (0: no hint).
  const [hint, setHint] = useState(0);
  const linkRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuChoice = useRef<MenuChoice | null>(null);
  const warmed = useRef(false);

  // 'Name can't be empty' stays for HINT_VISIBLE_MS after a blank rename was refused.
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(0), HINT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  const warm = useCallback(() => {
    if (warmed.current) return;
    warmed.current = true;
    void preloadProjectView();
    void queryClient.prefetchQuery(tasksQuery(wid, { list: 'project', projectId: id }));
  }, [queryClient, wid, id]);

  const stopEditing = () => {
    flushSync(() => setEditing(false));
    linkRef.current?.focus();
  };

  const onMenuCloseAutoFocus = (event: Event) => {
    const choice = menuChoice.current;
    menuChoice.current = null;
    if (!choice) return;
    event.preventDefault();
    if (choice === 'rename') setEditing(true);
    else actions.requestDelete(id, triggerRef.current);
  };

  return (
    <li data-project-row={id} style={ROW_STYLE} className="group relative flex flex-col">
      <div className="flex items-center">
        {editing ? (
          <RenameProjectInline
            name={name}
            onSave={(next) => {
              stopEditing();
              actions.rename(id, next);
            }}
            onCancel={stopEditing}
            onBlank={() => {
              stopEditing();
              setHint((n) => n + 1);
            }}
          />
        ) : (
          <button
            ref={linkRef}
            type="button"
            data-project-link={id}
            aria-current={isActive ? 'page' : undefined}
            aria-label={navItemName(name, openCount)}
            title={name}
            onClick={() => actions.open(id)}
            onPointerEnter={warm}
            onFocus={warm}
            className={cn(
              'flex min-h-11 min-w-11 flex-1 items-center gap-3 rounded-md px-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
              isActive && 'bg-muted font-medium',
            )}
          >
            <ProjectDot color={colorKey} />
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span aria-hidden="true" data-count-slot className="flex w-8 shrink-0 justify-end text-xs tabular-nums text-muted-foreground">
              {openCount ? openCount : null}
            </span>
          </button>
        )}
        {editing ? null : (
          <DropdownMenu modal={false} onOpenChange={(open) => open && actions.onMenuOpen()}>
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                aria-label={`More actions for ${name}`}
                data-project-menu-trigger={id}
                className={cn(
                  'flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100',
                  // With a mouse: on row hover or keyboard focus. Touch screens have no hover: always shown.
                  touch ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100',
                )}
              >
                <EllipsisIcon aria-hidden="true" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={onMenuCloseAutoFocus}>
              <DropdownMenuItem onSelect={() => (menuChoice.current = 'rename')}>
                <PencilIcon aria-hidden="true" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => (menuChoice.current = 'delete')}>
                <TrashIcon aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {hint > 0 ? (
        <p role="status" data-name-hint className="px-3 pb-1 text-xs text-muted-foreground">
          {NAME_EMPTY_TEXT}
        </p>
      ) : null}
    </li>
  );
});
