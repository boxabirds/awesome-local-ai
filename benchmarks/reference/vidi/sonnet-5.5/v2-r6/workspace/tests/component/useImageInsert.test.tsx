import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useMemo } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDoc, snapshot, type ImageSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { ImageEnvContext, ImageObject } from '../../src/client/objects/ImageObject';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { Toast } from '../../src/client/ui/Toast';

interface Pending { file: File; progress(f: number): void; resolve(r: { kind: 'ok'; assetKey: string } | { kind: 'failed' }): void }
const pending: Pending[] = [];
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((_board: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: Pending['resolve'];
    const promise = new Promise<Parameters<Pending['resolve']>[0]>((r) => { resolve = r; });
    pending.push({ file, progress: onProgress, resolve });
    return { promise, abort: () => {} };
  }),
}));
import { uploadImage } from '../../src/client/images/uploadImage';

const images = (doc: Y.Doc) => snapshot(doc).filter((o): o is ImageSnapshot => o.type === 'image');
const png = (name: string) => new File(['x'], name, { type: 'image/png' });

let doc: Y.Doc;
let api: ReturnType<typeof useImageInsert>;

function Harness({ connection = 'connected' as ConnectionState }) {
  const d = useMemo(() => { const x = new Y.Doc(); initDoc(x); doc = x; return x; }, []);
  api = useImageInsert({
    doc: d, boardId: 'board', camera: { x: 0, y: 0, zoom: 1 }, connection, identityId: 'me',
    viewCentre: () => ({ x: 500, y: 300 }),
  });
  return (
    <div>
      <div
        data-testid="surface"
        onDragOver={api.onDragOver as never}
        onDrop={api.onDrop as never}
      />
      <textarea data-testid="editor" />
      <Toast messages={api.messages} />
      <ImageEnvContext.Provider value={{ identityId: 'me', progress: api.progress, canRetry: api.canRetry, retry: api.retry }}>
        {images(d).map((i) => (
          <div key={i.id} data-testid="img" data-status={i.status}>
            <ImageObject image={i} isUploader progress={api.progress.get(i.id)} canRetry={api.canRetry(i.id)} now={Date.now()} onRetry={() => api.retry(i.id)} onRemove={() => {}} />
          </div>
        ))}
      </ImageEnvContext.Provider>
    </div>
  );
}

// jsdom has no DragEvent, so the pointer position is attached to the plain event by hand.
function drop(files: File[], x = 100, y = 50, types = ['Files']) {
  const e = createEvent.drop(screen.getByTestId('surface'), { dataTransfer: { files, types } });
  Object.defineProperty(e, 'clientX', { value: x });
  Object.defineProperty(e, 'clientY', { value: y });
  fireEvent(screen.getByTestId('surface'), e);
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  pending.length = 0;
  vi.mocked(uploadImage).mockClear();
  vi.stubGlobal('createImageBitmap', async (f: File) => {
    if (f.name.startsWith('corrupt')) throw new Error('decode');
    return { width: 400, height: 300, close() {} };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useImageInsert', () => {
  it('TC-17: dropping three files places them in a row from the drop point and shows progress then the image', async () => {
    render(<Harness />);
    drop([png('a.png'), png('b.png'), png('c.png')]);
    await flush();
    const all = images(doc).sort((p, q) => p.x - q.x);
    expect(all).toHaveLength(3);
    expect(all.map((i) => i.x)).toEqual([100, 100 + 400 + IMAGE_LAYOUT_GAP_WORLD, 100 + 2 * (400 + IMAGE_LAYOUT_GAP_WORLD)]);
    expect(all.every((i) => i.y === 50 && i.width === 400 && i.height === 300 && i.status === 'uploading')).toBe(true);
    expect(pending).toHaveLength(3);

    act(() => pending[0].progress(0.42));
    expect(screen.getAllByTestId('image-progress')[0].textContent).toBe('42%');

    await act(async () => pending[0].resolve({ kind: 'ok', assetKey: 'b/a' }));
    expect(images(doc).filter((i) => i.status === 'ready')).toHaveLength(1);
    expect(images(doc).find((i) => i.status === 'ready')?.assetKey).toBe('b/a');
  });

  it('a failed upload marks the image failed and Retry uploads the same file again', async () => {
    render(<Harness />);
    drop([png('a.png')]);
    await flush();
    await act(async () => pending[0].resolve({ kind: 'failed' }));
    const [img] = images(doc);
    expect(img.status).toBe('failed');
    expect(api.canRetry(img.id)).toBe(true);
    act(() => { api.retry(img.id); });
    expect(images(doc)[0].status).toBe('uploading');
    expect(pending).toHaveLength(2);
    expect(pending[1].file).toBe(pending[0].file);
  });

  it('TC-18: pasting while editing text adds no image; pasting with the board focused centres it in view', async () => {
    render(<Harness />);
    const clipboard = { files: [png('shot.png')] };
    const paste = (target: Element) => {
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: clipboard });
      act(() => { target.dispatchEvent(e); });
      return e;
    };
    const editor = screen.getByTestId('editor');
    editor.focus();
    const ignored = paste(editor);
    await flush();
    expect(ignored.defaultPrevented).toBe(false);
    expect(images(doc)).toHaveLength(0);

    editor.blur();
    paste(document.body);
    await flush();
    const [img] = images(doc);
    expect(img.x + img.width / 2).toBe(500);
    expect(img.y + img.height / 2).toBe(300);
  });

  it('TC-19: dropping while reconnecting shows the offline toast and creates nothing', async () => {
    render(<Harness connection="reconnecting" />);
    drop([png('a.png')]);
    await flush();
    expect(screen.getByRole('status').textContent).toContain(REJECTION_MESSAGES.offline);
    expect(images(doc)).toHaveLength(0);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('TC-29: a file that cannot be decoded gets the type toast and no placeholder', async () => {
    render(<Harness />);
    drop([png('corrupt.png'), png('ok.png')]);
    await flush();
    expect(screen.getByRole('status').textContent).toContain(REJECTION_MESSAGES.type);
    expect(images(doc)).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });

  it('refused types and sizes are reported together while valid files are still added', async () => {
    render(<Harness />);
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const huge = png('big.png');
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 });
    drop([pdf, huge, png('ok.png')]);
    await flush();
    const text = screen.getByRole('status').textContent;
    expect(text).toContain(REJECTION_MESSAGES.type);
    expect(text).toContain(REJECTION_MESSAGES.size);
    expect(images(doc)).toHaveLength(1);
  });

  it('a drag of non-file content is ignored', async () => {
    render(<Harness />);
    drop([], 0, 0, ['text/plain']);
    await flush();
    expect(images(doc)).toHaveLength(0);
  });

  it('the picker input accepts only the supported types and adds files centred in view', async () => {
    render(<Harness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    Object.defineProperty(input, 'files', { value: [png('a.png')], configurable: true });
    fireEvent.change(input);
    await flush();
    const [img] = images(doc);
    expect(img.x + img.width / 2).toBe(500);
  });
});
