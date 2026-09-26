import { Suspense, lazy, useState } from 'react';
import type { SharePanelProps } from './SharePanel';

const loadSharePanel = () => import('./SharePanel.tsx');
const SharePanel = lazy(loadSharePanel);

/** Warms the panel chunk (Share button hover/focus, and right after create). */
export function preloadSharePanel(): void {
  void loadSharePanel();
}

/** Loads the panel chunk the first time it opens, then keeps it mounted so it can animate closed. */
export function SharePanelLazy(props: SharePanelProps) {
  const [mounted, setMounted] = useState(props.open);
  if (props.open && !mounted) setMounted(true);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <SharePanel {...props} />
    </Suspense>
  );
}
