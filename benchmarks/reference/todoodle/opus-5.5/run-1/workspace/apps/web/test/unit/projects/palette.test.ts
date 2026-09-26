import { PROJECT_COLORS } from '@todoodle/shared/limits';
import { MIN_UI_CONTRAST, contrastRatio } from '@todoodle/shared/contrast';
import { TOKENS } from '@todoodle/shared/tokens';
import { describe, expect, it } from 'vitest';

// Story 7, TC-83 (prd.colour_legible): every project colour reaches 3:1 (WCAG 1.4.11) against the surfaces
// dots sit on, in both themes: the sidebar and dialogs (background) and the active row (muted).

const SURFACES = {
  light: [TOKENS.light.background, TOKENS.light.muted],
  dark: [TOKENS.dark.background, TOKENS.dark.muted],
} as const;

describe('TC-83 PROJECT_COLORS', () => {
  it.each(PROJECT_COLORS.map((color) => [color.key, color] as const))('%s is at least 3:1 in light and dark', (_key, color) => {
    for (const surface of SURFACES.light) {
      expect(contrastRatio(color.light, surface), `${color.key} light on ${surface}`).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    }
    for (const surface of SURFACES.dark) {
      expect(contrastRatio(color.dark, surface), `${color.key} dark on ${surface}`).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    }
  });

  it('has 12 entries with unique keys and unique labels (swatches are named for screen readers)', () => {
    expect(PROJECT_COLORS).toHaveLength(12);
    expect(new Set(PROJECT_COLORS.map((c) => c.key)).size).toBe(12);
    expect(new Set(PROJECT_COLORS.map((c) => c.label)).size).toBe(12);
    for (const color of PROJECT_COLORS) expect(color.label.trim()).not.toBe('');
  });
});
