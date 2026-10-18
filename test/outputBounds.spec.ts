import { describe, expect, it } from 'vitest';
import { fitOutputBounds, isOutputSize } from '../shared/outputBounds';

const work = { x: -1920, y: 0, width: 1920, height: 1040 };
const current = { x: -900, y: 100, width: 700, height: 500 };
describe('output auto-size boundaries', () => {
  it('shrinks around short output without moving the anchor', () => {
    expect(fitOutputBounds(current, { height: 90 }, work)).toEqual({ ...current, height: 90 });
  });
  it('caps long output at the chosen width and monitor work area', () => {
    expect(fitOutputBounds(current, { height: 40000 }, work)).toEqual({ x: -900, y: 0, width: 700, height: 1040 });
  });
  it('keeps a recoverable handle for empty output', () => {
    expect(fitOutputBounds(current, { height: 1 }, work)).toMatchObject({ width: 700, height: 72 });
  });
  it('rejects malformed or non-finite IPC sizes', () => {
    for (const value of [null, '300', {}, { height: NaN }, { height: Infinity }, { height: -1 }, { height: '2' }]) {
      expect(isOutputSize(value)).toBe(false);
    }
    expect(isOutputSize({ height: 72 })).toBe(true);
  });
});
