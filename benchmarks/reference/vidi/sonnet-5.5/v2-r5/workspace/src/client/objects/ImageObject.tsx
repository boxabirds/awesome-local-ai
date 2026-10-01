import { useContext, useEffect, useState } from 'react';
import { deleteObjects, objectBounds } from '../../shared/board-model';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { ImageContext } from '../images/ImageContext';
import type { ObjectProps } from './registry';

const PRIMARY_BUTTON = 0;
const CLOCK_TICK_MS = 30_000;
const PERCENT = 100;

const ImageIcon = ({ broken = false }: { broken?: boolean }) => (
  <svg className="image-icon" data-broken={broken} width="28" height="28" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    {broken ? <path d="M3 15l5-4 4 3 3-2 6 5M14 4l-3 6" /> : <path d="M3 17l5-5 4 4 3-3 6 6M9 9h.01" />}
  </svg>
);

const stopPress = (e: { stopPropagation(): void }) => e.stopPropagation();

export function ImageObject(props: {
  image: ImageSnap; isUploader: boolean; progress?: number; canRetry: boolean; now: number;
  onRetry(): void; onRemove(): void;
}) {
  const { image, isUploader, now } = props;
  const status = displayStatus(image, now);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const broken = status === 'ready' && failedKey !== null && failedKey === image.assetKey;
  const unavailable = status === 'ready' ? broken : status === 'failed' && !isUploader;
  const percent = Math.round(Math.min(1, Math.max(0, props.progress ?? 0)) * PERCENT);

  if (status === 'ready' && !broken) {
    return (
      <img
        className="image-media" src={`/api/assets/${image.assetKey}`} alt="Image" draggable={false}
        decoding="async" loading="lazy" onError={() => setFailedKey(image.assetKey)}
      />
    );
  }
  if (unavailable) {
    return (
      <div className="image-box image-unavailable">
        <ImageIcon broken /><span>Image unavailable</span>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="image-box image-failed">
        <span>Upload failed</span>
        <div className="image-actions">
          {props.canRetry && <button type="button" onPointerDown={stopPress} onClick={props.onRetry}>Retry</button>}
          <button type="button" onPointerDown={stopPress} onClick={props.onRemove}>Remove</button>
        </div>
      </div>
    );
  }
  if (status === 'unfinished') {
    return (
      <div className="image-box image-unfinished">
        <span>Image upload didn&apos;t finish</span>
        <div className="image-actions">
          <button type="button" onPointerDown={stopPress} onClick={props.onRemove}>Remove</button>
        </div>
      </div>
    );
  }
  return (
    <div className="image-box image-uploading">
      {isUploader ? (
        <>
          <ImageIcon />
          <div className="image-progress" role="progressbar" aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={percent}>
            <div className="image-progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <span>{percent}%</span>
        </>
      ) : <span>Uploading…</span>}
    </div>
  );
}

/** Registry component: frames the image as a board object and bridges generic props to ImageObject. */
export function BoardImage(props: ObjectProps) {
  const image = props.object as ImageSnap;
  const ctx = useContext(ImageContext);
  const [now, setNow] = useState(() => Date.now());
  const uploading = image.status === 'uploading';
  useEffect(() => {
    setNow(Date.now());
    if (!uploading) return undefined;
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, [uploading, image.uploadStartedAt]);
  const { width, height } = objectBounds({ ...image, width: image.width ?? 1, height: image.height ?? 1 });
  const remove = () => {
    if (props.readOnly) return;
    props.undo?.boundary();
    deleteObjects(props.doc, [image.id]);
    props.undo?.boundary();
  };
  return (
    <div
      role="group"
      aria-label="Image"
      data-image=""
      data-id={image.id}
      data-x={image.x}
      data-y={image.y}
      data-width={width}
      data-height={height}
      data-status={displayStatus(image, now)}
      data-selected={props.selected}
      data-dragging={props.dragging}
      className="image-object"
      style={{ left: image.x, top: image.y, zIndex: image.z, width, height, cursor: props.dragging ? 'grabbing' : 'pointer' }}
      onPointerDown={(e) => {
        if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
        e.stopPropagation();
        props.onPointerDown(e, image.id);
      }}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === ctx.identityId}
        progress={ctx.progress.get(image.id)}
        canRetry={ctx.canRetry(image.id) && !props.readOnly}
        now={now}
        onRetry={() => { ctx.retry(image.id); }}
        onRemove={remove}
      />
    </div>
  );
}
