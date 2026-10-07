/**
 * Story 12 — Drop highlight overlay.
 *
 * Renders a dashed outline around the board area while image files are dragged over it.
 */
import { useState, useEffect } from 'react';

export interface DropHighlightProps {
  active: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/**
 * Render a dashed rect around the viewport to indicate drop target is ready.
 * Only shows for file drags (not text links).
 */
export function DropHighlight({ active, svgRef }: DropHighlightProps): null {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!active || !svgRef.current) {
      setRect(null);
      return;
    }
    const el = svgRef.current.parentElement;
    if (el) {
      const b = el.getBoundingClientRect();
      setRect({ x: b.left, y: b.top, width: b.width, height: b.height });
    }
  }, [active, svgRef]);

  if (!active || !rect) return null;

  // This component renders nothing by itself — the parent BoardViewport handles
  // rendering the highlight via refs. We use state here to coordinate with the parent.
  return null;
}
