/**
 * ImageObject: renders an image object in all its states (story 12).
 * States: uploading, ready, failed, unfinished, unavailable.
 */
import { useState, useEffect, useCallback, type JSX } from 'react';
import type { ImageSnap } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
  onPointerDown(e: React.PointerEvent, id: string): void;
}

/**
 * Render an image object based on its display status.
 * - uploading: grey box; uploader sees progress %, others see "Uploading…"
 * - ready: <img> with the asset; onError → "Image unavailable"
 * - failed: uploader → red border "Upload failed" + Retry/Remove; others → "Image unavailable"
 * - unfinished: "Image upload didn't finish" + Remove
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove, onPointerDown } = props;
  const status = displayStatus(image, now);
  const [loadError, setLoadError] = useState(false);

  // Reset load error when assetKey changes (e.g., after retry)
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const handleImgError = useCallback(() => {
    setLoadError(true);
  }, []);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
  };

  if (status === 'uploading') {
    return (
      <div
        className="image-object image-object--uploading"
        data-vidi6="image-object"
        data-status="uploading"
        style={style}
        onPointerDown={(e) => onPointerDown(e, image.id)}
        aria-label="Image"
      >
        <div className="image-object-placeholder">
          {isUploader ? (
            <>
              <span className="image-object-icon" aria-hidden="true">🖼</span>
              <div className="image-object-progress-bar" aria-hidden="true">
                <div
                  className="image-object-progress-fill"
                  style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                />
              </div>
              <span className="image-object-progress-text">
                {Math.round((progress ?? 0) * 100)}%
              </span>
            </>
          ) : (
            <span className="image-object-uploading-text">Uploading…</span>
          )}
        </div>
      </div>
    );
  }

  if (status === 'ready' && !loadError) {
    return (
      <div
        className="image-object image-object--ready"
        data-vidi6="image-object"
        data-status="ready"
        style={style}
        onPointerDown={(e) => onPointerDown(e, image.id)}
        aria-label="Image"
      >
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={handleImgError}
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />
      </div>
    );
  }

  if (status === 'ready' && loadError) {
    // Image unavailable (render-only state)
    return (
      <div
        className="image-object image-object--unavailable"
        data-vidi6="image-object"
        data-status="unavailable"
        style={style}
        onPointerDown={(e) => onPointerDown(e, image.id)}
        aria-label="Image"
      >
        <div className="image-object-unavailable-box">
          <span className="image-object-broken-icon" aria-hidden="true">🖼</span>
          <span className="image-object-unavailable-text">Image unavailable</span>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          className="image-object image-object--failed"
          data-vidi6="image-object"
          data-status="failed"
          style={style}
          onPointerDown={(e) => onPointerDown(e, image.id)}
          aria-label="Image"
        >
          <div className="image-object-failed-box">
            <span className="image-object-failed-text">Upload failed</span>
            <div className="image-object-failed-actions">
              {canRetry && (
                <button
                  type="button"
                  className="image-object-retry-btn"
                  data-vidi6="image-retry"
                  onClick={(e) => { e.stopPropagation(); onRetry(); }}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="image-object-remove-btn"
                data-vidi6="image-remove"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      );
    }
    // Others see "Image unavailable" for failed uploads
    return (
      <div
        className="image-object image-object--unavailable"
        data-vidi6="image-object"
        data-status="unavailable"
        style={style}
        onPointerDown={(e) => onPointerDown(e, image.id)}
        aria-label="Image"
      >
        <div className="image-object-unavailable-box">
          <span className="image-object-broken-icon" aria-hidden="true">🖼</span>
          <span className="image-object-unavailable-text">Image unavailable</span>
        </div>
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div
        className="image-object image-object--unfinished"
        data-vidi6="image-object"
        data-status="unfinished"
        style={style}
        onPointerDown={(e) => onPointerDown(e, image.id)}
        aria-label="Image"
      >
        <div className="image-object-unfinished-box">
          <span className="image-object-unfinished-text">Image upload didn't finish</span>
          <button
            type="button"
            className="image-object-remove-btn"
            data-vidi6="image-remove"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  // Fallback (should not reach here)
  return (
    <div
      className="image-object"
      data-vidi6="image-object"
      style={style}
      onPointerDown={(e) => onPointerDown(e, image.id)}
      aria-label="Image"
    />
  );
}
