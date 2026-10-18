export interface RevealKeyEvent extends Event {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

export const DEFAULT_REVEAL_SHORTCUT = 'Shift+`';

/** Explicit key codes keep hold/release matching stable across keyboard layouts. */
export function parseRevealShortcut(value: string, isMac = false) {
  const parts = value.toLowerCase().split('+').map((part) => part.trim());
  if (parts.some((part) => !part)) return null;
  const key = parts.pop()!;
  const modifiers = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  for (const part of parts) {
    const modifier = part === 'control' || part === 'ctrl' ? 'ctrlKey'
      : part === 'shift' ? 'shiftKey'
      : part === 'alt' || part === 'option' ? 'altKey'
      : ['meta', 'super', 'command', 'cmd'].includes(part) ? 'metaKey'
      : ['commandorcontrol', 'cmdorctrl'].includes(part) ? (isMac ? 'metaKey' : 'ctrlKey') : null;
    if (!modifier || modifiers[modifier]) return null;
    modifiers[modifier] = true;
  }
  const special: Record<string, string> = {
    '·': 'Backquote', '`': 'Backquote', backquote: 'Backquote',
    '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
    ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash',
    space: 'Space', enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
    backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
  };
  const modifierKeys: Record<string, [string, keyof typeof modifiers]> = {
    control: ['Control', 'ctrlKey'], ctrl: ['Control', 'ctrlKey'],
    alt: ['Alt', 'altKey'], option: ['Alt', 'altKey'], shift: ['Shift', 'shiftKey'],
    meta: ['Meta', 'metaKey'], command: ['Meta', 'metaKey'], cmd: ['Meta', 'metaKey'], super: ['Meta', 'metaKey'],
  };
  const primaryModifier = modifierKeys[key];
  if (primaryModifier) {
    if (modifiers[primaryModifier[1]]) return null;
    modifiers[primaryModifier[1]] = true;
  }
  const code = primaryModifier?.[0] ?? special[key] ?? (/^[a-z]$/.test(key) ? `Key${key.toUpperCase()}`
    : /^\d$/.test(key) ? `Digit${key}` : /^f([1-9]|1\d|2[0-4])$/.test(key) ? key.toUpperCase() : undefined);
  if (!code) return null;
  return { code, ...modifiers };
}

export function bindRevealShortcut(
  target: EventTarget,
  page: EventTarget,
  setHeld: (held: boolean) => void,
  reset: () => void,
  accelerator = DEFAULT_REVEAL_SHORTCUT,
  isMac = false,
) {
  const shortcut = parseRevealShortcut(accelerator, isMac);
  const modifiersMatch = (event: RevealKeyEvent) => shortcut &&
    !!event.ctrlKey === shortcut.ctrlKey && !!event.shiftKey === shortcut.shiftKey &&
    !!event.altKey === shortcut.altKey && !!event.metaKey === shortcut.metaKey;
  const keyMatches = (code: string) => shortcut &&
    (code === shortcut.code || code.replace(/(Left|Right)$/, '') === shortcut.code);
  const down = (raw: Event) => {
    const event = raw as RevealKeyEvent;
    if (!shortcut || !keyMatches(event.code) || !modifiersMatch(event)) return;
    if (event.isComposing) return;
    const element = event.target as { closest?: (selector: string) => unknown } | null;
    if (element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    setHeld(true);
  };
  const up = (raw: Event) => {
    const event = raw as RevealKeyEvent;
    if (shortcut && (keyMatches(event.code) || !modifiersMatch(event))) setHeld(false);
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', reset);
  page.addEventListener('visibilitychange', reset);
  page.addEventListener('focusin', reset);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', reset);
    page.removeEventListener('visibilitychange', reset);
    page.removeEventListener('focusin', reset);
  };
}

