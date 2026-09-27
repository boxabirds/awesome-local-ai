import { contrastRatio, meetsContrast } from '@todoodle/shared/contrast';
import { PROJECT_COLOR_TOKENS, THEME_TOKENS, TEXT_PAIRS, UI_PAIRS } from '@todoodle/shared/tokens';
import { describe, expect, it } from 'vitest';

const THEMES = ['light', 'dark'] as const;

describe('theme token contrast (WCAG 2.2 AA)', () => {
  it.each(THEMES)('TC-85 %s: every text pair is at least 4.5:1', (theme) => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrastRatio(THEME_TOKENS[theme][fg], THEME_TOKENS[theme][bg]);
      expect(meetsContrast('text', ratio), `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBe(true);
    }
  });

  it.each(THEMES)('TC-85 %s: every UI pair is at least 3:1', (theme) => {
    for (const [fg, bg] of UI_PAIRS) {
      const ratio = contrastRatio(THEME_TOKENS[theme][fg], THEME_TOKENS[theme][bg]);
      expect(meetsContrast('ui', ratio), `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBe(true);
    }
  });

  it.each(THEMES)('TC-85 %s: every project colour is at least 3:1 on the background', (theme) => {
    for (const [name, value] of Object.entries(PROJECT_COLOR_TOKENS[theme])) {
      const ratio = contrastRatio(value, THEME_TOKENS[theme].background);
      expect(meetsContrast('ui', ratio), `${name}: ${ratio.toFixed(2)}`).toBe(true);
    }
    expect(Object.keys(PROJECT_COLOR_TOKENS[theme])).toHaveLength(12);
  });

  it('TC-85 the checker: exactly 4.5 and 3.0 pass, 4.49 and 2.99 fail', () => {
    expect(meetsContrast('text', 4.5)).toBe(true);
    expect(meetsContrast('text', 4.49)).toBe(false);
    expect(meetsContrast('ui', 3)).toBe(true);
    expect(meetsContrast('ui', 2.99)).toBe(false);
  });

  it('TC-85 the ratio maths matches known values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    // A synthetic pair just under 4.5 fails.
    const nearMiss = contrastRatio('#777777', '#ffffff');
    expect(nearMiss).toBeLessThan(4.5);
    expect(meetsContrast('text', nearMiss)).toBe(false);
  });
});
