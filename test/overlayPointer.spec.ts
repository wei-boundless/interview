import { describe, expect, it } from 'vitest';
import { shouldIgnoreOverlayPointer } from '../shared/overlayPointer';

const base = { stealthHidden: false, textOnly: true, interactive: false,
  bounds: { x: -800, y: 100, width: 500, height: 400 }, cursor: { x: -600, y: 250 } };
describe('text-only overlay pointer policy', () => {
  it('passes output and the rest of the top edge through, leaving a small recovery handle', () => {
    expect(shouldIgnoreOverlayPointer(base)).toBe(true);
    expect(shouldIgnoreOverlayPointer({ ...base, cursor: { x: -600, y: 120 } })).toBe(true);
    expect(shouldIgnoreOverlayPointer({ ...base, cursor: { x: -785, y: 120 } })).toBe(false);
    expect(shouldIgnoreOverlayPointer({ ...base, cursor: { x: -750, y: 120 } })).toBe(false);
    expect(shouldIgnoreOverlayPointer({ ...base, cursor: { x: -735, y: 120 } })).toBe(true);
    expect(shouldIgnoreOverlayPointer({ ...base, cursor: { x: -900, y: 120 } })).toBe(true);
  });
  it('restores interaction for panels and normal modes', () => {
    expect(shouldIgnoreOverlayPointer({ ...base, interactive: true })).toBe(false);
    expect(shouldIgnoreOverlayPointer({ ...base, textOnly: false })).toBe(false);
  });
  it.each([true, false])('hidden state overrides every mode and interaction request (%s)', (textOnly) => {
    for (const interactive of [true, false]) {
      expect(shouldIgnoreOverlayPointer({ ...base, stealthHidden: true, textOnly, interactive,
        cursor: { x: -785, y: 120 } })).toBe(true);
    }
  });
});
