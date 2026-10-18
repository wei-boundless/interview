export const REVEAL_HOLD_DELAYS = [0, 80, 150, 300, 500] as const;
export const DEFAULT_REVEAL_HOLD_DELAY_MS = 0;
export function isRevealHoldDelay(value: unknown): value is number {
  return typeof value === 'number' && REVEAL_HOLD_DELAYS.some((delay) => delay === value);
}

/** Brief debounce for the mandatory combination; release always clears immediately. */
export class HoldRevealGate {
  private armed = false;
  private since: number | null = null;
  constructor(private delayMs = DEFAULT_REVEAL_HOLD_DELAY_MS) {}
  setDelay(delayMs: number) {
    if (!isRevealHoldDelay(delayMs)) throw new Error('Invalid reveal delay');
    if (this.delayMs === delayMs) return false;
    this.delayMs = delayMs;
    this.reset();
    return true;
  }
  reset() { this.armed = false; this.since = null; }
  sample(down: boolean, now: number): boolean {
    if (!down) { this.armed = true; this.since = null; return false; }
    if (!this.armed) return false;
    this.since ??= now;
    return now - this.since >= this.delayMs;
  }
}
