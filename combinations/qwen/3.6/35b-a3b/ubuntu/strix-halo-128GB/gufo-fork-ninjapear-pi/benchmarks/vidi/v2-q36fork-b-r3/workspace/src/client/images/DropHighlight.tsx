/** Drop highlight overlay for story 12 — dashed outline when files are dragged over board */

import React, { useRef, useEffect, useState } from 'react';

interface DropHighlightProps {
  enabled: boolean;
}

export function DropHighlight({ enabled }: DropHighlightProps) {
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleDragEnter = (e: DragEvent) => {
      // Only respond to file drags
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (!types.includes('Files')) return;
      targetRef.current = e.target instanceof HTMLElement ? e.target.tagName : '';

      // Debounce with rAF
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setVisible(true));
    };

    const handleDragLeave = (e: DragEvent) => {
      // Hide when leaving the window or a child of our target
      if (targetRef.current === '') return;
      const relatedTarget = e.relatedTarget;
      if (!(relatedTarget instanceof Element)) {
        // Leaving the window entirely → hide
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setVisible(false));
        targetRef.current = '';
        return;
      }
      // Check if we're still within the same draggable region
      if ((e.target as HTMLElement).contains(relatedTarget)) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setVisible(false));
      targetRef.current = '';
    };

    const handleDrop = () => {
      setVisible(false);
      targetRef.current = '';
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        border: '3px dashed #2196F3',
        borderRadius: 8,
        background: 'rgba(33, 150, 243, 0.08)',
        pointerEvents: 'none',
        zIndex: 9999,
        boxSizing: 'border-box',
      }}
    />
  );
}
