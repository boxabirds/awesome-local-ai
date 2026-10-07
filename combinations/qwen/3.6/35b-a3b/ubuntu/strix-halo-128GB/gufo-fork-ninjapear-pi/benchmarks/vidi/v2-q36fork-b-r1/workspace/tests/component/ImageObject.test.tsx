/**
 * Story 12 — Component tests for ImageObject states (TC-21 to TC-24).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IMAGE_UPLOAD_STALE_MS, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Shared test image snapshot helper
function makeImage(status: 'uploading' | 'ready' | 'failed', extra = {}): ImageSnap {
  return {
    id: 'img-001',
    type: 'image',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    assetKey: status === 'ready' ? 'board123/asset456' : null,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    status,
    uploadStartedAt: Date.now() - 1000,
    uploaderId: 'user-uploader',
    z: 1,
    ...extra,
  };
}

describe('ImageObject — failed state (TC-21)', () => {
  it('TC-21: uploader sees "Upload failed" with Retry and Remove', () => {
    const img = makeImage('failed');
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        now={Date.now()}
      />
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByLabelText('Retry upload')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove image')).toBeInTheDocument();
  });

  it('TC-21: other participant sees "Image unavailable"', () => {
    const img = makeImage('failed');
    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        now={Date.now()}
      />
    );
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });
});

describe('ImageObject — unfinished state (TC-22)', () => {
  it('TC-22: shows unfinished state + Remove when stale', () => {
    const img = makeImage('uploading', {
      uploadStartedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1000, // past timeout
    });
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={false}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        now={Date.now()}
      />
    );
    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    expect(screen.getByLabelText('Remove image')).toBeInTheDocument();
  });
});

describe('ImageObject — retry behaviour (TC-24)', () => {
  it('TC-24a: Retry button visible when canRetry=true', () => {
    const img = makeImage('failed');
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        now={Date.now()}
      />
    );
    expect(screen.getByLabelText('Retry upload')).toBeInTheDocument();
  });

  it('TC-24b: Retry hidden when canRetry=false, only Remove shown', () => {
    const img = makeImage('failed');
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={false}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        now={Date.now()}
      />
    );
    expect(screen.queryByLabelText('Retry upload')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove image')).toBeInTheDocument();
  });

  it('TC-24c: onRetry called when Retry clicked', () => {
    const onRetryMock = vi.fn();
    const img = makeImage('failed');
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        onRetry={onRetryMock}
        onRemove={vi.fn()}
        now={Date.now()}
      />
    );
    fireEvent.click(screen.getByLabelText('Retry upload'));
    expect(onRetryMock).toHaveBeenCalledOnce();
  });

  it('TC-24d: onRemove called when Remove clicked', () => {
    const onRemoveMock = vi.fn();
    const img = makeImage('failed');
    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={false}
        onRetry={vi.fn()}
        onRemove={onRemoveMock}
        now={Date.now()}
      />
    );
    fireEvent.click(screen.getByLabelText('Remove image'));
    expect(onRemoveMock).toHaveBeenCalledOnce();
  });
});
