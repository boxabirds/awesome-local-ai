import { memo } from 'react';
import { InboxIcon } from '@/components/icons';
import { ProjectDot } from '@/features/projects/ProjectDot';

// Hoisted (rendering-hoist-jsx).
const inboxIcon = <InboxIcon aria-hidden="true" className="size-3 shrink-0" />;

/**
 * Where a task on Today lives (prd.today_project_context): its project's colour dot and name, or 'Inbox'.
 * Primitive props (memo). The name is text, so the colour never carries the meaning alone.
 */
export const ProjectTag = memo(function ProjectTag({ projectName, projectColor }: { projectName: string | null; projectColor: string | null }) {
  return (
    <span data-project-tag className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {projectName ? <ProjectDot color={projectColor ?? ''} className="size-2" /> : inboxIcon}
      <span className="truncate">{projectName ?? 'Inbox'}</span>
    </span>
  );
});
