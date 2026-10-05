/**
 * Text object type spec for the registry (story 9).
 */
import { TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { hitTestBounds, type ObjectTypeSpec } from './registry';
import { TextObjectComponent } from './TextObject';

export const textObjectType: ObjectTypeSpec = {
  resizable: true,
  aspectLocked: false,
  editableText: true,
  minSize: TEXT_MIN_WIDTH_WORLD,
  hitTest: hitTestBounds,
  handles: 'horizontal',
  Component: function TextType(props) {
    return <TextObjectComponent {...props} />;
  },
};
