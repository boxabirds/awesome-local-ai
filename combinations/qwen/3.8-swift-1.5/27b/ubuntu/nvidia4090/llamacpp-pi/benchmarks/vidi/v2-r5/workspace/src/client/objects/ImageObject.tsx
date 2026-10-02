// src/client/objects/ImageObject.tsx
// Renders image objects in their various states.

import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
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
}

export function ImageObject(props: ImageObjectProps): ReactElement {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const status = displayStatus(image, now);
  const [loadError, setLoadError] = useState(false);

  // Reset load error when assetKey changes
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const handleError = useCallback(() => {
    setLoadError(true);
  }, []);

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
  };

  switch (status) {
    case 'uploading':
      if (isUploader) {
        const pct = Math.round((progress ?? 0) * 100);
        return (
          <div
            data-testid="image-uploading"
            data-image-id={image.id}
            style={{
              ...baseStyle,
              background: '#e0e0e0',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: '1px solid #bbb',
            }}
          >
            <span style={{ fontSize: 24 }} aria-hidden="true">🖼️</span>
            <div
              data-testid="image-progress-bar"
              style={{
                width: '80%',
                height: 4,
                background: '#ccc',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: '#1E88E5',
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <span data-testid="image-progress-text" style={{ fontSize: 12, color: '#555' }}>
              {pct}%
            </span>
          </div>
        );
      } else {
        return (
          <div
            data-testid="image-uploading-others"
            data-image-id={image.id}
            style={{
              ...baseStyle,
              background: '#e0e0e0',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #bbb',
            }}
          >
            <span style={{ fontSize: 13, color: '#555' }}>Uploading…</span>
          </div>
        );
      }

    case 'ready':
      if (loadError || !image.assetKey) {
        return (
          <div
            data-testid="image-unavailable"
            data-image-id={image.id}
            style={{
              ...baseStyle,
              background: '#f5f5f5',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              border: '1px solid #ddd',
            }}
          >
            <span style={{ fontSize: 24 }} aria-hidden="true">⚠️</span>
            <span style={{ fontSize: 12, color: '#777' }}>Image unavailable</span>
          </div>
        );
      }
      return (
        <img
          data-testid="image-ready"
          data-image-id={image.id}
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={handleError}
          style={{
            ...baseStyle,
            objectFit: 'fill',
            borderRadius: 4,
          }}
        />
      );

    case 'failed':
      if (isUploader) {
        return (
          <div
            data-testid="image-failed"
            data-image-id={image.id}
            style={{
              ...baseStyle,
              background: '#ffebee',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: '2px solid #e53935',
            }}
          >
            <span style={{ fontSize: 13, color: '#c62828' }}>Upload failed</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {canRetry && (
                <button
                  data-testid="image-retry-btn"
                  onClick={onRetry}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    border: '1px solid #ccc',
                    borderRadius: 4,
                    background: 'white',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              )}
              <button
                data-testid="image-remove-btn"
                onClick={onRemove}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  background: 'white',
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </div>
        );
      } else {
        return (
          <div
            data-testid="image-unavailable"
            data-image-id={image.id}
            style={{
              ...baseStyle,
              background: '#f5f5f5',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              border: '1px solid #ddd',
            }}
          >
            <span style={{ fontSize: 24 }} aria-hidden="true">⚠️</span>
            <span style={{ fontSize: 12, color: '#777' }}>Image unavailable</span>
          </div>
        );
      }

    case 'unfinished':
      return (
        <div
          data-testid="image-unfinished"
          data-image-id={image.id}
          style={{
            ...baseStyle,
            background: '#f5f5f5',
            borderRadius: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            border: '1px solid #ddd',
          }}
        >
          <span style={{ fontSize: 13, color: '#555' }}>Image upload didn't finish</span>
          <button
            data-testid="image-remove-btn"
            onClick={onRemove}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              border: '1px solid #ccc',
              borderRadius: 4,
              background: 'white',
              cursor: 'pointer',
            }}
          >
            Remove
          </button>
        </div>
      );

    default:
      return <div />;
  }
}
