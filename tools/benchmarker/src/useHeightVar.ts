// Things pinned to the top of the window stack: the app's top bar, then the page's breadcrumb. Each keeps its own
// height in a CSS variable on the root, so the next one down knows where to pin (styles.css: --header-h, --crumb-h),
// and so the browser keeps what it scrolls into view (an anchor, a focused element) clear of both.
import { useLayoutEffect, useRef } from "react";

/** A ref for an element whose height is kept in the root's CSS variable `name` while it is on the page. */
export function useHeightVar<T extends HTMLElement>(name: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty(name, `${el.getBoundingClientRect().height}px`);
    set();
    const seen = new ResizeObserver(set);
    seen.observe(el);
    return () => { seen.disconnect(); root.style.removeProperty(name); };
  }, [name]);
  return ref;
}
