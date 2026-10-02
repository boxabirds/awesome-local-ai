import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';
import { objectBounds } from '../../src/shared/board-model';
import { rectContains } from '../../src/shared/geometry';

/**
 * Test-only board object type (used by component tests for the non-sticky
 * branches of the generic multi-selection code):
 *   - resizable: true
 *   - aspectLocked: false (free rectangular resizing)
 *   - minSize: 10
 *   - editableText: false
 */
function TestBox({ obj, selected }: ObjectProps): React.ReactElement {
  const width = obj.width ?? 100;
  const height = obj.height ?? 80;
  return (
    <div
      data-testid={`testbox-${obj.id}`}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        zIndex: obj.z,
        background: '#E1BEE7',
        outline: selected ? '2px solid #1565C0' : 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}

registerObjectType('testbox', {
  Component: TestBox,
  resizable: true,
  aspectLocked: false,
  minSize: 10,
  editableText: false,
  hitTest: (obj, p) =>
    rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 }),
});

export { TestBox };
export const TESTBOX_MIN_SIZE = 10;
