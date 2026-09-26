import { http, HttpResponse } from 'msw';
import { type Project, ProjectListResponse, ProjectSchema } from '@todoodle/shared/schemas';
import { PROJECT_COLORS } from '@todoodle/shared/limits';

// MSW handlers for story 7's project endpoints. Every response goes through the shared zod schemas.

let counter = 0;
/** A 32-char lowercase hex project id, unique within the test run. */
export function projectId(n = ++counter): string {
  return n.toString(16).padStart(32, 'b');
}

export function makeProject(fields: Partial<Project> & { name: string }, index = 0): Project {
  return ProjectSchema.parse({
    id: projectId(),
    color: PROJECT_COLORS[index % PROJECT_COLORS.length]!.key,
    sortOrder: index + 1,
    version: 1,
    createdAt: '2026-09-26 10:00:00',
    updatedAt: '2026-09-26 10:00:00',
    ...fields,
  });
}

/** GET /api/w/:id/projects with a fixed list. */
export function projectsHandler({ projects = [], status = 200 }: { projects?: Project[]; status?: number } = {}) {
  return http.get('/api/w/:id/projects', () => {
    if (status !== 200) return HttpResponse.json({ error: 'internal', message: 'x' }, { status });
    return HttpResponse.json(ProjectListResponse.parse({ projects }));
  });
}

/** Default: a workspace with no projects. */
export const defaultProjectHandlers = [projectsHandler()];
