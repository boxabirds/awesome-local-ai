// A concertina item: a heading that carries its figure and opens to its whole content, in the page's own flow (nothing inside it
// scrolls). Closed at first. The open item's heading pins under the app's pinned bar (conversation.css), so one click closes it
// wherever the reader has scrolled to. The body is rendered only while open: a 100,000-character thinking costs nothing closed.
import type { ReactNode } from "react";

export function Concertina({ block, label, figure, tip, open, onToggle, disabled = false, children }: {
  block: string; label: string; figure: ReactNode; tip?: string; open: boolean; onToggle: () => void; disabled?: boolean; children?: ReactNode;
}) {
  const bodyId = `cc-${block}`;
  return (
    <section className="cc" data-block={block} data-open={open ? "true" : "false"}>
      <button type="button" className="cc-head" aria-expanded={open} aria-controls={bodyId} disabled={disabled} onClick={onToggle}>
        <span className="cc-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="cc-label">{label}</span>
        <span className="cc-figure" data-tip={tip}>{figure}</span>
      </button>
      {open && !disabled ? <div className="cc-body" id={bodyId}>{children}</div> : null}
    </section>
  );
}
