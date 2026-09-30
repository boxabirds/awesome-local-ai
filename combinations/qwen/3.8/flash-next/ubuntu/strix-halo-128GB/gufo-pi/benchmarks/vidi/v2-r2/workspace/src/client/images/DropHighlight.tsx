import type { ReactElement } from 'react';

export function DropHighlight({ visible }: { visible: boolean }): ReactElement | null {
  if (!visible) return null;
  return (
    <div
      className="drop-highlight"
      data-testid="drop-highlight"
      aria-hidden="true"
    />
  );
}
