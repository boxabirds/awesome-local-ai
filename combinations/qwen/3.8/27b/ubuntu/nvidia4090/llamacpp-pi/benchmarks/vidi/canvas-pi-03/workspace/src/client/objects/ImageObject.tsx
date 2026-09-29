import { useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { displayStatus, type ImageSnap } from '@/shared/objects/image';

/**
 * Story 12 — image object rendering and states (image.object and friends).
 *
 * The outer element is a positioned div (left/top = the object's world rect,
 * width/height = the placed/ resized size, z = stack order) like every other
 * object; a pointerdown anywhere on it routes to the board's transform gesture
 * (select/move/resize). Buttons stop pointerdown propagation so they click
 * instead of dragging.
 *
 * The body follows `displayStatus(image, now)`:
 *  - uploading → grey box: progress % for the uploader, "Uploading…" otherwise
 *    (every participant renders this from the doc fields alone, image.uploading);
 *  - ready → the `<img>` (nosniff-served, immutable) sized to the box; a load
 *    error switches to the unavailable box (image.unavailable);
 *  - failed → "Upload failed" + Retry (uploader, only while the File is in
 *    memory) + Remove; "Image unavailable" for other viewers (image.upload_failure);
 *  - unfinished → "Image upload didn't finish" + Remove (image.unfinished).
 */
export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  /** 0..1 upload progress (uploader only). */
  progress?: number;
  /** True while the image's File is still in memory (Retry is offered). */
  canRetry: boolean;
  /** Clock (epoch ms) used to derive `unfinished`. */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /** Interaction props passed through from the registry adapter (optional). */
  selected?: boolean;
  onObjectPointerDown?: (e: ReactPointerEvent<Element>) => void;
}

function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}

export function ImageObject(props: ImageObjectProps): ReactElement {
  const image = props.image;
  const status = displayStatus(image, props.now);
  // A failed-to-load image (img error) is shown as "Image unavailable" (render
  // only; never propagates).
  const [loadFailed, setLoadFailed] = useState(false);

  const pointerDown = props.onObjectPointerDown;
  const buttonPointerDown = (e: ReactPointerEvent): void => e.stopPropagation();

  let body: ReactElement;
  if (status === 'ready' && image.assetKey !== null && !loadFailed) {
    body = (
      <img
        data-testid="image-ready"
        src={assetUrl(image.assetKey)}
        draggable={false}
        decoding="async"
        loading="lazy"
        alt="Image"
        onError={() => setLoadFailed(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    );
  } else if (status === 'ready' && loadFailed) {
    body = <UnavailableBox />;
  } else if (status === 'uploading') {
    const pct =
      props.isUploader && typeof props.progress === 'number'
        ? `${Math.round(props.progress * 100)}%`
        : 'Uploading…';
    body = (
      <Box label={pct} dataStatus="uploading" />
    );
  } else if (status === 'failed') {
    body = (
      <div style={panelStyle}>
        {props.isUploader ? (
          <>
            <span style={labelStyle}>Upload failed</span>
            {props.canRetry && (
              <Button testId="image-retry" onPointerDown={buttonPointerDown} onClick={props.onRetry}>
                Retry
              </Button>
            )}
            <Button testId="image-remove" onPointerDown={buttonPointerDown} onClick={props.onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <span style={labelStyle}>Image unavailable</span>
        )}
      </div>
    );
  } else {
    // 'unfinished'
    body = (
      <div style={panelStyle}>
        <span style={labelStyle}>Image upload didn’t finish</span>
        <Button testId="image-remove" onPointerDown={buttonPointerDown} onClick={props.onRemove}>
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="image"
      data-id={image.id}
      data-type="image"
      data-status={status}
      data-selected={props.selected ? true : undefined}
      onPointerDown={pointerDown}
      style={{
        position: 'absolute',
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        zIndex: image.z,
        boxSizing: 'border-box',
      }}
    >
      {body}
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'repeating-linear-gradient(45deg, #e9e9ef, #e9e9ef 12px, #e2e2ea 12px, #e2e2ea 24px)',
  border: '1px solid #d0d0d8',
  borderRadius: 6,
  overflow: 'hidden',
  pointerEvents: 'none',
};

const panelStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: '#f3e3e3',
  border: '1px solid #d8b4b4',
  borderRadius: 6,
  padding: 8,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#4a2020',
  textAlign: 'center',
  lineHeight: 1.3,
  pointerEvents: 'none',
};

function Box({ label, dataStatus }: { label: string; dataStatus: string }): ReactElement {
  return (
    <div data-testid={`image-${dataStatus}`} style={boxStyle}>
      <span style={{ ...labelStyle, color: '#444' }}>{label}</span>
    </div>
  );
}

function UnavailableBox(): ReactElement {
  return (
    <div data-testid="image-unavailable" style={{ ...panelStyle, background: '#efe3f3', border: '1px solid #cbb4d8' }}>
      <span style={{ ...labelStyle, color: '#3a2547' }}>Image unavailable</span>
    </div>
  );
}

function Button(props: {
  testId: string;
  onPointerDown: (e: ReactPointerEvent) => void;
  onClick: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      data-testid={props.testId}
      onPointerDown={props.onPointerDown}
      onClick={props.onClick}
      style={{
        fontSize: 12,
        padding: '3px 10px',
        borderRadius: 6,
        border: '1px solid #b8b8c0',
        background: '#fff',
        cursor: 'pointer',
      }}
    >
      {props.children}
    </button>
  );
}
