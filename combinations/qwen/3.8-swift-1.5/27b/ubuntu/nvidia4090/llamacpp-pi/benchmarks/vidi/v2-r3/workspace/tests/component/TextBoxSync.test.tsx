import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { createText, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { initDoc } from '../../src/shared/board-model';
import { TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';
import type { Measurer } from '../../src/client/objects/textLayout';

installComponentMocks();

/**
 * Story 9 (text box sync): remote text changes are not re-measured by the
 * receiving client (the sender writes the box and it syncs); local changes
 * produce exactly one box write; a remeasure whose box is unchanged writes
 * nothing.
 */

/** Fake measurer: 10 units per character at any size (width stable, height via lines). */
const fakeMeasure: Measurer = (text) => text.length * 10;

const REMOTE_ORIGIN = 'remote-peer';

function makeSyncedPair(): { local: Y.Doc; remote: Y.Doc } {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  initDoc(local);
  initDoc(remote);
  // Bidirectional sync the way y-websocket does it: send the diff for the
  // peer's state vector, applied with a non-LOCAL origin (so local writes
  // are distinguishable).
  const sync = (from: Y.Doc, to: Y.Doc) => {
    const diff = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
    if (diff.byteLength > 0) Y.applyUpdate(to, diff, REMOTE_ORIGIN);
  };
  local.on('update', () => sync(local, remote));
  remote.on('update', () => sync(remote, local));
  return { local, remote };
}

/**
 * Count box writes on one object: map transactions in which the stored
 * `width`/`height` values change. Text edits (the `text` field) do not
 * count. (This yjs build's map events don't expose `key`, so changes are
 * detected by comparing the tracked previous values.)
 */
function countBoxWrites(doc: Y.Doc, id: string, keys: Array<'width' | 'height'> = ['width', 'height']): {
  count: () => number;
  reset: () => void;
} {
  let n = 0;
  const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
  let lastW = m.get('width');
  let lastH = m.get('height');
  m.observe(() => {
    const w = m.get('width');
    const h = m.get('height');
    const changed =
      (keys.includes('width') && w !== lastW) || (keys.includes('height') && h !== lastH);
    if (changed) n += 1;
    lastW = w;
    lastH = h;
  });
  return {
    count: () => n,
    reset: () => {
      n = 0;
      lastW = m.get('width');
      lastH = m.get('height');
    },
  };
}

interface ProbeHandle {
  remeasureAfterLocalChange: () => void;
}

function Probe(props: { doc: Y.Doc; id: string; measure: Measurer; onReady: (h: ProbeHandle) => void }) {
  const { remeasureAfterLocalChange } = useTextBoxSync(props.doc, props.id, props.measure);
  if (!mounted.current) {
    mounted.current = true;
    props.onReady({ remeasureAfterLocalChange });
  }
  return null;
}
let mounted = { current: false };

function renderProbe(doc: Y.Doc, id: string): Promise<ProbeHandle> {
  return new Promise((resolve) => {
    mounted = { current: false };
    render(<Probe doc={doc} id={id} measure={fakeMeasure} onReady={resolve} />);
  });
}

describe('story 9: text box sync (component)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function storedBox(doc: Y.Doc, id: string): { width: number; height: number } {
    const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
    return { width: m.get('width') as number, height: m.get('height') as number };
  }

  // TC-12
  it('TC-12: remote text change → no box write by the local client; local change → exactly one write', async () => {
    const { local, remote } = makeSyncedPair();
    const id = createText(local, { x: 0, y: 0 }, 'g_test')!;
    // The creation write has settled; now count box writes only.
    const writes = countBoxWrites(local, id);

    const probe = await renderProbe(local, id);

    // 1) A REMOTE peer inserts text into the same object.
    act(() => {
      const rt = (remote.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      rt.insert(0, 'Hello remote');
    });
    // The receiving client must NOT write a box in response to a remote
    // change — only the sender measures.
    expect(writes.count()).toBe(0);

    // 2) A LOCAL edit → exactly one box write with the measured size.
    act(() => {
      const lt = (local.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      applyTextDiff(lt, 'Hello local', LOCAL_ORIGIN);
    });
    act(() => {
      probe.remeasureAfterLocalChange();
    });
    expect(writes.count()).toBe(1);
    const box = storedBox(local, id);
    // 11 chars × 10 units = 110 wide; one line at M.
    expect(box.width).toBe(110);
    expect(box.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // 3) The box write propagated to the remote peer (it is model data).
    const rbox = storedBox(remote, id);
    expect(rbox).toEqual(box);
  });

  // TC-13
  it('TC-13: remeasure whose box is unchanged → no write (negative); a real change writes once', async () => {
    const { local } = makeSyncedPair();
    const id = createText(local, { x: 0, y: 0 }, 'g_test')!;
    const writes = countBoxWrites(local, id);

    const probe = await renderProbe(local, id);

    // First remeasure writes the measured box (initial estimate → measured):
    // empty text measures 0 × one line at M, the stored estimate is 40 × one line.
    act(() => {
      probe.remeasureAfterLocalChange();
    });
    expect(writes.count()).toBe(1);
    const box1 = storedBox(local, id);
    expect(box1.width).toBe(0);
    expect(box1.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // Second remeasure with identical content → NO write.
    act(() => {
      probe.remeasureAfterLocalChange();
    });
    expect(writes.count()).toBe(1);

    // A size change whose remeasured box differs writes exactly once more
    // (empty text: height = one line at the new size).
    act(() => {
      setTextSize(local, id, 'L');
    });
    writes.reset();
    act(() => {
      probe.remeasureAfterLocalChange();
    });
    expect(writes.count()).toBe(1);
    const box2 = storedBox(local, id);
    expect(box2.width).toBe(0);
    expect(box2.height).toBe(TEXT_SIZES.L * TEXT_LINE_HEIGHT);
    expect(box2.height).not.toBe(box1.height);

    // And remeasuring again with the new size → no further write.
    act(() => {
      probe.remeasureAfterLocalChange();
    });
    expect(writes.count()).toBe(1);
  });

  it('auto → fixed transition (side-handle drag) rewraps and writes a new height once', async () => {
    const { local } = makeSyncedPair();
    const id = createText(local, { x: 0, y: 0 }, 'g_test')!;
    const probe = await renderProbe(local, id);

    // Give the text content and let it settle at its auto box.
    act(() => {
      const t = (local.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      applyTextDiff(t, 'one two three four five', LOCAL_ORIGIN);
    });
    act(() => {
      probe.remeasureAfterLocalChange();
    });
    const autoBox = storedBox(local, id);
    expect(autoBox.width).toBe(230); // 23 chars × 10
    const m = local.getMap('objects').get(id) as Y.Map<unknown>;
    expect(m.get('widthMode')).toBe('auto');

    // Count the rewrap's height write (the box write of the transition).
    const writes = countBoxWrites(local, id, ['height']);

    // A side-handle drag sets a fixed width narrower than the content.
    act(() => {
      setTextWidthFixed(local, id, 60);
    });
    act(() => {
      probe.remeasureAfterLocalChange();
    });
    expect(writes.count()).toBe(1); // one box write with the new height
    const fixedBox = storedBox(local, id);
    expect(fixedBox.width).toBe(60);
    expect(m.get('widthMode')).toBe('fixed');
    // Greedy at 6 chars/line: 'one' | 'two' | 'three' | 'four' | 'five' → 5 lines.
    expect(fixedBox.height).toBe(5 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(fixedBox.height).toBeGreaterThan(autoBox.height);
  });
});
