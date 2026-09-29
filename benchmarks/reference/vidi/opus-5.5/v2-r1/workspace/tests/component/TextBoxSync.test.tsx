// text.layout box sync (TC-12, TC-13): only the client making a local change writes the box.
import { cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { layoutText } from '../../src/client/objects/textLayout';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import {
  getTextContent,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { connectedPeers } from '../unit/peer';
import { countLocalWrites, docWithText, fakeMeasure, textOf } from './textHelpers';

afterEach(cleanup);

describe('text.layout useTextBoxSync', () => {
  it('TC-12 a remote text change causes no local write; a local change exactly one', () => {
    const { local, remote } = connectedPeers();
    const { id } = docWithText('Went', { x: 0, y: 0 }, local);
    const { result } = renderHook(() => useTextBoxSync(local, id, fakeMeasure));
    // The rendered board must not re-measure remote changes either.
    render(<App doc={local} />);
    const writes = countLocalWrites(local);

    getTextContent(remote, id)!.insert(4, ' well, really well');
    expect(textOf(local, id)!.text).toBe('Went well, really well');
    expect(writes.n).toBe(0);

    applyTextDiff(getTextContent(local, id)!, 'Went well', LOCAL_ORIGIN);
    const before = writes.n;
    result.current.remeasureAfterLocalChange();
    expect(writes.n - before).toBe(1);
    const expected = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    expect(textOf(local, id)).toMatchObject({ width: expected.width, height: expected.height });
    expect(textOf(remote, id)).toMatchObject({ width: expected.width, height: expected.height });
  });

  it('TC-13 a size change whose re-measured box equals the stored box writes nothing', () => {
    const { doc, id } = docWithText('Went well');
    const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasure));
    result.current.remeasureAfterLocalChange();
    // Same box already stored for L: the remeasure after switching size is not a write.
    const atL = layoutText('Went well', 'L', 'auto', null, fakeMeasure);
    setTextBox(doc, id, atL);
    setTextSize(doc, id, 'L');
    const writes = countLocalWrites(doc);
    result.current.remeasureAfterLocalChange();
    expect(writes.n).toBe(0);
    result.current.remeasureAfterLocalChange();
    expect(writes.n).toBe(0);
    expect(textOf(doc, id)).toMatchObject({ width: atL.width, height: atL.height });
  });

  it('auto → fixed after a width drag rewraps and writes the new height once', () => {
    const { doc, id } = docWithText('Went well today');
    const { result } = renderHook(() => useTextBoxSync(doc, id, fakeMeasure));
    result.current.remeasureAfterLocalChange();
    expect(textOf(doc, id)!.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    setTextWidthFixed(doc, id, 60);
    const writes = countLocalWrites(doc);
    result.current.remeasureAfterLocalChange();
    result.current.remeasureAfterLocalChange();
    expect(writes.n).toBe(1);
    expect(textOf(doc, id)).toMatchObject({ width: 60, widthMode: 'fixed' });
    expect(textOf(doc, id)!.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
