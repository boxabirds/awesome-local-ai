import type { JSX } from 'react';

// Dashed outline shown over the whole board while files are dragged over
// it; purely decorative, the a11y announcement comes from the toasts.
export function DropHighlight({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />;
}
