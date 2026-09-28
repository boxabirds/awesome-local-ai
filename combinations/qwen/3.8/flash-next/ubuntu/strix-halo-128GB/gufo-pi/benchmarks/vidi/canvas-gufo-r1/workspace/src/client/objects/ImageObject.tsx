import { useState, useEffect, useRef } from 'react';
import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  zoom?: number;
  onRetry(): void;
  onRemove(): void;
}

/**
 * Render an image object on the board in various states.
 */
export function ImageObject(props: ImageObjectProps) {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const status: DisplayStatus = displayStatus(image, now);
  const [imgError, setImgError] = useState(false);

  // Reset error state when assetKey changes
  const prevAssetKey = useRef(image.assetKey);
  useEffect(() => {
    if (image.assetKey !== prevAssetKey.current) {
      setImgError(false);
      prevAssetKey.current = image.assetKey;
    }
  }, [image.assetKey]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
  };

  // Ready state with loaded image
  if (status === 'ready' && !imgError && image.assetKey) {
    return (
      <div
        data-testid={`image-object-${image.id}`}
        data-image-status="ready"
        className="board-object image-object"
        style={style}
        aria-label="Image"
      >
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // Unavailable (ready but image failed to load)
  if ((status === 'ready' && imgError) || (status === 'failed' && !isUploader)) {
    return (
      <div
        data-testid={`image-object-${image.id}`}
        data-image-status="unavailable"
        className="board-object image-object image-unavailable"
        style={style}
        aria-label="Image unavailable"
      >
        <span className="image-broken-icon" aria-hidden="true">{'\u{1F5BC}'}</span>
        <span className="image-status-text">Image unavailable</span>
      </div>
    );
  }

  // Unfinished
  if (status === 'unfinished') {
    return (
      <div
        data-testid={`image-object-${image.id}`}
        data-image-status="unfinished"
        className="board-object image-object image-unfinished"
        style={style}
        aria-label="Image upload didn't finish"
      >
        <span className="image-status-text">Image upload didn't finish</span>
        <button
          type="button"
          className="image-remove-btn"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Remove"
          data-testid={`image-remove-btn-${image.id}`}
        >
          Remove
        </button>
      </div>
    );
  }

  // Failed (uploader)
  if (status === 'failed' && isUploader) {
    return (
      <div
        data-testid={`image-object-${image.id}`}
        data-image-status="failed"
        className="board-object image-object image-failed"
        style={style}
        aria-label="Upload failed"
      >
        <span className="image-status-text">Upload failed</span>
        <div className="image-failed-actions">
          {canRetry && (
            <button
              type="button"
              className="image-retry-btn"
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              aria-label="Retry"
              data-testid={`image-retry-btn-${image.id}`}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="image-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            aria-label="Remove"
            data-testid={`image-remove-btn-${image.id}`}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  // Uploading (uploader)
  if (status === 'uploading' && isUploader) {
    const pct = progress != null ? Math.round(progress * 100) : 0;
    return (
      <div
        data-testid={`image-object-${image.id}`}
        data-image-status="uploading"
        className="board-object image-object image-uploading"
        style={style}
        aria-label={`Uploading ${pct}%`}
      >
        <span className="image-broken-icon" aria-hidden="true">{'\u{1F5BC}'}</span>
        <div className="image-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="image-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="image-status-text">{pct}%</span>
      </div>
    );
  }

  // Uploading (others)
  return (
    <div
      data-testid={`image-object-${image.id}`}
      data-image-status="uploading"
      className="board-object image-object image-uploading"
      style={style}
      aria-label="Uploading\u2026"
    >
      <span className="image-status-text">Uploading\u2026</span>
    </div>
  );
}
