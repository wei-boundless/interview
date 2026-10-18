import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { HoldRevealGate } from '../shared/holdRevealGate';

/** Windows-only, mode-scoped key-state probe. Does not register or consume keys. */
export class GlobalRevealHold {
  private child: ChildProcess | null = null;
  private enabled = false;
  private gate = new HoldRevealGate();
  private lastSample = 0;
  private held = false;
  private retryAfter = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  constructor(private scriptPath: string, private allowed: () => boolean,
    private changed: (held: boolean) => void) {}
  private emit(held: boolean) {
    if (held === this.held) return;
    this.held = held;
    this.changed(held);
  }
  reset() { this.gate.reset(); this.emit(false); }
  setEnabled(enabled: boolean, delayMs = 0) {
    if (this.gate.setDelay(delayMs)) this.emit(false);
    if (this.enabled === enabled && (!enabled || this.child || Date.now() < this.retryAfter)) return;
    this.stop();
    this.enabled = enabled;
    if (!enabled || process.platform !== 'win32') return;
    this.retryAfter = Date.now() + 2000;
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', this.scriptPath, '-ParentProcessId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let pending = '';
    child.stdout?.on('data', (data: Buffer) => {
      if (this.child !== child) return;
      pending += data.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      if (pending.length > 32) { this.reset(); pending = ''; }
      // Process releases even when multiple samples arrive together. Never
      // backdate a press: a delayed batch cannot count as a sustained hold.
      for (const sample of lines) {
        if (sample !== '0' && sample !== '1') continue;
        this.lastSample = Date.now();
        if (!this.allowed()) { this.reset(); continue; }
        this.emit(this.gate.sample(sample === '1', this.lastSample));
      }
    });
    child.stderr?.on('data', () => { this.reset(); });
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      this.retryAfter = Date.now() + 2000;
      this.reset();
    };
    child.on('error', (error) => { console.warn('[reveal-hold] unavailable:', error.message); failed(); });
    child.on('exit', failed);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastSample > 200 || !this.allowed()) this.reset();
    }, 50);
    this.watchdog.unref();
  }
  stop() {
    this.enabled = false;
    const child = this.child;
    this.child = null;
    child?.kill();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.lastSample = 0;
    this.reset();
  }
}
