import { useEffect, useState } from 'react';
import { bindRevealShortcut, DEFAULT_REVEAL_SHORTCUT } from '../shared/revealShortcut';

/** Local reading shortcut only; never sends commands to capture or model services. */
export function useHoldToReveal(enabled: boolean, accelerator = DEFAULT_REVEAL_SHORTCUT, globalMode = false) {
  const [keyboardHeld, setKeyboardHeld] = useState(false);
  const [pointerHeld, setPointerHeld] = useState(false);
  const [globalHeld, setGlobalHeld] = useState(false);
  useEffect(() => {
    setGlobalHeld(false);
    if (!enabled || !globalMode) return;
    return window.mc.onRevealHeld(setGlobalHeld);
  }, [enabled, globalMode]);

  useEffect(() => {
    const reset = () => {
      setKeyboardHeld(false);
      setPointerHeld(false);
    };
    reset();
    if (!enabled || globalMode) return;
    return bindRevealShortcut(window, document, setKeyboardHeld, reset, accelerator, window.mc.platform === 'darwin');
  }, [enabled, accelerator, globalMode]);

  return { revealing: enabled && (keyboardHeld || pointerHeld || (globalMode && globalHeld)), setPointerHeld };
}
