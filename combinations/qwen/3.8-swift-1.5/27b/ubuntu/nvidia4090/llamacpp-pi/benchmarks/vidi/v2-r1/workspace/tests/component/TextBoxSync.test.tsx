import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import * as React from 'react';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '@shared/board-model';
import {
  createText, setTextSize, getTextContent,
} from '@shared/objects/text';
import * as textModule from '@shared/objects/text';
import { applyTextDiff } from '@shared/text-edit';
import { useTextBoxSync } from '@client/objects/useTextBoxSync';
import type { Measurer } from '@client/objects/textLayout';

/** Fake measurer: 10 world units per character. */
const measure: Measurer = (text) => text.length * 10;

function Probe({
  doc, id, onReady,
}: {
  doc: Y.Doc;
  id: string;
  onReady(sync: { remeasureAfterLocalChange(): void }): void;
}) {
  const sync = useTextBoxSync(doc, id, measure);
  React.useEffect(() => {
    onReady(sync);
  }, [sync, onReady]);
  return null;
}

describe('useTextBoxSync (box sync)', () => {
  let doc: Y.Doc;
  let id: string;
  let spy: MockInstance<(doc: Y.Doc, id: string, box: { width: number; height: number }) => boolean>;
  let sync: { remeasureAfterLocalChange(): void } | null = null;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    spy = vi.spyOn(textModule, 'setTextBox');
    render(
      <Probe
        doc={doc}
        id={id}
        onReady={(s) => { sync = s; }}
      />,
    );
  });

  afterEach(() => {
    cleanup();
    spy.mockRestore();
    doc.destroy();
    sync = null;
  });

  // TC-12: a remote peer changes the text → zero setTextBox writes on the
  // local client; a local text change → exactly one write.
  it('TC-12: remote text changes cause no box writes; a local change causes one', () => {
    expect(sync).not.toBeNull();

    // Remote peer inserts text (non-local origin).
    const peer = Symbol('PEER');
    act(() => {
      doc.transact(() => {
        getTextContent(doc, id)!.insert(0, 'remote');
      }, peer);
    });
    // The hook never observes remote changes: no writes.
    expect(spy).not.toHaveBeenCalled();

    // Local change: minimal diff + remeasure → exactly one write.
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'local', LOCAL_ORIGIN);
      sync!.remeasureAfterLocalChange();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const box = spy.mock.calls[0][2] as { width: number; height: number };
    expect(box.width).toBe(50); // 'local' = 5 chars × 10
    expect(box.height).toBe(26); // 1 line at M

    // Remeasuring again with no change → no further write.
    act(() => { sync!.remeasureAfterLocalChange(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // TC-13: a local size change whose re-measured box equals the stored box
  // → zero writes (no no-op writes).
  it('TC-13: re-measured box equal to the stored box → zero writes', () => {
    expect(sync).not.toBeNull();

    // Establish a box.
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'word', LOCAL_ORIGIN);
      sync!.remeasureAfterLocalChange();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();

    // Re-applying the current size: the layout is unchanged, so the
    // re-measured box equals the stored box → no write.
    act(() => {
      expect(setTextSize(doc, id, 'M')).toBe(true);
      sync!.remeasureAfterLocalChange();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a size change that alters the layout writes the new box once', () => {
    expect(sync).not.toBeNull();
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'word', LOCAL_ORIGIN);
      sync!.remeasureAfterLocalChange();
    });
    spy.mockClear();

    act(() => {
      expect(setTextSize(doc, id, 'XL')).toBe(true);
      sync!.remeasureAfterLocalChange();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const box = spy.mock.calls[0][2] as { width: number; height: number };
    expect(box.height).toBe(56 * 1.3); // XL font, one line
  });
});
