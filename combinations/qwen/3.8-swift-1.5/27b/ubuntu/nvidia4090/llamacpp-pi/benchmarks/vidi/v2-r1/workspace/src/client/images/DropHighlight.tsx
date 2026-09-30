/**
 * Story 12: full-viewport drop highlight (image.insert).
 *
 * Shows while a drag carrying files is over the window (dragenter/
 * dragleave with a depth counter, since child elements fire their own
 * enter/leave pairs). Self-managed: window-level listeners, no props
 * needed for visibility. `imageToolActive` (picker open) switches the
 * accent colour.
 *
 * The overlay is pointer-events: none so the drop lands on the viewport,
 * and it calls preventDefault on dragover so the browser accepts the drop.
 */
import { useEffect, useRef, useState } from 'react';

function eventHasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  if (types instanceof DOMTokenList) return types.contains('Files');
  return Array.from(types).includes('Files');
}

export function DropHighlight({ imageToolActive }: { imageToolActive?: boolean }): React.ReactElement | null {
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setVisible(true);
    };
    const onDragOver = (e: DragEvent) => {
      // Required for the browser to allow dropping.
      if (!eventHasFiles(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!eventHasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setVisible(false);
    };
    const onDrop = () => {
      depth.current = 0;
      setVisible(false);
    };
    const onDragEnd = () => {
      // Drag cancelled (Esc) outside the window.
      depth.current = 0;
      setVisible(false);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
    };
  }, []);

  if (!visible) return null;
  const accent = imageToolActive ? '#16a34a' : '#2563eb';
  return (
    <div
      data-testid="drop-highlight"
      data-image-tool={imageToolActive ? 'true' : 'false'}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        pointerEvents: 'none',
        border: `3px dashed ${accent}`,
        background: imageToolActive ? 'rgba(22,163,74,0.08)' : 'rgba(37,99,235,0.08)',
      }}
    />
  );
}
