/** Exact first-use hint copy (PRD: nav.hint). */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * Bottom-centre first-use hint. Rendered when `visible` is true, otherwise
 * renders nothing. Not persisted: a reload shows it again (per PRD).
 */
export function NavigationHint(props: NavigationHintProps) {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" role="status" data-navigation-hint="">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
