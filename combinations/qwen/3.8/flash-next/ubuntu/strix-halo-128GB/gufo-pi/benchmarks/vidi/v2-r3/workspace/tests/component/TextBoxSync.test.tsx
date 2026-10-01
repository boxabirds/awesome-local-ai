import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, getObjectsMap, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, setTextSize, getTextContent, setTextBox } from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';

// Create a simple test component that uses useTextBoxSync
interface SyncTestProps {
  doc: Y.Doc;
  id: string;
  measure: Measurer;
  onWrite?: () => void;
}

function SyncTestComponent({ doc, id, measure, onWrite }: SyncTestProps) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measure);

  // Expose it globally for test access
  React.useEffect(() => {
    (window as any).__remeasure = remeasureAfterLocalChange;
  }, [remeasureAfterLocalChange]);

  // Patch setTextBox to track writes
  React.useEffect(() => {
    const objects = getObjectsMap(doc);
    const observer = () => {
      const m = objects.get(id);
      if (!m) return;
    };
    // Track width/height changes via observeDeep
    let lastW = (m: Y.Map<unknown> | undefined) => (m?.get('width') as number);
    let lastH = (m: Y.Map<unknown> | undefined) => (m?.get('height') as number);
    const m0 = objects.get(id);
    let prevW = lastW(m0);
    let prevH = lastH(m0);
    const handler = (events: Y.YEvent<any>[]) => {
      for (const event of events) {
        if (event instanceof Y.YMapEvent && event.target === objects.get(id)) {
          const m = objects.get(id);
          const newW = lastW(m);
          const newH = lastH(m);
          if (newW !== prevW || newH !== prevH) {
            onWrite?.();
          }
          prevW = newW;
          prevH = newH;
        }
      }
    };
    objects.observeDeep(handler);
    return () => { objects.unobserveDeep(handler); };
  }, [doc, id, onWrite]);

  return <div data-testid="sync-component" />;
}

// Simple fake measurer: 8 world-units per character
const fakeMeasure: Measurer = (text, _fontPx) => text.length * 8;

describe('useTextBoxSync', () => {
  it('TC-12: remote text change → zero setTextBox writes; local text change → one write', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'user1')!;

    // Start with empty text; stored box is the initial estimate
    let writeCount = 0;

    render(
      <SyncTestComponent
        doc={doc}
        id={id}
        measure={fakeMeasure}
        onWrite={() => { writeCount++; }}
      />
    );

    // Simulate a remote change (non-LOCAL_ORIGIN)
    const remoteOrigin = Symbol('remote');
    act(() => {
      const ytext = getTextContent(doc, id)!;
      doc.transact(() => { ytext.insert(0, 'remote text'); }, remoteOrigin);
    });
    // Remote changes should NOT trigger box sync
    expect(writeCount).toBe(0);

    // Simulate a local change
    act(() => {
      const ytext = getTextContent(doc, id)!;
      doc.transact(() => { ytext.insert(0, 'local '); }, LOCAL_ORIGIN);
      // Now trigger remeasure (as the editor would)
      (window as any).__remeasure();
    });
    // Local change + remeasure → one write (since the text changed, the box changes)
    expect(writeCount).toBe(1);
  });

  it('TC-13: local size change whose remeasured box equals the stored box → no write (negative)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'user1')!;

    // Set text with one character at size M: width = 1 * 8 = 8, height = 1 * 20 * 1.3 = 26
    const ytext = getTextContent(doc, id)!;
    act(() => {
      doc.transact(() => { ytext.insert(0, 'X'); }, LOCAL_ORIGIN);
    });
    // Set the stored box manually to what remeasureAfterLocalChange would compute
    act(() => {
      setTextBox(doc, id, { width: 8, height: Math.round(1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT) });
    });

    let writeCount = 0;

    render(
      <SyncTestComponent
        doc={doc}
        id={id}
        measure={fakeMeasure}
        onWrite={() => { writeCount++; }}
      />
    );

    // Size change from M to M (same) — won't be triggered because setTextSize returns false
    // Instead let's change size and then remeasure where the box already matches
    // Change to S size: height changes to 1 * 14 * 1.3 = 18. Width is still 8 (1 char × 8).
    act(() => {
      setTextSize(doc, id, 'S');
    });

    // Reset write count after the size change itself
    writeCount = 0;

    // Now set box to what S size would give
    act(() => {
      setTextBox(doc, id, { width: 8, height: Math.round(1 * TEXT_SIZES.S * TEXT_LINE_HEIGHT) });
    });
    writeCount = 0;

    // Now remeasure — the box is already correct, so no write should happen
    act(() => {
      (window as any).__remeasure();
    });
    expect(writeCount).toBe(0);
  });
});
