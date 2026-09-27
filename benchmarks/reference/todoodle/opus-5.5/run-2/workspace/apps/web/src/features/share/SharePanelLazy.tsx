import { lazy, Suspense } from 'react';
import type { SharePanelProps } from './SharePanel';

const SharePanel = lazy(() => import('./SharePanel'));

/** Warms the panel chunk (Share button hover/focus, and right after create). */
export function preloadSharePanel() {
  return import('./SharePanel');
}

/** The SharePanel, loaded on first use. Nothing is fetched until it is opened. */
export function SharePanelLazy(props: SharePanelProps) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <SharePanel {...props} />
    </Suspense>
  );
}
