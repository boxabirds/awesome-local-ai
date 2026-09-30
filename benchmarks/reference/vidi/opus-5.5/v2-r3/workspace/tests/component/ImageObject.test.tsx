// Story 12 — image.object render states (TC-21 → TC-24).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objectsSnapshot } from '../../src/shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { createImagePlaceholders, isImage, markImageFailed, type ImageSnap } from '../../src/shared/objects/image';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { uploadImage, type UploadResult } from '../../src/client/images/uploadImage';
import { newBoardId } from '../../src/shared/board-id';
import { SMALL_PNG } from '../fixtures/image-bytes';
import { ImageHarness, ME, newDoc, TestDragEvent } from './image-harness';

vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage: vi.fn() }));
const upload = vi.mocked(uploadImage);
let resolvers: ((r: UploadResult) => void)[] = [];

beforeEach(() => {
  vi.stubGlobal('DragEvent', TestDragEvent);
  resolvers = [];
  upload.mockReset();
  upload.mockImplementation(() => ({
    promise: new Promise<UploadResult>((r) => resolvers.push(r)),
    abort: vi.fn(),
  }));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 320, height: 200, close() {} })));
});
afterEach(() => vi.unstubAllGlobals());

const NOW = 1_700_000_000_000;

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 320,
    height: 200,
    z: 1,
    createdAt: NOW,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 320,
    naturalHeight: 200,
    status: 'uploading',
    uploadStartedAt: NOW,
    uploaderId: ME,
    ...over,
  };
}

function renderImage(image: ImageSnap, over: Partial<Parameters<typeof ImageObject>[0]> = {}) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <ImageObject image={image} isUploader canRetry now={NOW} onRetry={onRetry} onRemove={onRemove} {...over} />,
  );
  return { ...utils, onRetry, onRemove, el: screen.getByRole('group', { name: 'Image' }) };
}

describe('ImageObject', () => {
  it('uploading: the uploader sees progress, others see Uploading…', () => {
    const { el, unmount } = renderImage(snap(), { progress: 0.5 });
    expect(el).toHaveTextContent('50%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    unmount();
    renderImage(snap(), { isUploader: false });
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('TC-21: failed → Upload failed with Retry and Remove for the uploader; Image unavailable for others', () => {
    const failed = snap({ status: 'failed' });
    const mine = renderImage(failed);
    expect(mine.el).toHaveTextContent('Upload failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mine.onRetry).toHaveBeenCalledTimes(1);
    expect(mine.onRemove).toHaveBeenCalledTimes(1);
    mine.unmount();

    const other = renderImage(failed, { isUploader: false });
    expect(other.el).toHaveTextContent('Image unavailable');
    expect(other.el).not.toHaveTextContent('Upload failed');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('TC-22: uploading for longer than IMAGE_UPLOAD_STALE_MS → Image upload didn’t finish + Remove; Remove deletes', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 60 }, naturalWidth: 100, naturalHeight: 60, contentType: 'image/png' }],
      'c_someone_else',
      NOW,
    );
    const { rerender } = render(<ImageHarness doc={doc} connection="connected" now={NOW + IMAGE_UPLOAD_STALE_MS - 1} />);
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    rerender(<ImageHarness doc={doc} connection="connected" now={NOW + IMAGE_UPLOAD_STALE_MS + 1} />);
    const el = screen.getByRole('group', { name: 'Image' });
    expect(el).toHaveTextContent("Image upload didn't finish");
    expect(el).toHaveAttribute('data-status', 'unfinished');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(objectsSnapshot(doc).some((o) => o.id === id)).toBe(false);
    expect(screen.queryByRole('group', { name: 'Image' })).toBeNull();
  });

  it('TC-23: a ready image whose load fails shows Image unavailable at the same size', () => {
    const key = `${newBoardId()}/${newBoardId()}`;
    const { el } = renderImage(snap({ status: 'ready', assetKey: key }), { isUploader: false });
    const img = el.querySelector('img')!;
    expect(img).toHaveAttribute('src', `/api/assets/${key}`);
    expect(img).toHaveAttribute('draggable', 'false');
    expect(img).toHaveAttribute('loading', 'lazy');
    fireEvent.error(img);
    expect(el).toHaveTextContent('Image unavailable');
    expect(el.querySelector('img')).toBeNull();
    expect(el).toHaveStyle({ left: '10px', top: '20px', width: '320px', height: '200px' });
  });

  it('TC-24: Retry with the file in memory uploads again; after a reload only Remove is offered', async () => {
    const doc = newDoc();
    const harness = render(<ImageHarness doc={doc} connection="connected" />);
    const vp = screen.getByTestId('viewport');
    fireEvent.drop(vp, { dataTransfer: { files: [new File([SMALL_PNG], 'a.png', { type: 'image/png' })], types: ['Files'] } });
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => resolvers[0]({ kind: 'failed', status: 500 }));
    expect(screen.getByText('Upload failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const img = objectsSnapshot(doc).find(isImage) as ImageSnap;
    expect(img.status).toBe('uploading');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][1]).toBe(upload.mock.calls[0][1]); // the same file

    // After a reload the file is gone: canRetry is false.
    harness.unmount();
    markImageFailed(doc, img.id);
    const after = renderImage({ ...img, status: 'failed' }, { canRetry: false });
    expect(after.el).toHaveTextContent('Upload failed');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Remove']);
  });

  it('is read-only on a board that could not be loaded', () => {
    renderImage(snap({ status: 'failed' }), { readOnly: true });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
