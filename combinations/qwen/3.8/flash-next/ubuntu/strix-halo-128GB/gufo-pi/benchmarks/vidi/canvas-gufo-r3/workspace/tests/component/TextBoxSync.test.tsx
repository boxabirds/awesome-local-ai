import { describe, it, expect } from 'vitest';
import React, { useRef } from 'react';
import * as Y from 'yjs';
import { render, act } from '@testing-library/react';
import { createText, setTextBox, getTextContent } from '@shared/objects/text';
import { LOCAL_ORIGIN } from '@shared/board-model';
import { applyTextDiff } from '@shared/text-edit';
import { useTextBoxSync } from '@client/objects/useTextBoxSync';
import { Measurer } from '@client/objects/textLayout';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_LINE_HEIGHT, TEXT_SIZES } from '@shared/config';

const CHAR_RATIO = 0.5;
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * CHAR_RATIO;

interface Handle {
  remeasure(): void;
}

function Harness({ doc, id, handleRef }: { doc: Y.Doc; id: string; handleRef: React.MutableRefObject<Handle | null> }) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, fakeMeasure);
  handleRef.current = { remeasure: remeasureAfterLocalChange };
  return null;
}

describe('useTextBoxSync (text.layout)', () => {
  it('TC-12: remote text change writes nothing; local text change + remeasure writes once', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    const yt = getTextContent(doc, id)!;

    // Count box writes from local origin
    let writes = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      // A box write touches the map's 'width'/'height'; we detect via the map event below instead.
      void _u; void origin;
    });
    const map = doc.getMap('objects').get(id) as Y.Map<unknown>;
    map.observe((e) => {
      if (e.keysChanged.has('width') || e.keysChanged.has('height')) writes++;
    });

    const handleRef = { current: null as Handle | null };
    render(<Harness doc={doc} id={id} handleRef={handleRef} />);

    // Remote change: apply with a remote origin (not LOCAL_ORIGIN); no remeasure call
    act(() => {
      applyTextDiff(yt, 'remote text', { remote: true }, 5000);
    });
    expect(writes).toBe(0);

    // Local change + remeasure
    act(() => {
      applyTextDiff(yt, 'hello', LOCAL_ORIGIN, 5000);
      handleRef.current!.remeasure();
    });
    expect(writes).toBe(1);
    // width should equal measured longest line 5*20*0.5=50, height one line
    expect(map.get('width')).toBe(50);
    expect(map.get('height')).toBe(Math.ceil(TEXT_SIZES.M * TEXT_LINE_HEIGHT));
  });

  it('TC-13: local change whose remeasured box equals the stored box writes nothing', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    const yt = getTextContent(doc, id)!;
    // Pre-seed the correct box for 'hi' (2*20*0.5=20 wide, 1 line)
    setTextBox(doc, id, { width: 20, height: Math.ceil(TEXT_SIZES.M * TEXT_LINE_HEIGHT) });

    let writes = 0;
    const map = doc.getMap('objects').get(id) as Y.Map<unknown>;
    map.observe((e) => {
      if (e.keysChanged.has('width') || e.keysChanged.has('height')) writes++;
    });

    const handleRef = { current: null as Handle | null };
    render(<Harness doc={doc} id={id} handleRef={handleRef} />);

    act(() => {
      applyTextDiff(yt, 'hi', LOCAL_ORIGIN, 5000);
      handleRef.current!.remeasure();
    });
    expect(writes).toBe(0);
  });
});
