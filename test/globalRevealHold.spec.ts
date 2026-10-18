import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
import { GlobalRevealHold } from '../electron/globalRevealHold';
let probe: GlobalRevealHold;
let children: any[];
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  Object.defineProperty(process, 'platform', { value: 'win32' });
  children = [];
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    children.push(child); return child;
  });
});
afterEach(() => { probe?.stop(); vi.useRealTimers(); Object.defineProperty(process, 'platform', platform); vi.clearAllMocks(); });
it('defaults to immediate reveal and applies a new delay without restarting the helper', () => {
  const changed = vi.fn(); probe = new GlobalRevealHold('test.ps1', () => true, changed);
  probe.setEnabled(true);
  const sample = (s:string) => children[0].stdout.emit('data', Buffer.from(s));
  sample('0\n1\n'); expect(changed).toHaveBeenLastCalledWith(true);
  probe.setEnabled(true, 150); expect(changed).toHaveBeenLastCalledWith(false);
  expect(children).toHaveLength(1);
  sample('1\n'); expect(changed).toHaveBeenLastCalledWith(false);
  sample('0\n1\n'); vi.advanceTimersByTime(149); sample('1\n');
  expect(changed).toHaveBeenLastCalledWith(false);
  vi.advanceTimersByTime(1); sample('1\n'); expect(changed).toHaveBeenLastCalledWith(true);
  sample('0\n'); expect(changed).toHaveBeenLastCalledWith(false);
});
it('recovers from an exited helper with a bounded delay and requires fresh release', () => {
  const changed = vi.fn(); probe = new GlobalRevealHold('test.ps1', () => true, changed);
  probe.setEnabled(true, 80); children[0].emit('exit', 1);
  probe.setEnabled(true, 80); expect(children).toHaveLength(1);
  vi.advanceTimersByTime(2000); probe.setEnabled(true, 80); expect(children).toHaveLength(2);
  children[1].stdout.emit('data', Buffer.from('1\n')); expect(changed).not.toHaveBeenCalledWith(true);
  children[1].stdout.emit('data', Buffer.from('0\n1\n'));
  for(let i=0;i<4;i++){vi.advanceTimersByTime(100);children[1].stdout.emit('data',Buffer.from('1\n'));}
  expect(changed).toHaveBeenLastCalledWith(true);
});
it('does not discard a release in a batched read and fails closed on stale samples', () => {
  const changed = vi.fn(); probe = new GlobalRevealHold('test.ps1', () => true, changed); probe.setEnabled(true, 80);
  const sample = (s:string) => children[0].stdout.emit('data',Buffer.from(s));
  sample('0\n1\n');
  for(let i=0;i<3;i++){vi.advanceTimersByTime(100);sample('1\n');}
  expect(changed).toHaveBeenLastCalledWith(true);
  sample('0\n1\n'); expect(changed).toHaveBeenLastCalledWith(false);
  for(let i=0;i<3;i++){vi.advanceTimersByTime(100);sample('1\n');}
  expect(changed).toHaveBeenLastCalledWith(true);
  vi.advanceTimersByTime(250); expect(changed).toHaveBeenLastCalledWith(false);
  probe.stop(); vi.advanceTimersByTime(3000); expect(children).toHaveLength(1);
});
