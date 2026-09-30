import { useState, useEffect, type ReactElement } from 'react';
import type { ImageSnap } from '../../shared/objects/image';
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
 * - failed: red-bordered box with Retry/Remove (uploader) or "Image unavailable" (others)
 * - unfinished: "Image upload didn't finish" with Remove
 * - unavailable (render-only): grey box with broken-image icon
 */
export function ImageObject({
  image,
  isUploader,
  progress,
  canRetry,
  now,
  onRetry,
  onRemove,
}: ImageObjectProps): ReactElement {
  const status = displayStatus(image, now);
  const [loadError, setLoadError] = useState(false);

  // Reset load error when assetKey changes (e.g., after retry)
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const width = image.width;
  const height = image.height;

  // Unfinished state
  if (status === 'unfinished') {
    return (
      <div
        data-testid="image-unfinished"
        style={{
          width,
          height,
          background: '#e5e7eb',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          overflow: 'hidden',
        }}
      >
        <span style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', padding: '0 8px' }}>
          Image upload didn't finish
        </span>
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            border: '1px solid #d1d5db',
            borderRadius: 4,
            background: '#ffffff',
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      </div>
    );
  }

  // Failed state
  if (status === 'failed') {
    if (isUploader) {
      return (
        <div
          data-testid="image-failed-uploader"
          style={{
            width,
            height,
            background: '#fef2f2',
            border: '2px solid #ef4444',
            borderRadius: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            overflow: 'hidden',
          }}
        >
          <span style={{ fontSize: 12, color: '#dc2626' }}>Upload failed</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetry && (
              <button
                type="button"
                aria-label="Retry"
                onClick={onRetry}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  border: '1px solid #3b82f6',
                  borderRadius: 4,
                  background: '#3b82f6',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              aria-label="Remove"
              onClick={onRemove}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: '#ffffff',
                cursor: 'pointer',
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
        data-testid="image-failed-other"
        style={{
          width,
          height,
          background: '#e5e7eb',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          overflow: 'hidden',
        }}
      >
        <BrokenImageIcon />
        <span style={{ fontSize: 12, color: '#6b7280' }}>Image unavailable</span>
      </div>
    );
  }

  // Uploading state
  if (status === 'uploading') {
    if (isUploader) {
      const pct = Math.round((progress ?? 0) * 100);
      return (
        <div
          data-testid="image-uploading-uploader"
          style={{
            width,
            height,
            background: '#e5e7eb',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            overflow: 'hidden',
          }}
        >
          <ImageIcon />
          <div
            style={{
              width: '60%',
              height: 4,
              background: '#d1d5db',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: '#3b82f6',
                transition: 'width 0.1s',
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: '#6b7280' }} data-testid="image-progress">
            {pct}%
          </span>
        </div>
      );
    }
    // Others see "Uploading…"
    return (
      <div
        data-testid="image-uploading-other"
        style={{
          width,
          height,
          background: '#e5e7eb',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <span style={{ fontSize: 12, color: '#6b7280' }}>Uploading…</span>
      </div>
    );
  }

  // Ready state (or load error)
  if (loadError) {
    return (
      <div
        data-testid="image-unavailable"
        style={{
          width,
          height,
          background: '#e5e7eb',
          border: '1px solid #d1d5db',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          overflow: 'hidden',
        }}
      >
        <BrokenImageIcon />
        <span style={{ fontSize: 12, color: '#6b7280' }}>Image unavailable</span>
      </div>
    );
  }

  return (
    <img
      data-testid="image-ready"
      src={`/api/assets/${image.assetKey}`}
      alt="Image"
      draggable={false}
      decoding="async"
      loading="lazy"
      onError={() => setLoadError(true)}
      style={{
        width,
        height,
        objectFit: 'fill',
        borderRadius: 4,
        display: 'block',
      }}
    />
  );
}

function ImageIcon(): ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function BrokenImageIcon(): ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 3l18 18M21 3L3 21" />
    </svg>
  );
}
