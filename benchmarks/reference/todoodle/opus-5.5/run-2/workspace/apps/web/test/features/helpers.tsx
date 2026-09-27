import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppProviders } from '@/App';
import { resetIsNarrowForTests } from '@/features/workspace/useIsNarrow';
import { resetHoverNoneForTests } from '@/lib/useHoverNone';

/** Renders a component with the app's providers and a router, inside an awaited act(). */
export async function renderWithProviders(ui: ReactNode, { path = '/w/0123456789abcdef0123456789abcdef' } = {}): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <AppProviders>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </AppProviders>,
    );
  });
  return result;
}

/**
 * Stubs matchMedia for a viewport width and pointer: `(max-width: Npx)` matches when the width is at
 * most N, `(hover: none)` when the pointer is coarse. Call before rendering.
 */
export function stubViewport({ width, coarse = false }: { width: number; coarse?: boolean }) {
  resetHoverNoneForTests();
  resetIsNarrowForTests();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const maxWidth = /\(max-width:\s*([\d.]+)px\)/.exec(query);
    const matches = maxWidth ? width <= Number(maxWidth[1]) : query === '(hover: none)' ? coarse : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  });
}

/** Everything reachable with Tab, in order (no layout in happy-dom, so the DOM order decides). */
export function tabbables(root: ParentNode = document.body): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, [tabindex]');
  return [...candidates].filter((el) => {
    if (el.tabIndex < 0) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    return true;
  });
}

/** Moves focus as Tab (or Shift+Tab) would. */
export function pressTab({ shift = false } = {}) {
  const order = tabbables();
  const at = order.indexOf(document.activeElement as HTMLElement);
  const next = shift ? order[at - 1] : order[at + 1];
  act(() => next?.focus());
}
