import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { preloadForgetDialog } from '@/features/remembered/forgetDialogLoader';
import { server } from '../msw.ts';
import { A, rememberedHandler } from '../support/remembered.ts';
import { renderApp } from '../support/render.tsx';

// Counts evaluations of the ForgetDialog module: the factory runs once, when the chunk is first imported.
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/features/remembered/ForgetDialog', async (importOriginal) => {
  loads.count++;
  return importOriginal();
});

describe('forget.confirm_dialog lazy loading (TC-72)', () => {
  it('not imported until the row menu is wanted; imported once however often it is preloaded', async () => {
    server.use(rememberedHandler([A]));
    const { user } = await renderApp('/');
    await screen.findByRole('heading', { name: 'Your workspaces on this browser' });
    expect(loads.count).toBe(0);

    const trigger = screen.getByRole('button', { name: `More actions for ${A.name}` });
    await user.click(trigger);
    await screen.findByRole('menuitem', { name: 'Forget on this browser' });
    await vi.waitFor(() => expect(loads.count).toBe(1));

    await user.keyboard('{Escape}');
    await user.hover(trigger);
    await user.unhover(trigger);
    await user.hover(trigger);
    expect(preloadForgetDialog()).toBe(preloadForgetDialog());
    await preloadForgetDialog();
    expect(loads.count).toBe(1);
  });
});
