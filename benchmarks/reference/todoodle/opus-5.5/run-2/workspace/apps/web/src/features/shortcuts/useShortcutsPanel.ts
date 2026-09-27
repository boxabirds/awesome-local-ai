import { SHORTCUT_HELP_KEY } from '@todoodle/shared/limits';
import { createElement, lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { useGlobalShortcut } from '@/lib/shortcuts';

const loadPanel = () => import('./ShortcutsPanel');
const ShortcutsPanel = lazy(loadPanel);

/** Warms the panel's chunk so the first `?` opens it at once. */
export function preloadShortcutsPanel(): void {
  void loadPanel();
}

type PanelState = { open: boolean; returnFocusTo: HTMLElement | null };

/**
 * Registers `?` (Show keyboard shortcuts) and returns the panel to render. The panel's chunk is
 * preloaded once the browser is idle after the first paint.
 */
export function useShortcutsPanel(): ReactNode {
  const [state, setState] = useState<PanelState>({ open: false, returnFocusTo: null });

  useGlobalShortcut(
    SHORTCUT_HELP_KEY,
    () => {
      const active = document.activeElement;
      setState({ open: true, returnFocusTo: active instanceof HTMLElement && active !== document.body ? active : null });
    },
    { description: 'Show keyboard shortcuts', group: 'General' },
  );

  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preloadShortcutsPanel);
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(preloadShortcutsPanel, 0);
    return () => clearTimeout(timer);
  }, []);

  const onOpenChange = (open: boolean) => setState((current) => ({ ...current, open }));
  // Mounted from the first open on, so it can animate closed and restore focus.
  if (!state.open && state.returnFocusTo === null) return null;
  return createElement(
    Suspense,
    { fallback: null },
    createElement(ShortcutsPanel, { open: state.open, onOpenChange, returnFocusTo: state.returnFocusTo }),
  );
}
