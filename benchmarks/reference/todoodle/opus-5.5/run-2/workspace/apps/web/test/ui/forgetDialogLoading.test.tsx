import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { preloadForgetDialog } from '@/features/remembered/forgetDialogLoader';
import { A_ID, rememberedEntry, rememberedHandlers } from '../fixtures';
import { server } from '../msw';
import { openMenu, renderApp } from '../render';

// Counts real evaluations of the ForgetDialog module (the factory runs once per import).
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/features/remembered/ForgetDialog', async (importOriginal) => {
  loads.count++;
  return importOriginal();
});

describe('ForgetDialog loading (TC-72)', () => {
  it('not imported with Home; imported once on menu open; repeated preloads reuse it', async () => {
    server.use(rememberedHandlers.list([rememberedEntry(A_ID, 'Alpha')]));
    await renderApp({ pathname: '/' });
    const trigger = await screen.findByRole('button', { name: 'More actions for Alpha' });
    await new Promise((r) => setTimeout(r, 20));
    expect(loads.count).toBe(0);

    await openMenu(trigger);
    await vi.waitFor(() => expect(loads.count).toBe(1));

    fireEvent.pointerEnter(trigger);
    fireEvent.pointerEnter(trigger);
    expect(preloadForgetDialog()).toBe(preloadForgetDialog());
    await preloadForgetDialog();
    expect(loads.count).toBe(1);

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Forget on this browser' }));
    expect(await screen.findByRole('alertdialog', { name: 'Forget Alpha on this browser?' })).toBeInTheDocument();
    expect(loads.count).toBe(1);
  });
});
