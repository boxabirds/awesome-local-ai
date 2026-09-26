import {
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  contrastRatio,
  meetsContrast,
} from '@todoodle/shared/contrast';
import {
  PROJECT_COLORS,
  PROJECT_COLOR_TOKENS,
  SEMANTIC_TOKENS,
  TEXT_PAIRS,
  TOKENS,
  type Theme,
  UI_PAIRS,
} from '@todoodle/shared/tokens';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderTokensCss } from '../../scripts/build-tokens.ts';

const THEMES: Theme[] = ['light', 'dark'];

describe('TC-85 theme token contrast', () => {
  it.each(THEMES)('%s: every text pair is at least 4.5:1', (theme) => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrastRatio(TOKENS[theme][fg], TOKENS[theme][bg]);
      expect(meetsContrast(ratio, 'text'), `${theme} ${fg} on ${bg} = ${ratio.toFixed(2)}`).toBe(true);
    }
  });

  it.each(THEMES)('%s: every UI pair (and every project colour) is at least 3:1', (theme) => {
    for (const [fg, bg] of UI_PAIRS) {
      const ratio = contrastRatio(TOKENS[theme][fg], TOKENS[theme][bg]);
      expect(meetsContrast(ratio, 'ui'), `${theme} ${fg} on ${bg} = ${ratio.toFixed(2)}`).toBe(true);
    }
    for (const color of PROJECT_COLORS) {
      const ratio = contrastRatio(PROJECT_COLOR_TOKENS[theme][color], TOKENS[theme].background);
      expect(meetsContrast(ratio, 'ui'), `${theme} project ${color} = ${ratio.toFixed(2)}`).toBe(true);
    }
  });

  it('the checker: known ratios, exact thresholds, and a synthetic 4.49 pair fails', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(meetsContrast(MIN_TEXT_CONTRAST, 'text')).toBe(true);
    expect(meetsContrast(4.49, 'text')).toBe(false);
    expect(meetsContrast(MIN_UI_CONTRAST, 'ui')).toBe(true);
    expect(meetsContrast(2.99, 'ui')).toBe(false);
    // #777 on white is 4.48:1 (just under), #767676 is 4.54:1 (just over).
    const under = contrastRatio('#777777', '#ffffff');
    expect(under).toBeGreaterThan(4.47);
    expect(under).toBeLessThan(4.5);
    expect(meetsContrast(under, 'text')).toBe(false);
    expect(meetsContrast(contrastRatio('#767676', '#ffffff'), 'text')).toBe(true);
  });

  it('the committed tokens.css is generated from the shared tokens (single source of truth)', () => {
    const committed = readFileSync(path.join(import.meta.dirname, '../../src/styles/tokens.css'), 'utf8');
    expect(committed).toBe(renderTokensCss());
    for (const theme of THEMES) {
      for (const token of SEMANTIC_TOKENS) expect(committed).toContain(`--${token}: ${TOKENS[theme][token]};`);
    }
    expect(committed).toContain('color-scheme: light dark');
    expect(committed).toContain('@media (prefers-color-scheme: dark)');
    expect(committed).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
