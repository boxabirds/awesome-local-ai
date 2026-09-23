/**
 * Story 1 · task 5 — the first-use navigation hint (design "nav.hint_display").
 *
 * Rendered bottom-centre until the user's first pan or zoom, then gone for
 * the rest of the visit. Not persisted: a reload brings it back (PRD).
 */

/** Exact PRD copy. Exported so tests and the e2e suite assert one source. */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div className="nav-hint" data-testid="navigation-hint" data-visible="true">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
