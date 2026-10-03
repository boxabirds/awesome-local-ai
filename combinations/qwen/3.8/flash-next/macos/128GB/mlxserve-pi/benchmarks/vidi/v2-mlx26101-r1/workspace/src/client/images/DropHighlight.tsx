// The drop highlight (image.drop): the board's "let it go here" answer to a picture being dragged
// over the window.
//
// It listens on the window rather than on the board element, because a drag does not politely stay
// inside the element it entered: the browser fires dragenter and dragleave as the pointer crosses
// every object, toolbar button and gap on its way. Counting them is the only way to know whether the
// drag is still over the window at all — a naive show-on-enter / hide-on-leave flickers as soon as
// the pointer crosses anything, which is the failure this component exists to prevent.
//
// `dragover` keeps the highlight showing while the count is zero. That is not a workaround for a
// bug: the dragenter that a real browser guarantees before the first dragover is one a synthetic
// drag — a test driving the flow directly — may not send, and a highlight that appeared only on the
// way out would be worse than no highlight.

import { useEffect, useState } from 'react';

/** What the e2e test looks for while a file is being dragged. */
export const DROP_HIGHLIGHT_TESTID = 'drop-highlight';

/** Above the canvas and the chrome, below a toast; never a target for the pointer. */
const HIGHLIGHT_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 10,
  borderRadius: 16,
  border: '4px dashed #4c8dff',
  background: 'rgba(76, 141, 255, 0.10)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 35,
};

const LABEL_STYLE: React.CSSProperties = {
  background: '#1d2430',
  color: '#f2f5fa',
  font: "500 15px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif",
  padding: '6px 14px',
  borderRadius: '0 0 12px 12px',
};

export function DropHighlight() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    // How many dragenter events have not had a matching dragleave. Only zero means the drag has
    // really left the window.
    let depth = 0;

    const onDragEnter = () => {
      depth += 1;
      setActive(true);
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDragOver = () => {
      if (depth === 0) setActive(true);
    };
    // Both of these end the drag however it ends: dropped here, dropped somewhere else, or
    // cancelled with Escape. A highlight that stayed up after that would be a lie.
    const onEnd = () => {
      depth = 0;
      setActive(false);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onEnd);
    window.addEventListener('dragend', onEnd);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onEnd);
      window.removeEventListener('dragend', onEnd);
    };
  }, []);

  if (!active) return null;

  // The words are for a person; the id is for the test that checks they show up.
  return (
    <div data-testid={DROP_HIGHLIGHT_TESTID} style={HIGHLIGHT_STYLE} aria-hidden={true}>
      <span style={LABEL_STYLE}>Drop images to add them</span>
    </div>
  );
}
