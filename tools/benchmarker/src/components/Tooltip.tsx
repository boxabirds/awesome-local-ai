import { useEffect, useRef, useState } from "react";

const GAP_PX = 6;
const MARGIN_PX = 8;
const MAX_WIDTH_PX = 340;
/** Room the tip needs below its element before it flips above. */
const FLIP_PX = 80;

interface Tip { text: string; x: number; y: number; above: boolean }

/** Where the tip goes for this element now, or null when the element is off screen (nothing to point at). */
function place(el: HTMLElement): Tip | null {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
  const above = r.bottom + GAP_PX + FLIP_PX > innerHeight;
  const x = Math.max(MARGIN_PX, Math.min(r.left, innerWidth - MAX_WIDTH_PX - MARGIN_PX));
  return { text: el.dataset.tip ?? "", x, y: above ? r.top - GAP_PX : r.bottom + GAP_PX, above };
}

/** The page's own tooltip for anything with data-tip: shown at once on hover or keyboard focus (a native title
 * waits for the mouse to rest, and often never shows), fixed to the viewport so a scrolling table can't clip it.
 *
 * The tip belongs to its element, not to a spot on the screen: a scroll moves it with the element, and hides it
 * only when the element leaves the screen. That matters for the keyboard: Tab to something off screen and the
 * browser focuses it first and scrolls it into view after, with the scroll's event a frame later still. A tip that
 * closed on scroll was gone by then; this one is placed again where the element has landed. */
export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) return;
      anchor.current = el;
      setTip(place(el));
    };
    const hide = (e: Event) => {
      const from = (e.target as Element | null)?.closest?.("[data-tip]");
      const to = ((e as FocusEvent | PointerEvent).relatedTarget as Element | null)?.closest?.("[data-tip]");
      if (from && from !== to) { anchor.current = null; setTip(null); }
    };
    const follow = () => {
      const el = anchor.current;
      if (!el) return;
      if (!el.isConnected) { anchor.current = null; setTip(null); return; }
      setTip(place(el));
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    addEventListener("scroll", follow, true);
    addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      removeEventListener("scroll", follow, true);
      removeEventListener("resize", follow);
    };
  }, []);
  if (!tip || !tip.text) return null;
  return (
    <div role="tooltip" className="tooltip" style={{ left: tip.x, top: tip.y, transform: tip.above ? "translateY(-100%)" : undefined, maxWidth: MAX_WIDTH_PX }}>
      {tip.text}
    </div>
  );
}
