/**
 * ImageObject: renders the various states of an image object on the board.
 * States: uploading (progress for uploader, "Uploading…" for others),
 * ready (the image), failed (Retry/Remove for uploader, "Image unavailable" for others),
 * unfinished ("Image upload didn't finish" + Remove), unavailable (broken image).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  selected?: boolean;
  zoom?: number;
  onPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
}

export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry: canRetryFlag,
  now,
  onRetry,
  onRemove,
  selected,
  zoom: _zoom = 1,
  onPointerDown,
}: ImageObjectProps): React.JSX.Element {
  const status: DisplayStatus = displayStatus(image, now);
  const [imgError, setImgError] = useState(false);
  const prevAssetKey = useRef(image.assetKey);

  // Reset error when assetKey changes
  useEffect(() => {
    if (image.assetKey !== prevAssetKey.current) {
      prevAssetKey.current = image.assetKey;
      setImgError(false);
    }
  }, [image.assetKey]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onPointerDown?.(e, image.id);
    },
    [onPointerDown, image.id],
  );

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
  };

  if (status === 'ready' && image.assetKey && !imgError) {
    return (
      <div
        data-testid={`image-${image.id}`}
        data-object-id={image.id}
        data-object-type="image"
        style={baseStyle}
        onPointerDown={handlePointerDown}
        role="img"
        aria-label="Image"
      >
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  if (status === 'ready' && imgError) {
    // Unavailable: stored image cannot be loaded
    return (
      <div
        data-testid={`image-${image.id}`}
        data-object-id={image.id}
        data-object-type="image"
        style={{
          ...baseStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f0f0f0',
          color: '#999',
          fontSize: 12,
          border: selected ? '2px solid #1E88E5' : '1px solid #ddd',
        }}
        onPointerDown={handlePointerDown}
      >
        <span>Image unavailable</span>
      </div>
    );
  }

  if (status === 'uploading') {
    return (
      <div
        data-testid={`image-${image.id}`}
        data-object-id={image.id}
        data-object-type="image"
        style={{
          ...baseStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#e8e8e8',
          border: selected ? '2px solid #1E88E5' : '1px solid #ddd',
          gap: 4,
        }}
        onPointerDown={handlePointerDown}
      >
        {isUploader ? (
          <>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="#999" strokeWidth="2" />
              <circle cx="12" cy="12" r="4" fill="#ccc" />
            </svg>
            <div style={{ fontSize: 11, color: '#666' }}>
              {progress !== undefined ? `${Math.round(progress * 100)}%` : 'Uploading…'}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#666' }}>Uploading…</span>
        )}
      </div>
    );
  }

  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          data-testid={`image-${image.id}`}
          data-object-id={image.id}
          data-object-type="image"
          style={{
            ...baseStyle,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff0f0',
            border: '2px solid #E53935',
            gap: 8,
          }}
          onPointerDown={handlePointerDown}
        >
          <span style={{ fontSize: 12, color: '#E53935' }}>Upload failed</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetryFlag && (
              <button
                type="button"
                data-testid={`image-retry-${image.id}`}
                style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              data-testid={`image-remove-${image.id}`}
              style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
            >
              Remove
            </button>
          </div>
        </div>
      );
    }
    // Others see "Image unavailable"
    return (
      <div
        data-testid={`image-${image.id}`}
        data-object-id={image.id}
        data-object-type="image"
        style={{
          ...baseStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f0f0f0',
          border: selected ? '2px solid #1E88E5' : '1px solid #ddd',
          gap: 4,
          color: '#999',
          fontSize: 12,
        }}
        onPointerDown={handlePointerDown}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="#999" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="8" y2="6" stroke="#999" strokeWidth="1.5" />
          <line x1="7" y1="9" x2="12" y2="4" stroke="#999" strokeWidth="1.5" />
          <line x1="2" y1="2" x2="14" y2="14" stroke="#E53935" strokeWidth="1.5" />
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  }

  // status === 'unfinished'
  return (
    <div
      data-testid={`image-${image.id}`}
      data-object-id={image.id}
      data-object-type="image"
      style={{
        ...baseStyle,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f0f0f0',
        border: selected ? '2px solid #1E88E5' : '1px solid #ddd',
        gap: 8,
        color: '#666',
        fontSize: 12,
      }}
      onPointerDown={handlePointerDown}
    >
      <span>Image upload didn&apos;t finish</span>
      <button
        type="button"
        data-testid={`image-remove-${image.id}`}
        style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >
        Remove
      </button>
    </div>
  );
}
