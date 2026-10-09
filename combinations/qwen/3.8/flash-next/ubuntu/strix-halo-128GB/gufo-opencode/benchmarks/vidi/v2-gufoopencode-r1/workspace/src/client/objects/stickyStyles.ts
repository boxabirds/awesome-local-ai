import type { CSSProperties } from 'react';
import { STICKY_SIZE_WORLD } from '../../shared/config';

// Inner padding of a note; the text box is the note size minus this on each
// side. Not a product setting — a presentational constant.
export const STICKY_PADDING_WORLD = 16;
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export const SELECTION_OUTLINE_COLOR = '#2563eb';

export const noteRootStyle: CSSProperties = {
  position: 'absolute',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.18)',
  outlineOffset: 2
};

export const noteBodyStyle: CSSProperties = {
  position: 'absolute',
  inset: STICKY_PADDING_WORLD,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

export const noteTextStyle: CSSProperties = {
  width: '100%',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  textAlign: 'center',
  color: '#1f2937',
  lineHeight: 1.25
};

export const noteFadeStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 28,
  pointerEvents: 'none',
  backgroundImage: 'linear-gradient(to bottom, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.92))'
};

export const editorStyle: CSSProperties = {
  position: 'absolute',
  inset: STICKY_PADDING_WORLD,
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  overflow: 'hidden',
  color: '#1f2937',
  textAlign: 'center',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  lineHeight: 1.25,
  fontFamily: 'inherit'
};
