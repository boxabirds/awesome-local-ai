import { Suspense, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PlusIcon } from '@/components/icons';
import type { SidebarSlotProps } from '@/features/workspace/Sidebar';
import { LazyCreateProjectDialog, preloadCreateProjectDialog } from './createProjectDialogLoader';
import { LazyDeleteProjectDialog, preloadDeleteProjectDialog } from './deleteProjectDialogLoader';
import { ProjectRow, type ProjectRowActions, ProjectRowActionsContext } from './ProjectRow';
import { useProjectMutations } from './useProjectMutations';
import { useProjects } from './useProjects';

/** The sidebar view name of a project (SidebarSlotProps.current / onNavigate). */
export function projectView(id: string): string {
  return `project:${id}`;
}

// Hoisted static JSX (rendering-hoist-jsx): shown when the workspace has no projects.
const emptyHint = (
  <p data-projects-hint className="px-3 py-1 text-xs text-muted-foreground">
    Group tasks by area
  </p>
);

function preloadDialog() {
  void preloadCreateProjectDialog();
}

type Props = SidebarSlotProps & { workspaceId: string };

/** The project whose delete confirmation is open, and the '…' button that asked for it. */
type Deleting = { id: string; name: string; trigger: HTMLElement | null; open: boolean };

/**
 * Story 7's Projects section of the sidebar (inline and in the phone drawer): a 'Projects' heading with '+',
 * then the projects in creation order. Selecting a project navigates there (and closes the drawer, through the
 * drawer's onNavigate). The list container is plain: content-visibility is set per row.
 */
export function ProjectsSidebarSection({ workspaceId, current, onNavigate }: Props) {
  const { data } = useProjects(workspaceId);
  const actions = useProjectMutations(workspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  // Each open starts a fresh dialog (key), so text from a cancelled attempt never comes back.
  const [createKey, setCreateKey] = useState(0);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const confirmed = useRef(false);
  // Read inside the (stable) row actions, so a route or list change never rebuilds them (or re-renders rows).
  const latest = useRef({ current, data });
  useLayoutEffect(() => {
    latest.current = { current, data };
  });

  const rowActions = useMemo<ProjectRowActions>(
    () => ({
      open: (id) => onNavigate(projectView(id)),
      rename: (id, name) => void actions.update(id, { name }),
      requestDelete: (id, trigger) => {
        const project = latest.current.data?.byId.get(id);
        if (!project) return;
        confirmed.current = false;
        setDeleting({ id, name: project.name, trigger, open: true });
      },
      onMenuOpen: () => void preloadDeleteProjectDialog(),
    }),
    [actions, onNavigate],
  );

  const confirmDelete = () => {
    if (!deleting) return;
    confirmed.current = true;
    // Leave a project before it disappears (to the Inbox, keeping the address's fragment).
    if (latest.current.current === projectView(deleting.id)) onNavigate('inbox');
    void actions.remove(deleting.id);
  };

  const openCreate = useCallback(() => {
    setCreateKey((key) => key + 1);
    setCreateOpen(true);
  }, []);

  const projects = data?.list ?? [];
  return (
    <section aria-labelledby={headingId} className="mt-4 flex flex-col gap-1" data-projects-section>
      <div className="flex items-center justify-between pl-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none">
          Projects
        </h2>
        <button
          type="button"
          aria-label="Add project"
          data-add-project
          onClick={openCreate}
          onPointerEnter={preloadDialog}
          onFocus={preloadDialog}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </button>
      </div>
      {projects.length === 0 ? (
        emptyHint
      ) : (
        <ProjectRowActionsContext value={rowActions}>
          <ul aria-labelledby={headingId} className="flex flex-col" data-project-list>
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                wid={workspaceId}
                id={project.id}
                name={project.name}
                colorKey={project.color}
                isActive={current === projectView(project.id)}
              />
            ))}
          </ul>
        </ProjectRowActionsContext>
      )}
      {deleting ? (
        <Suspense fallback={null}>
          <LazyDeleteProjectDialog
            key={deleting.id}
            workspaceId={workspaceId}
            projectId={deleting.id}
            name={deleting.name}
            open={deleting.open}
            onOpenChange={(open) => setDeleting((state) => (state ? { ...state, open } : state))}
            onConfirm={confirmDelete}
            returnFocus={() => (!confirmed.current && deleting.trigger?.isConnected ? deleting.trigger : headingRef.current)}
          />
        </Suspense>
      ) : null}
      {createKey > 0 ? (
        <Suspense fallback={null}>
          <LazyCreateProjectDialog
            key={createKey}
            workspaceId={workspaceId}
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={(project) => onNavigate(projectView(project.id))}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
