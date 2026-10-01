import { useState, useEffect } from 'react';
import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';

interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

/**
 * Renders an image object in one of its display states:
 * - uploading: grey box with progress (uploader) or "Uploading…" (others)
 * - ready: the actual image
 * - failed: red border "Upload failed" with Retry/Remove (uploader) or "Image unavailable" (others)
 * - unfinished: "Image upload didn't finish" with Remove
 * - unavailable: "Image unavailable" box (render-only, from img error)
 */
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: ImageObjectProps): React.ReactElement {
  const [loadError, setLoadError] = useState(false);

  // Reset loadError when assetKey changes (retry success)
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const status: DisplayStatus = displayStatus(image, now);
  const width = image.width || 100;
  const height = image.height || 100;

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width,
    height,
    borderRadius: 4,
    overflow: 'hidden',
  };

  if (status === 'uploading') {
    if (isUploader) {
      const pct = progress !== undefined ? Math.round(progress * 100) : 0;
      return (
        <div
          data-testid="image-uploading-uploader"
          style={{
            ...baseStyle,
            background: '#e0e0e0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          aria-label="Image"
        >
          <span aria-hidden style={{ fontSize: 32, opacity: 0.5 }}>🖼</span>
          <div
            data-testid="image-progress-bar"
            style={{
              width: '80%',
              height: 6,
              background: '#ccc',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: '#4285f4',
                transition: 'width 0.2s',
              }}
            />
          </div>
          <span data-testid="image-progress-text" style={{ fontSize: 12, color: '#666' }}>
            {pct}%
          </span>
        </div>
      );
    }
    // Others see "Uploading…"
    return (
      <div
        data-testid="image-uploading-others"
        style={{
          ...baseStyle,
          background: '#e0e0e0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="Image"
      >
        <span style={{ fontSize: 14, color: '#666' }}>Uploading…</span>
      </div>
    );
  }

  if (status === 'ready') {
    if (loadError || !image.assetKey) {
      return renderUnavailable(baseStyle, width, height);
    }
    return (
      <div style={baseStyle} aria-label="Image">
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setLoadError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            display: 'block',
          }}
        />
      </div>
    );
  }

  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          data-testid="image-failed-uploader"
          style={{
            ...baseStyle,
            background: '#ffebee',
            border: '2px solid #e53935',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          aria-label="Image"
        >
          <span style={{ fontSize: 14, color: '#c62828', fontWeight: 600 }}>Upload failed</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetry && (
              <button
                type="button"
                data-testid="image-retry-btn"
                onClick={onRetry}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  background: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              data-testid="image-remove-btn"
              onClick={onRemove}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                cursor: 'pointer',
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: 4,
              }}
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
        data-testid="image-unavailable"
        style={{
          ...baseStyle,
          background: '#e0e0e0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="Image"
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span aria-hidden style={{ fontSize: 24 }}>⚠️</span>
          <span style={{ fontSize: 12, color: '#666' }}>Image unavailable</span>
        </div>
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div
        data-testid="image-unfinished"
        style={{
          ...baseStyle,
          background: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
        aria-label="Image"
      >
        <span style={{ fontSize: 13, color: '#666' }}>Image upload didn't finish</span>
        <button
          type="button"
          data-testid="image-remove-btn"
          onClick={onRemove}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            cursor: 'pointer',
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
          }}
        >
          Remove
        </button>
      </div>
    );
  }

  // Fallback
  return renderUnavailable(baseStyle, width, height);
}

function renderUnavailable(baseStyle: React.CSSProperties, _width: number, _height: number): React.ReactElement {
  return (
    <div
      data-testid="image-unavailable"
      style={{
        ...baseStyle,
        background: '#e0e0e0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-label="Image"
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span aria-hidden style={{ fontSize: 24 }}>⚠️</span>
        <span style={{ fontSize: 12, color: '#666' }}>Image unavailable</span>
      </div>
    </div>
  );
}
