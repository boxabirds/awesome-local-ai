export interface NavigationHintProps {
  visible: boolean;
}

export const NAVIGATION_HINT_TEXT =
  "Drag to move around · Ctrl/Cmd + scroll or pinch to zoom";

/**
 * First-use navigation hint (bottom-centre). Removed (rendered as null) once the
 * user has navigated; not persisted, so a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "6px 12px",
        background: "var(--panel-bg)",
        border: "1px solid var(--panel-border)",
        borderRadius: 10,
        color: "#444",
        pointerEvents: "none",
      }}
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
