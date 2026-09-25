import { CONNECTOR_TYPE } from '../../shared/board-model';
import {
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { STROKE_TYPE } from '../../shared/objects/stroke';
import { SHAPE_TYPE } from '../../shared/objects/shape';
import { isText, TEXT_TYPE } from '../../shared/objects/text';
import { ConnectorObject } from './ConnectorObject';
import { boundsHitTest, connectorHitTest, registerObjectType } from './objectTypes';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeBoardObject, strokeHitTest } from './StrokeObject';
import { TextObject } from './TextObject';
import { textMeasurer } from './textLayout';
import { resizeTextWidth } from './useTextBoxSync';

export * from './objectTypes';

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

/**
 * Free text (story 9). Height always follows the content, so only the side handles show. Alone,
 * a side-handle drag fixes the width; in a mixed selection text is repositioned and only
 * fixed-width text has its width scaled. Font size never changes through handles.
 */
registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  resizeBehavior: (obj, single) => (single || (isText(obj) && obj.widthMode === 'fixed') ? 'width' : 'position'),
  resizeWidth: (doc, id, rect) => resizeTextWidth(doc, id, rect, textMeasurer()),
  hitTest: boundsHitTest,
});

/** Shapes (story 10): freely resizable down to SHAPE_MIN_SIZE_WORLD, with an editable label. */
registerObjectType(SHAPE_TYPE, {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

/**
 * Arrows (story 10): not resizable (their ends are moved with the end handles), selected by a
 * press near the line, never a target for other arrows, and drawn without the selection box.
 */
registerObjectType(CONNECTOR_TYPE, {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  attachable: false,
  selectionBox: false,
  hitByGeometry: true,
  hitTest: connectorHitTest,
});

/**
 * Pen strokes (story 11): selected by a press near the drawn line (pen.select), resized in
 * proportion with the thickness unchanged (pen.resize), no text.
 */
registerObjectType(STROKE_TYPE, {
  Component: StrokeBoardObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitByGeometry: true,
  hitTest: strokeHitTest,
});
