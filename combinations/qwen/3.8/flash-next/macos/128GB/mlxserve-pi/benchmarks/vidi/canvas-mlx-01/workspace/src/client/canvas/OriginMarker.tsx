import type { JSX } from 'react';

/**
 * A crosshair painted at the board's starting point (world 0,0), present in every
 * build so users (and the end-to-end tests) always have a known place to return to.
 * It is counter-scaled so it stays the same size on screen at any zoom level.
 */
export function OriginMarker(props: { zoom: number }): JSX.Element {
  return (
    <svg
      className="vidi-origin-marker"
      data-testid="origin-marker"
      width={22}
      height={22}
      viewBox="0 0 22 22"
      aria-hidden="true"
      focusable="false"
      style={{ transform: `translate(-50%, -50%) scale(${1 / props.zoom})` }}
    >
      <line x1="11" y1="0" x2="11" y2="22" />
      <line x1="0" y1="11" x2="22" y2="11" />
      <circle cx="11" cy="11" r="3" />
    </svg>
  );
}
