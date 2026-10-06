/**
 * Dashed outline over the board while files are dragged over it.
 */

import type { JSX } from 'react';

export function DropHighlight(): JSX.Element {
  return <div className="vidi6-drop-highlight" data-vidi6="drop-highlight" aria-hidden="true" />;
}
