/**
 * Image object rendering (story 12).
 * Renders uploading, ready, failed, unfinished, and unavailable states.
 */
import { useState, type JSX } from 'react';
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
 * - ready: <img> with the asset URL
 * - failed: red-bordered box with Retry/Remove (uploader) or "Image unavailable" (others)
 * - unfinished: "Image upload didn't finish" + Remove
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const status = displayStatus(image, now);
  const [loadError, setLoadError] = useState(false);

  const width = image.width;
  const height = image.height;

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: `${width}px`,
    height: `${height}px`,
  };

  switch (status) {
    case 'uploading': {
      const isUploadersView = isUploader;
      return (
        <div
          data-testid="image-uploading"
          style={{
            ...baseStyle,
            background: '#E0E0E0',
            borderRadius: '4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #BDBDBD',
            overflow: 'hidden',
          }}
        >
          {isUploadersView ? (
            <>
              <ImageIcon size={Math.min(32, width / 3, height / 3)} />
              {progress !== undefined && (
                <div style={{ marginTop: '8px', width: '60%' }}>
                  <div
                    style={{
                      height: '4px',
                      background: '#BDBDBD',
                      borderRadius: '2px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round(progress * 100)}%`,
                        background: '#1a73e8',
                        transition: 'width 0.2s',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '11px', color: '#555', marginTop: '4px', display: 'block' }}>
                    {Math.round(progress * 100)}%
                  </span>
                </div>
              )}
            </>
          ) : (
            <span style={{ fontSize: '13px', color: '#555' }}>Uploading…</span>
          )}
        </div>
      );
    }

    case 'ready': {
      if (loadError || !image.assetKey) {
        return <UnavailableBox style={baseStyle} />;
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
            ...baseStyle,
            objectFit: 'fill',
            borderRadius: '2px',
          }}
        />
      );
    }

    case 'failed': {
      if (isUploader) {
        return (
          <div
            data-testid="image-failed-uploader"
            style={{
              ...baseStyle,
              background: '#FFEBEE',
              border: '2px solid #E53935',
              borderRadius: '4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '13px', color: '#C62828', fontWeight: 500 }}>Upload failed</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {canRetry && (
                <button
                  type="button"
                  data-testid="image-retry-btn"
                  onClick={onRetry}
                  style={smallBtnStyle}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                data-testid="image-remove-btn"
                onClick={onRemove}
                style={smallBtnStyle}
              >
                Remove
              </button>
            </div>
          </div>
        );
      }
      // Others see "Image unavailable"
      return <UnavailableBox style={baseStyle} />;
    }

    case 'unfinished': {
      return (
        <div
          data-testid="image-unfinished"
          style={{
            ...baseStyle,
            background: '#E0E0E0',
            border: '1px solid #BDBDBD',
            borderRadius: '4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '12px', color: '#555' }}>Image upload didn't finish</span>
          <button
            type="button"
            data-testid="image-remove-btn"
            onClick={onRemove}
            style={smallBtnStyle}
          >
            Remove
          </button>
        </div>
      );
    }
  }
}

function UnavailableBox({ style }: { style: React.CSSProperties }): JSX.Element {
  return (
    <div
      data-testid="image-unavailable"
      style={{
        ...style,
        background: '#F5F5F5',
        border: '1px solid #E0E0E0',
        borderRadius: '4px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
      }}
    >
      <BrokenImageIcon size={32} />
      <span style={{ fontSize: '12px', color: '#757575' }}>Image unavailable</span>
    </div>
  );
}

/** Simple image placeholder icon. */
function ImageIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

/** Broken image icon. */
function BrokenImageIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#BDBDBD" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 3l18 18M21 3L3 21" />
    </svg>
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '12px',
  border: '1px solid #BDBDBD',
  borderRadius: '4px',
  background: 'white',
  cursor: 'pointer',
};
