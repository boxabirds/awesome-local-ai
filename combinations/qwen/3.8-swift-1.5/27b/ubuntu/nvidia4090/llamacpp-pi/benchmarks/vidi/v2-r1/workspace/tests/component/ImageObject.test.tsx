/**
 * Story 12: ImageObject render states (TC-18, TC-21, TC-22).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { ImageObject } from '@client/objects/ImageObject';
import type { ObjectProps } from '@client/objects/registry';
import type { ImageSnap } from '@shared/objects/image';

const BOARD_ID = 'boardid123456789012345';

function imageObj(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 50,
    status: 'uploading',
    uploadStartedAt: 1_000_000,
    uploaderId: '1',
    ...over,
  };
}

function baseProps(obj: ImageSnap): ObjectProps {
  return {
    obj: obj as ObjectProps['obj'],
    doc: new Y.Doc(),
    zoom: 1,
    selected: false,
    editing: false,
    onObjectPointerDown: () => {},
    onStartEdit: () => {},
    onEndEdit: () => {},
  };
}

describe('TC-18: ImageObject render states', () => {
  afterEach(() => cleanup());

  it('ready → <img> with the asset src', () => {
    const obj = imageObj({
      status: 'ready',
      assetKey: `${BOARD_ID}/aaaaaaaaaaaaaaaaaaaaaa`,
    });
    const { container } = render(<ImageObject {...baseProps(obj)} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(`/api/assets/${BOARD_ID}/aaaaaaaaaaaaaaaaaaaaaa`);
    expect(container.querySelector('[data-image-status="ready"]')).not.toBeNull();
  });

  it('ready but the stored image fails to load → "Image unavailable" box', () => {
    const obj = imageObj({
      status: 'ready',
      assetKey: `${BOARD_ID}/aaaaaaaaaaaaaaaaaaaaaa`,
    });
    const { container } = render(<ImageObject {...baseProps(obj)} />);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(container.querySelector('[data-image-status="unavailable"]')).not.toBeNull();
  });

  it('uploading + isUploader + progress 0.42 → "Uploading… 42%"', () => {
    const obj = imageObj({ status: 'uploading' });
    render(<ImageObject {...baseProps(obj)} imageIsUploader imageProgress={0.42} imageNow={1_000_100} />);
    expect(screen.getByText('Uploading… 42%')).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-remove')).toBeNull();
  });

  it('uploading by another peer → "Uploading…" without a percent, no buttons', () => {
    const obj = imageObj({ status: 'uploading', uploaderId: '999' });
    render(<ImageObject {...baseProps(obj)} imageIsUploader={false} imageNow={1_000_100} />);
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-remove')).toBeNull();
  });

  it('TC-22: stale upload (>5 min) → "Image upload didn\'t finish" + working Remove', () => {
    const onRemove = vi.fn();
    const obj = imageObj({ status: 'uploading', uploadStartedAt: 0 });
    render(
      <ImageObject
        {...baseProps(obj)}
        imageIsUploader
        imageNow={5 * 60 * 1000 + 1000}
        onImageRemove={onRemove}
      />,
    );
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('image-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('TC-21: failed as uploader → "Upload failed" + Retry + Remove', () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    const obj = imageObj({ status: 'failed' });
    render(
      <ImageObject
        {...baseProps(obj)}
        imageIsUploader
        imageCanRetry
        imageNow={120_000}
        onImageRetry={onRetry}
        onImageRemove={onRemove}
      />,
    );
    expect(screen.getByText('Upload failed')).toBeTruthy();
    fireEvent.click(screen.getByTestId('image-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('image-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('TC-21: failed as another peer → "Image unavailable", no buttons', () => {
    const obj = imageObj({ status: 'failed', uploaderId: '999' });
    render(<ImageObject {...baseProps(obj)} imageIsUploader={false} imageNow={120_000} />);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-remove')).toBeNull();
  });
});
