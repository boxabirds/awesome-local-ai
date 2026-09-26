import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { primeOpen } from '@/features/workspace/bootOpen';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { SECRET, WORKSPACE, getHandler } from './fixtures.ts';
import { renderApp } from './render.tsx';

export const ID = WORKSPACE.id;
export const SAVED_KEY = `tdl:v1:linkSaved:${ID}`;

export function isSaved(): boolean {
  return localStorage.getItem(SAVED_KEY) === '1';
}

/** /w#<secret> with the workspace already known (as right after create). */
export async function enterByHash(opts: { saved?: boolean; justCreated?: boolean } = {}) {
  queryClient.setQueryData(queryKeys.workspace(ID), WORKSPACE);
  primeOpen(SECRET, WORKSPACE);
  if (opts.saved) localStorage.setItem(SAVED_KEY, '1');
  const rendered = await renderApp(`/w#${SECRET}`, { state: opts.justCreated ? { justCreated: true } : undefined });
  await screen.findByRole('textbox', { name: 'Workspace name', hidden: true });
  return rendered;
}

/** /w/:id (entered from the remembered list): the workspace comes from GET, no secret in JS. */
export async function enterById(opts: { saved?: boolean } = {}) {
  server.use(getHandler());
  if (opts.saved) localStorage.setItem(SAVED_KEY, '1');
  const rendered = await renderApp(`/w/${ID}`);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('My Todoodle'));
  return rendered;
}
