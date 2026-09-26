import { Suspense, lazy, useState } from 'react';
import type { ShortcutsPanelProps } from './ShortcutsPanel';
import { loadShortcutsPanel } from './useShortcutsPanel';

const ShortcutsPanel = lazy(loadShortcutsPanel);

/** Mounts the lazily loaded panel the first time it opens, then keeps it so it can animate closed. */
export function ShortcutsPanelLazy(props: ShortcutsPanelProps) {
  const [mounted, setMounted] = useState(props.open);
  if (props.open && !mounted) setMounted(true);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <ShortcutsPanel {...props} />
    </Suspense>
  );
}
