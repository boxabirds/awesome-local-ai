/**
 * Story 12 (image.object): renders one image object in all of its display
 * states (displayStatus):
 *
 *   uploading   uploader: grey box, progress bar + percentage
 *               others:   grey box, "Uploading…"
 *   ready       <img> from GET /api/assets/<assetKey> (immutable-cached)
 *   failed      uploader: red-bordered box, "Upload failed", Retry + Remove
 *               others:   "Image unavailable" box
 *   unfinished  everyone: "Image upload didn't finish" + Remove
 *   (img error) everyone: "Image unavailable" box at the same size
 *
 * Two exports: `ImageObject` is the pure state renderer (component tests
 * render it directly); `ImageRegistryObject` is the registry component that
 * adds positioning, selection and the generic transform gesture.
 */
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import type { ObjectProps } from './registry';

const BOX_BASE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 3,
  overflow: 'hidden',
  textAlign: 'center',
};

const BUTTON_STYLE: React.CSSProperties = {
  border: '1px solid #d5d9e0',
  background: '#fff',
  color: '#23272e',
  borderRadius: 4,
  padding: '2px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

function Box(props: { failed?: boolean; children: React.ReactNode }): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...BOX_BASE,
        background: props.failed ? '#fff5f5' : '#e8eaee',
        border: props.failed ? '2px solid #d93025' : '1px solid #d5d9e0',
        color: props.failed ? '#c5221f' : '#5f6368',
        fontSize: 12,
      }}
    >
      {props.children}
    </div>
  );
}

/** The pure image state renderer (see file header for the states). */
export function ImageObject(props: {
  image: ImageSnap;
  isUploader: boolean;
  /** Upload progress 0..1 (uploader only). */
  progress?: number;
  /** Whether Retry is offered (the file is still in memory). */
  canRetry: boolean;
  /** The render clock for the 'unfinished' derivation. */
  now: number;
  onRetry(): void;
  onRemove(): void;
}): ReactElement {
  const { image } = props;
  const [loadFailed, setLoadFailed] = useState(false);

  // A different asset (or a retry→ready cycle) resets the local load error.
  useEffect(() => {
    setLoadFailed(false);
  }, [image.id, image.assetKey]);

  const status = displayStatus(image, props.now);

  if (status === 'ready' && image.assetKey !== null && !loadFailed) {
    return (
      <img
        data-image-ready="true"
        src={`/api/assets/${image.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setLoadFailed(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          display: 'block',
          borderRadius: 3,
        }}
      />
    );
  }

  if (status === 'uploading') {
    const pct =
      props.isUploader && props.progress !== undefined
        ? Math.min(100, Math.max(0, Math.round(props.progress * 100)))
        : null;
    return (
      <Box>
        <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
          ▣
        </span>
        {pct !== null ? (
          <>
            <span data-image-progress="true">
              Uploading {pct}%
            </span>
            <div
              data-progress-track="true"
              style={{ width: '70%', height: 6, background: '#cfd3da', borderRadius: 3 }}
            >
              <div
                data-progress-fill="true"
                style={{ width: `${pct}%`, height: '100%', background: '#1a73e8', borderRadius: 3 }}
              />
            </div>
          </>
        ) : (
          <span>Uploading…</span>
        )}
      </Box>
    );
  }

  if (status === 'failed' && props.isUploader) {
    return (
      <Box failed>
        <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
          ✕
        </span>
        <span>Upload failed</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {props.canRetry && (
            <button
              type="button"
              data-image-retry="true"
              style={BUTTON_STYLE}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={props.onRetry}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            data-image-remove="true"
            style={BUTTON_STYLE}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={props.onRemove}
          >
            Remove
          </button>
        </span>
      </Box>
    );
  }

  if (status === 'unfinished') {
    return (
      <Box>
        <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
          ⏱
        </span>
        <span>{`Image upload didn't finish`}</span>
        <button
          type="button"
          data-image-remove="true"
          style={BUTTON_STYLE}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={props.onRemove}
        >
          Remove
        </button>
      </Box>
    );
  }

  // 'failed' for non-uploaders, or a ready image whose <img> failed to load:
  // an "Image unavailable" box at the image's size; the rest of the board is
  // unaffected (the error is handled here, never propagated).
  return (
    <Box>
      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
        ✕
      </span>
      <span>Image unavailable</span>
    </Box>
  );
}

/**
 * The registry component: positions the object in the world, wires the
 * generic transform gesture (buttons opt out) and maps the registry's
 * `imageCtx` onto the pure renderer.
 */
export function ImageRegistryObject(props: ObjectProps): ReactElement | null {
  const img = props.obj as ImageSnap;
  const ctx = props.imageCtx;
  if (!ctx) return null;
  const id = img.id;
  return (
    <div
      data-object-id={id}
      data-image-id={id}
      {...(props.selected ? { 'data-selected': 'true' } : {})}
      style={{
        position: 'absolute',
        left: img.x,
        top: img.y,
        width: img.width,
        height: img.height,
        outline: props.selected ? '2px solid #1a73e8' : 'none',
        outlineOffset: 1,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return; // Retry/Remove
        e.stopPropagation();
        props.onObjectPointerDown(e, id);
      }}
    >
      <ImageObject
        image={img}
        isUploader={img.uploaderId === ctx.identityId}
        progress={ctx.progress.get(id)}
        canRetry={ctx.canRetry(id)}
        now={ctx.now}
        onRetry={() => ctx.onRetry(id)}
        onRemove={() => ctx.onRemove(id)}
      />
    </div>
  );
}
