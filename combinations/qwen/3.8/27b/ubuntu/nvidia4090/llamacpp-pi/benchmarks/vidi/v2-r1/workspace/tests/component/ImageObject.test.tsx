// Component tests (story 12, image.object — TC-21, TC-22, TC-23, TC-24):
// ImageObject renders each display state for the uploader and for other
// participants, and wires Retry/Remove.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { type ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

const NOW = 1_700_000_000_000;

function makeImage(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    z: 0,
    text: '',
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 50,
    status: 'uploading',
    uploadStartedAt: NOW - 1000,
    uploaderId: 'other',
    ...over,
  };
}

function renderImage(
  image: ImageSnap,
  over: Partial<{
    isUploader: boolean;
    progress?: number;
    canRetry: boolean;
    now: number;
    onRetry: () => void;
    onRemove: () => void;
  }> = {},
) {
  const onRetry = over.onRetry ?? vi.fn();
  const onRemove = over.onRemove ?? vi.fn();
  const utils = render(
    <ImageObject
      image={image}
      isUploader={over.isUploader ?? false}
      progress={over.progress}
      canRetry={over.canRetry ?? false}
      now={over.now ?? NOW}
      onRetry={onRetry}
      onRemove={onRemove}
    />,
  );
  return { onRetry, onRemove, ...utils };
}

describe('ImageObject (story 12)', () => {
  it('TC-21a: a failed image rendered by the uploader shows Retry and Remove', () => {
    const { onRetry, onRemove } = renderImage(
      makeImage({ status: 'failed', uploaderId: 'me' }),
      { isUploader: true, canRetry: true },
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    const retry = screen.getByTestId('image-retry');
    const remove = screen.getByTestId('image-remove');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('image-object')).toHaveAttribute('data-status', 'failed');
  });

  it('TC-21b: a failed image rendered by another participant shows Image unavailable, no actions', () => {
    renderImage(makeImage({ status: 'failed', uploaderId: 'other' }), {
      isUploader: false,
    });
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('image-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-remove')).not.toBeInTheDocument();
  });

  it('TC-21c: an uploading image shows a progress bar to the uploader and Uploading… to others', () => {
    const { unmount } = renderImage(
      makeImage({ uploaderId: 'me' }),
      { isUploader: true, progress: 0.4 },
    );
    expect(screen.getByTestId('image-percent')).toHaveTextContent('40%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    unmount();

    renderImage(makeImage({ uploaderId: 'other' }), { isUploader: false });
    expect(screen.getByTestId('image-uploading-label')).toHaveTextContent('Uploading…');
    expect(screen.queryByTestId('image-percent')).not.toBeInTheDocument();
  });

  it('TC-22: an upload older than the stale window renders unfinished with Remove, and Remove removes', () => {
    const oldStart = NOW - (IMAGE_UPLOAD_STALE_MS + 1000);
    const { onRemove } = renderImage(
      makeImage({ status: 'uploading', uploaderId: 'other', uploadStartedAt: oldStart }),
      { isUploader: false },
    );
    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    const remove = screen.getByTestId('image-remove');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('image-object')).toHaveAttribute('data-status', 'unfinished');
  });

  it('TC-23: a ready image whose <img> fails to load shows the unavailable box of the same size', () => {
    renderImage(makeImage({ status: 'ready', assetKey: 'bbb/aaa', uploaderId: 'other' }), {
      isUploader: false,
    });
    const img = screen.getByTestId('image-img');
    expect(img).toHaveAttribute('src', '/api/assets/bbb/aaa');
    const box = screen.getByTestId('image-object');
    const { width, height } = box.style;

    fireEvent.error(img);

    const unavailable = screen.getByTestId('image-unavailable');
    expect(unavailable).toHaveTextContent('Image unavailable');
    // The box keeps its size (image.load_failure: same-size placeholder).
    expect(screen.getByTestId('image-object').style.width).toBe(width);
    expect(screen.getByTestId('image-object').style.height).toBe(height);
  });

  it('TC-24a: Retry re-sends the upload (onRetry called) while the file is in memory', () => {
    const { onRetry } = renderImage(
      makeImage({ status: 'failed', uploaderId: 'me' }),
      { isUploader: true, canRetry: true },
    );
    fireEvent.click(screen.getByTestId('image-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('TC-24b: after a simulated reload (no in-memory file) only Remove is offered', () => {
    renderImage(makeImage({ status: 'failed', uploaderId: 'me' }), {
      isUploader: true,
      canRetry: false,
    });
    expect(screen.queryByTestId('image-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });
});
