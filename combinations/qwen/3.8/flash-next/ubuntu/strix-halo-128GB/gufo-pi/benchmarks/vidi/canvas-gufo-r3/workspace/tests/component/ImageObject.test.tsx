import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ImageObject } from '@client/objects/ImageObject';
import type { ImageSnap } from '@shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '@shared/config';

afterEach(cleanup);

function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'test-id-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 200,
    height: 150,
    z: 1,
    createdAt: Date.now(),
    createdBy: 'alice',
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 150,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'alice',
    ...overrides,
  };
}

describe('ImageObject component tests', () => {
  // TC-21: failed object - uploader sees "Upload failed" with Retry and Remove; other sees "Image unavailable"
  it('TC-21: failed object as uploader → "Upload failed" with Retry and Remove', () => {
    const image = makeImageSnap({ status: 'failed' });
    const { getByText, getByTestId } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(getByTestId('image-failed')).toBeInTheDocument();
    expect(getByText('Upload failed')).toBeInTheDocument();
    expect(getByTestId('image-retry')).toBeInTheDocument();
    expect(getByTestId('image-remove')).toBeInTheDocument();
  });

  it('TC-21: failed object as non-uploader → "Image unavailable"', () => {
    const image = makeImageSnap({ status: 'failed' });
    const { getByTestId, getByText, queryByTestId } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(getByTestId('image-unavailable')).toBeInTheDocument();
    expect(getByText('Image unavailable')).toBeInTheDocument();
    expect(queryByTestId('image-retry')).not.toBeInTheDocument();
  });

  // TC-22: uploading older than IMAGE_UPLOAD_STALE_MS → "Image upload didn't finish" + Remove
  it('TC-22: unfinished uploading → "Image upload didn\'t finish" + Remove; Remove deletes', () => {
    const startedAt = Date.now() - IMAGE_UPLOAD_STALE_MS - 1000;
    const image = makeImageSnap({ status: 'uploading', uploadStartedAt: startedAt });
    const onRemove = vi.fn();

    const { getByTestId, getByText } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />
    );

    expect(getByTestId('image-unfinished')).toBeInTheDocument();
    expect(getByText(/Image upload didn/)).toBeInTheDocument();
    expect(getByTestId('image-remove')).toBeInTheDocument();

    fireEvent.click(getByTestId('image-remove'));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  // TC-23: ready image fires error → "Image unavailable" box same size
  it('TC-23: ready image with load error → "Image unavailable" box', () => {
    const image = makeImageSnap({ status: 'ready', assetKey: 'abcdefghijklmnopqrstuv/abcdefghijklmnopqrstuv' });

    const { getByTestId, getByText } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const img = getByTestId('image-object').querySelector('img');
    expect(img).toBeInTheDocument();

    // Simulate image load error
    fireEvent.error(img!);

    expect(getByTestId('image-unavailable')).toBeInTheDocument();
    expect(getByText('Image unavailable')).toBeInTheDocument();
  });

  // TC-24: Retry with file in memory → upload called again; Retry hidden when canRetry=false
  it('TC-24: failed with canRetry=true → Retry button present and calls onRetry', () => {
    const image = makeImageSnap({ status: 'failed' });
    const onRetry = vi.fn();

    const { getByTestId } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />
    );

    fireEvent.click(getByTestId('image-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('TC-24: failed with canRetry=false → only Remove, no Retry', () => {
    const image = makeImageSnap({ status: 'failed' });

    const { getByTestId, queryByTestId } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(queryByTestId('image-retry')).not.toBeInTheDocument();
    expect(getByTestId('image-remove')).toBeInTheDocument();
  });

  // Uploading state - uploader sees progress
  it('uploading state (uploader) shows progress bar with percentage', () => {
    const image = makeImageSnap({ status: 'uploading', uploadStartedAt: Date.now() });

    const { getByTestId, getByText } = render(
      <ImageObject
        image={image}
        isUploader={true}
        progress={0.5}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(getByTestId('image-placeholder')).toBeInTheDocument();
    expect(getByText('50%')).toBeInTheDocument();
  });

  // Uploading state - others see "Uploading…"
  it('uploading state (others) shows "Uploading…"', () => {
    const image = makeImageSnap({ status: 'uploading', uploadStartedAt: Date.now() });

    const { getByTestId, getByText } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(getByTestId('image-placeholder')).toBeInTheDocument();
    expect(getByText('Uploading…')).toBeInTheDocument();
  });

  // Ready state shows image element
  it('ready state renders img with correct src', () => {
    const image = makeImageSnap({
      status: 'ready',
      assetKey: 'abcdefghijklmnopqrstuv/abcdefghijklmnopqrstuv',
    });

    const { getByTestId } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const container = getByTestId('image-object');
    expect(container).toBeInTheDocument();
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/api/assets/abcdefghijklmnopqrstuv/abcdefghijklmnopqrstuv');
    expect(img).toHaveAttribute('alt', 'Image');
    expect(img).toHaveAttribute('draggable', 'false');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('loading', 'lazy');
  });
});
