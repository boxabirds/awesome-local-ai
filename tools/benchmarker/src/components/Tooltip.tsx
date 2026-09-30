import { useEffect, useState } from "react";

const GAP_PX = 6;
const MARGIN_PX = 8;
const MAX_WIDTH_PX = 340;

interface Tip { text: string; x: number; y: number; above: boolean }

/** The page's own tooltip for anything with data-tip: shown at once on hover or keyboard focus (a native title
 * waits for the mouse to rest, and often never shows), fixed to the viewport so a scrolling table can't clip it. */
export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const above = r.bottom + GAP_PX + 80 > innerHeight;
      const x = Math.max(MARGIN_PX, Math.min(r.left, innerWidth - MAX_WIDTH_PX - MARGIN_PX));
      setTip({ text: el.dataset.tip ?? "", x, y: above ? r.top - GAP_PX : r.bottom + GAP_PX, above });
    };
    const hide = (e: Event) => {
      const from = (e.target as Element | null)?.closest?.("[data-tip]");
      const to = ((e as FocusEvent | PointerEvent).relatedTarget as Element | null)?.closest?.("[data-tip]");
      if (from && from !== to) setTip(null);
    };
    const away = () => setTip(null);
    document.addEventListener("pointerover", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      removeEventListener("scroll", away, true);
    };
  }, []);
  if (!tip || !tip.text) return null;
  return (
    <div role="tooltip" className="tooltip" style={{ left: tip.x, top: tip.y, transform: tip.above ? "translateY(-100%)" : undefined, maxWidth: MAX_WIDTH_PX }}>
      {tip.text}
    </div>
  );
}
