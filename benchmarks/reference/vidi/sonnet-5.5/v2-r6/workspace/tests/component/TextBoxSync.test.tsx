import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, getTextContent, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';
import type { Measurer } from '../../src/client/objects/textLayout';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';

const tenPerChar: Measurer = (t) => t.length * 10;

function Probe(props: { doc: Y.Doc; id: string }) {
  const { remeasureAfterLocalChange } = useTextBoxSync(props.doc, props.id, tenPerChar);
  return <button onClick={remeasureAfterLocalChange}>remeasure</button>;
}

/** A local doc and a peer doc kept in sync; counts the local doc's own (LOCAL_ORIGIN) transactions. */
function setup() {
  const local = new Y.Doc();
  const peer = new Y.Doc();
  initDoc(local);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), 'remote');
  const link = (from: Y.Doc, to: Y.Doc) => from.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(to, u, 'remote');
  });
  link(local, peer);
  link(peer, local);
  let writes = 0;
  local.on('update', (_u: Uint8Array, origin: unknown) => { if (origin === LOCAL_ORIGIN) writes += 1; });
  const id = createText(local, { x: 0, y: 0 }, 'g_a') as string;
  writes = 0;
  render(<Probe doc={local} id={id} />);
  const box = () => {
    const m = local.getMap('objects').get(id) as Y.Map<unknown>;
    return { width: m.get('width'), height: m.get('height') };
  };
  return { local, peer, id, writes: () => writes, box };
}

const remeasure = () => act(() => { fireEvent.click(screen.getByText('remeasure')); });

describe('useTextBoxSync', () => {
  it('TC-12 a remote text change causes no write; a local change causes exactly one box write', () => {
    const { local, peer, id, writes, box } = setup();
    act(() => { getTextContent(peer, id)!.insert(0, 'from the peer'); });
    expect(getTextContent(local, id)!.toString()).toBe('from the peer');
    expect(writes()).toBe(0);

    act(() => { getTextContent(local, id)!.insert(0, 'abc', undefined); });
    // a plain Y.Text insert outside the editor has no origin; the hook still writes only on request
    expect(writes()).toBe(0);
    remeasure();
    expect(writes()).toBe(1);
    expect(box()).toEqual({ width: 'abcfrom the peer'.length * 10 + 4, height: 20 * 1.3 });
  });

  it('TC-13 a remeasure that yields the stored box writes nothing', () => {
    const { local, id, writes } = setup();
    act(() => { local.transact(() => getTextContent(local, id)!.insert(0, 'hi'), LOCAL_ORIGIN); });
    remeasure();
    const after = writes();
    remeasure();
    remeasure();
    expect(writes()).toBe(after);
    act(() => { setTextSize(local, id, 'M'); }); // already M: nothing changes
    remeasure();
    expect(writes()).toBe(after + 0);
  });

  it('a width drag makes the text fixed, rewraps, and writes the new height once', () => {
    const { local, id, box } = setup();
    act(() => { local.transact(() => getTextContent(local, id)!.insert(0, 'one two six'), LOCAL_ORIGIN); });
    remeasure();
    expect(box().height).toBeCloseTo(26);
    act(() => { setTextWidthFixed(local, id, 40); });
    remeasure();
    expect(box()).toEqual({ width: 40, height: 3 * 26 });
  });
});
