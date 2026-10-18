import { describe, expect, it } from 'vitest';
import { HoldRevealGate, REVEAL_HOLD_DELAYS, isRevealHoldDelay } from '../shared/holdRevealGate';
describe('deliberate global reveal', () => {
  it('reveals on the first pressed sample by default, after a fresh release', () => {
    const gate = new HoldRevealGate();
    expect(gate.sample(true, 0)).toBe(false);
    gate.sample(false, 1);
    expect(gate.sample(true, 2)).toBe(true);
    expect(gate.sample(false, 3)).toBe(false);
  });
  it.each(REVEAL_HOLD_DELAYS)('honors the selected %i ms delay and never delays release', (delay) => {
    const gate = new HoldRevealGate(delay);
    gate.sample(false, 0);
    expect(gate.sample(true, 10)).toBe(delay === 0);
    if (delay) expect(gate.sample(true, 10 + delay - 1)).toBe(false);
    expect(gate.sample(true, 10 + delay)).toBe(true);
    expect(gate.sample(false, 11 + delay)).toBe(false);
  });
  it('clears an active hold when the delay changes and rejects invalid values', () => {
    const gate = new HoldRevealGate();
    gate.sample(false, 0); expect(gate.sample(true, 1)).toBe(true);
    expect(gate.setDelay(300)).toBe(true);
    expect(gate.sample(true, 1000)).toBe(false);
    for (const invalid of [-1, 1, Infinity, NaN, '80', null]) expect(isRevealHoldDelay(invalid)).toBe(false);
    expect(() => gate.setDelay(-1)).toThrow('Invalid reveal delay');
  });
  it('reveals after an 80ms debounce and releases immediately', () => {
    const gate = new HoldRevealGate(80);
    expect(gate.sample(false, 0)).toBe(false);
    expect(gate.sample(true, 100)).toBe(false);
    expect(gate.sample(false, 150)).toBe(false);
    expect(gate.sample(true, 300)).toBe(false);
    expect(gate.sample(true, 379)).toBe(false);
    expect(gate.sample(true, 380)).toBe(true);
    expect(gate.sample(false, 381)).toBe(false);
  });
  it('requires release before arming at startup or after hiding', () => {
    const gate = new HoldRevealGate();
    expect(gate.sample(true, 0)).toBe(false);
    expect(gate.sample(true, 1000)).toBe(false);
    gate.sample(false, 1100); gate.sample(true, 1200);
    expect(gate.sample(true, 1500)).toBe(true);
    gate.reset();
    expect(gate.sample(true, 2000)).toBe(false);
  });
});
