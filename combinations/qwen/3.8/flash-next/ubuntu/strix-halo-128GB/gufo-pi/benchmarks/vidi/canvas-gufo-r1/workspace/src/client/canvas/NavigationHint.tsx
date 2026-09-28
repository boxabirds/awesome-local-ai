// First-use navigation hint (anchor: nav.hint_display). Pure presentational
// component: renders the hint text or nothing. Not persisted — a reload shows
// it again. `visible` is driven by `!hasNavigated` from useCamera.

export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint(props: NavigationHintProps) {
  if (!props.visible) return null;
  return (
    <div
      className="navigation-hint"
      data-testid="navigation-hint"
      role="status"
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
