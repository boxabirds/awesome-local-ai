import { SHORTCUT_HELP_KEY } from '@todoodle/shared/limits';
import { useCallback, useEffect, useState } from 'react';
import { useGlobalShortcut } from '@/lib/shortcuts';

export const loadShortcutsPanel = () => import('./ShortcutsPanel.tsx');

/** Warms the panel chunk once the browser is idle after first paint, so the first ? opens instantly. */
function schedulePreload(): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(() => void loadShortcutsPanel());
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(() => void loadShortcutsPanel(), 1);
  return () => window.clearTimeout(timer);
}

/** Registers ? (not while typing) to open the shortcuts panel. Returns the panel's open state. */
export function useShortcutsPanel(): { open: boolean; onOpenChange: (open: boolean) => void } {
  const [open, setOpen] = useState(false);
  useGlobalShortcut(SHORTCUT_HELP_KEY, () => setOpen(true), { description: 'Show keyboard shortcuts', group: 'General' });
  useEffect(() => schedulePreload(), []);
  const onOpenChange = useCallback((next: boolean) => setOpen(next), []);
  return { open, onOpenChange };
}
