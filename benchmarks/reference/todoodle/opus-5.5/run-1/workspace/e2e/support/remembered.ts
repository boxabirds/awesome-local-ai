import { type Page, expect } from '@playwright/test';
import { createWorkspace, nameField } from './workspace.ts';

export const LIST_HEADING = 'Your workspaces on this browser';
export const EMPTY_HINT = 'Have a link? Open it to get back in.';
export const DROPPED_NOTICE = "Your least recently opened workspace was removed from this browser's list. Its link still works.";

export type Named = { id: string; link: string; secret: string; name: string };

/** Creates a workspace, skips saving the link, and renames it (so rows are easy to tell apart). */
export async function createNamed(page: Page, name: string): Promise<Named> {
  const created = await createWorkspace(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  // The panel hands focus back to Share when it closes; rename only after that, or the focus move eats the typing.
  await expect(page.getByRole('button', { name: 'Share' })).toBeFocused();
  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
  await nameField(page).fill(name);
  await expect(nameField(page)).toHaveValue(name);
  await nameField(page).press('Enter');
  await saved;
  return { id: created.id, link: created.link, secret: created.secret, name };
}

export function rememberedRegion(page: Page) {
  return page.getByRole('region', { name: LIST_HEADING });
}

/** Names of the remembered rows on the page, in order. */
export async function rowNames(page: Page): Promise<string[]> {
  const links = rememberedRegion(page).getByRole('listitem').getByRole('link');
  const names = await links.evaluateAll((els) => els.map((el) => el.querySelector('span')?.textContent ?? ''));
  return names;
}

/** Goes Home and waits for the remembered list. */
export async function goHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: LIST_HEADING })).toBeVisible();
}

export function rowLink(page: Page, name: string) {
  return rememberedRegion(page).getByRole('link', { name: new RegExp(`^${escapeRegExp(name)}`) });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Opens a row's '...' menu and chooses 'Forget on this browser'; returns the confirmation dialog. */
export async function openForget(page: Page, name: string) {
  await page.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Forget on this browser' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading', { name: `Forget ${name} on this browser?` })).toBeVisible();
  return dialog;
}
