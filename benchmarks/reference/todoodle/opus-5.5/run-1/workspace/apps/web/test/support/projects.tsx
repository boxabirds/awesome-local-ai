import { screen, within } from '@testing-library/react';
import { server } from '../msw.ts';
import type { ProjectServer } from '../msw/projectServer.ts';
import { getHandler } from './fixtures.ts';
import { renderApp } from './render.tsx';
import { ID } from './tasks.tsx';

export { ID };

/** /w/:id (or a project path under it) served by the stateful project server. Resolves once the view heading shows. */
export async function enterWithProjects(api: ProjectServer, path = `/w/${ID}`, heading: string | RegExp = 'Inbox') {
  server.use(getHandler(), ...api.handlers);
  localStorage.setItem(`tdl:v1:linkSaved:${ID}`, '1');
  const rendered = await renderApp(path);
  await screen.findByRole('heading', { name: heading, level: 1 });
  return rendered;
}

export function projectsPath(projectId: string): string {
  return `/w/${ID}/project/${projectId}`;
}

/** The inline sidebar ('Lists' navigation; the first one is the desktop sidebar). Found even behind a modal. */
export function sidebar(): HTMLElement {
  return screen.getAllByRole('navigation', { name: 'Lists', hidden: true })[0]!;
}

/** The sidebar entry that opens a project (its accessible name carries the open count). */
export function projectLink(name: string): HTMLElement {
  return within(sidebar()).getByRole('button', { name: new RegExp(`^${escape(name)}(, \\d+ open tasks?)?$`), hidden: true });
}

export function projectMenu(name: string): HTMLElement {
  return within(sidebar()).getByRole('button', { name: `More actions for ${name}` });
}

/** Names of the projects in the sidebar, in order. */
export function sidebarProjectNames(): string[] {
  return [...sidebar().querySelectorAll<HTMLElement>('[data-project-row] [data-project-link]')].map((el) => el.title);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
