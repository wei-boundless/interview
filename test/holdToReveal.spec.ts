import { describe, expect, it, vi } from 'vitest';
import { bindRevealShortcut, parseRevealShortcut, type RevealKeyEvent } from '../shared/revealShortcut';

function key(type: string, values: Partial<RevealKeyEvent> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), {
    code: 'Space', ctrlKey: true, shiftKey: true, ...values,
  });
}

describe('hold-to-reveal reading shortcut', () => {
  function setup(accelerator = "Control+Shift+Space") {
    const target = new EventTarget();
    const page = new EventTarget();
    const held = vi.fn();
    const reset = vi.fn();
    const dispose = bindRevealShortcut(target, page, held, reset, accelerator);
    return { target, page, held, reset, dispose };
  }

  it('uses a configured shortcut instead of the old default', () => {
    const { target, held, dispose } = setup('Control+Alt+Space');
    target.dispatchEvent(key('keydown'));
    expect(held).not.toHaveBeenCalled();
    target.dispatchEvent(key('keydown', { shiftKey: false, altKey: true }));
    expect(held).toHaveBeenLastCalledWith(true);
    target.dispatchEvent(key('keyup', { code: 'AltLeft', shiftKey: false, altKey: false }));
    expect(held).toHaveBeenLastCalledWith(false);
    dispose();
  });

  it('supports a function key and disables keyboard reveal when empty', () => {
    const active = setup('F8');
    active.target.dispatchEvent(key('keydown', { code: 'F8', ctrlKey: false, shiftKey: false }));
    expect(active.held).toHaveBeenLastCalledWith(true);
    active.target.dispatchEvent(key('keyup', { code: 'F8', ctrlKey: false, shiftKey: false }));
    expect(active.held).toHaveBeenLastCalledWith(false);
    active.dispose();
    const disabled = setup('');
    disabled.target.dispatchEvent(key('keydown'));
    expect(disabled.held).not.toHaveBeenCalled();
    disabled.dispose();
  });

  it('validates shortcut syntax and resolves platform modifiers', () => {
    for (const invalid of ['', 'Control+', 'Control+Control+A', 'Control+F25', 'UnknownKey']) {
      expect(parseRevealShortcut(invalid)).toBeNull();
    }
    expect(parseRevealShortcut('Ctrl+Alt+R')).toMatchObject({ code: 'KeyR', ctrlKey: true, altKey: true });
    expect(parseRevealShortcut('CommandOrControl+Space', true)).toMatchObject({ metaKey: true, ctrlKey: false });
    expect(parseRevealShortcut('CommandOrControl+Space')).toMatchObject({ metaKey: false, ctrlKey: true });
  });

  it.each([
    ['A', 'KeyA', {}], ['Space', 'Space', {}], ['3', 'Digit3', {}],
    ['·', 'Backquote', {}], ['`', 'Backquote', {}], ['Backquote', 'Backquote', {}],
    [';', 'Semicolon', {}], ['/', 'Slash', {}],
    ['Ctrl', 'ControlLeft', { ctrlKey: true }], ['Ctrl', 'ControlRight', { ctrlKey: true }],
    ['Alt', 'AltLeft', { altKey: true }], ['Shift', 'ShiftRight', { shiftKey: true }],
  ])('supports holding a single %s key (%s)', (shortcut, code, modifiers) => {
    const { target, held, dispose } = setup(shortcut);
    const event = key('keydown', { code, ctrlKey: false, shiftKey: false, ...modifiers });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(held).toHaveBeenLastCalledWith(true);
    target.dispatchEvent(key('keyup', { code, ctrlKey: false, shiftKey: false }));
    expect(held).toHaveBeenLastCalledWith(false);
    dispose();
  });

  it('does not intercept configured single keys while typing in an editable target', () => {
    const target = Object.assign(new EventTarget(), { closest: () => ({ tagName: 'INPUT' }) });
    const held = vi.fn();
    const dispose = bindRevealShortcut(target, new EventTarget(), held, vi.fn(), 'A');
    const event = key('keydown', { code: 'KeyA', ctrlKey: false, shiftKey: false });
    target.dispatchEvent(event);
    expect(held).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it('reveals only while the full combination is held and releases on either modifier', () => {
    const { target, held, dispose } = setup();
    const down = key('keydown');
    target.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(held).toHaveBeenLastCalledWith(true);
    for (const release of [{ code: 'Space' }, { code: 'ControlLeft', ctrlKey: false }, { code: 'ShiftLeft', shiftKey: false }]) {
      target.dispatchEvent(key('keydown'));
      target.dispatchEvent(key('keyup', release));
      expect(held).toHaveBeenLastCalledWith(false);
    }
    dispose();
  });

  it('leaves normal typing, IME composition and other combinations untouched', () => {
    const { target, held, dispose } = setup();
    for (const values of [{ ctrlKey: false }, { shiftKey: false }, { altKey: true }, { metaKey: true }, { isComposing: true }, { code: 'KeyA' }]) {
      const event = key('keydown', values);
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(held).not.toHaveBeenCalled();
    dispose();
  });

  it('resets on focus loss or hidden window and removes listeners on cleanup', () => {
    const { target, page, held, reset, dispose } = setup();
    target.dispatchEvent(new Event('blur'));
    page.dispatchEvent(new Event('visibilitychange'));
    expect(reset).toHaveBeenCalledTimes(2);
    dispose();
    target.dispatchEvent(key('keydown'));
    target.dispatchEvent(new Event('blur'));
    page.dispatchEvent(new Event('visibilitychange'));
    expect(held).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(2);
  });
});
