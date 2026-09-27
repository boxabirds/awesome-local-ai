import { useQuery } from '@tanstack/react-query';
import type { Counts } from '@todoodle/shared/schemas';
import { countsQuery } from '@/features/tasks/queries';
import { useWorkspace } from '@/features/workspace/useWorkspace';

/** '(5) Today · My Todoodle', or 'Today · My Todoodle' when nothing is due (prd.today_tab_title). */
export function todayTitle(count: number, workspaceName: string): string {
  return count > 0 ? `(${count}) Today · ${workspaceName}` : `Today · ${workspaceName}`;
}

// Hoisted: a stable select, so the title re-renders only when the number changes.
const selectTodayCount = (counts: Counts) => counts.today ?? 0;

/**
 * The tab title while Today is open (React 19 <title>). The number is the shared counts query's `today` (no request
 * of its own); the name is the cached workspace. The workspace link and its secret are never read here.
 */
export function TodayTitle({ workspaceId }: { workspaceId: string }) {
  const { data: count = 0 } = useQuery({ ...countsQuery(workspaceId), select: selectTodayCount });
  const { data: workspace } = useWorkspace(workspaceId);
  return workspace ? <title>{todayTitle(count, workspace.name)}</title> : null;
}
