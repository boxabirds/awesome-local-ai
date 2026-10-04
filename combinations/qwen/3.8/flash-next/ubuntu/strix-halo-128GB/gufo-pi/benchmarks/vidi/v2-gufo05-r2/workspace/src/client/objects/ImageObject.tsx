/**
 * Story 12: ImageObject — renders the different states of an image on the board.
 *
 * Registered as the component for type 'image'. Receives standard ObjectProps from the
 * registry, reads its own ImageSnapshot from the object, and uses ImageInsertContext
 * for progress/retry data.
 *
 * States: uploading (with progress for uploader, "Uploading…" for others),
 * ready (img tag), failed (uploader: Retry/Remove, others: "Image unavailable"),
 * unfinished ("Image upload didn't finish" + Remove), unavailable (img load error).
 */

import { useState, useEffect, useCallback, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { deleteObjects, objectBounds } from '../../shared/board-model';
import { displayStatus, isImageSnapshot, type ImageSnapshot } from '../../shared/objects/image';
import { useBoardEnv } from '../board/boardEnv';
import { useImageInsertContext } from '../images/ImageInsertContext';
import type { ObjectProps } from './registry';

export function ImageObject(props: ObjectProps) {
  const { object, doc } = props;
  const env = useBoardEnv();
  const insertCtx = useImageInsertContext();

  const image = isImageSnapshot(object) ? object : null;

  if (!image) return null;

  const identity = env?.identity ?? '';
  const isUploader = image.uploaderId === identity;
  const progress = insertCtx?.progress.get(image.id);
  const canRetry = insertCtx?.canRetry(image.id) ?? false;
  const now = insertCtx?.now ?? Date.now();
  const box = objectBounds(object);

  return (
    <div
      data-object-id={object.id}
      data-object-type="image"
      data-selected={props.selected ? 'true' : 'false'}
      role="group"
      aria-label="Image"
      className="image-object"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        zIndex: object.z,
      } as CSSProperties}
    >
      <ImageObjectInner
        image={image}
        isUploader={isUploader}
        progress={progress}
        canRetry={canRetry}
        now={now}
        onRetry={() => insertCtx?.retry(image.id)}
        onRemove={() => deleteObjects(doc, [image.id])}
        onObjectPointerDown={props.onObjectPointerDown}
      />
    </div>
  );
}

interface InnerProps {
  image: ImageSnapshot;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  onObjectPointerDown: ObjectProps['onObjectPointerDown'];
}

function ImageObjectInner({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
  onObjectPointerDown: handlePointerDown,
}: InnerProps) {
  const status = displayStatus(image, now);
  const [imgError, setImgError] = useState(false);

  // Reset imgError when assetKey changes (e.g. retry succeeds)
  useEffect(() => {
    setImgError(false);
  }, [image.assetKey]);

  const handleError = useCallback(() => {
    setImgError(true);
  }, []);

  const containerStyle: CSSProperties = { width: '100%', height: '100%', position: 'relative' };
  const pointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    handlePointerDown(e, image.id);
  };

  if (status === 'uploading') {
    if (isUploader) {
      const pct = progress !== undefined ? Math.round(progress * 100) : 0;
      return (
        <div
          className="image-placeholder image-placeholder--uploader"
          style={containerStyle}
          data-testid="image-uploading-uploader"
          onPointerDown={pointerDown}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
            <path d="M21 15l-5-5L5 21" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <div className="image-progress">
            <div className="image-progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="image-progress__text">{pct}%</span>
        </div>
      );
    }
    return (
      <div
        className="image-placeholder"
        style={containerStyle}
        data-testid="image-uploading-other"
        onPointerDown={pointerDown}
      >
        <span>Uploading…</span>
      </div>
    );
  }

  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          className="image-placeholder image-placeholder--failed"
          style={containerStyle}
          data-testid="image-failed-uploader"
          onPointerDown={pointerDown}
        >
          <span className="image-failed__text">Upload failed</span>
          <div className="image-failed__actions">
            {canRetry && (
              <button
                type="button"
                className="image-failed__retry"
                onClick={onRetry}
                aria-label="Retry"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              className="image-failed__remove"
              onClick={onRemove}
              aria-label="Remove"
            >
              Remove
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        className="image-placeholder"
        style={containerStyle}
        data-testid="image-failed-other"
        onPointerDown={pointerDown}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div
        className="image-placeholder"
        style={containerStyle}
        data-testid="image-unfinished"
        onPointerDown={pointerDown}
      >
        <span>Image upload didn&apos;t finish</span>
        <button
          type="button"
          className="image-unfinished__remove"
          onClick={onRemove}
          aria-label="Remove"
        >
          Remove
        </button>
      </div>
    );
  }

  // status === 'ready'
  if (imgError || !image.assetKey) {
    return (
      <div
        className="image-placeholder"
        style={containerStyle}
        data-testid="image-unavailable"
        onPointerDown={pointerDown}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={`/api/assets/${image.assetKey}`}
      alt="Image"
      draggable={false}
      decoding="async"
      loading="lazy"
      style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
      data-testid="image-ready"
      onError={handleError}
      onPointerDown={pointerDown}
    />
  );
}

/**
 * Standalone ImageObject for direct testing (not through the registry).
 */
export interface ImageObjectDirectProps {
  image: ImageSnapshot;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

export function ImageObjectDirect({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: ImageObjectDirectProps) {
  return (
    <ImageObjectInner
      image={image}
      isUploader={isUploader}
      progress={progress}
      canRetry={canRetry}
      now={now}
      onRetry={onRetry}
      onRemove={onRemove}
      onObjectPointerDown={(_e, _id) => {}}
    />
  );
}
