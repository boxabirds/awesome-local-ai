import { useQuery } from '@tanstack/react-query';
import type { Project } from '@todoodle/shared/schemas';
import { normaliseForSearch } from '@todoodle/shared/search';
import { projectsQuery } from './queries';

export type ProjectsView = {
  /** Active projects in creation order. */
  list: Project[];
  /** O(1) lookup by id (js-index-maps). */
  byId: Map<string, Project>;
  /** normaliseForSearch(name) per project id, computed once per data change (not per keystroke in Move to…). */
  searchKeys: Map<string, string>;
};

/** Module-level (a stable reference), so TanStack Query recomputes it only when the list changes. */
export function selectProjects(list: Project[]): ProjectsView {
  return {
    list,
    byId: new Map(list.map((project) => [project.id, project])),
    searchKeys: new Map(list.map((project) => [project.id, normaliseForSearch(project.name)])),
  };
}

/** The workspace's projects, with an id index built once per data change. */
export function useProjects(workspaceId: string) {
  return useQuery({ ...projectsQuery(workspaceId), select: selectProjects });
}
