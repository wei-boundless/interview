/** Pointer routing only. Never changes window visibility or capture protection. */
export function shouldIgnoreOverlayPointer(state: {
  stealthHidden: boolean;
  textOnly: boolean;
  interactive: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  cursor: { x: number; y: number };
}): boolean {
  if (state.stealthHidden) return true;
  if (!state.textOnly || state.interactive) return false;
  const { bounds, cursor } = state;
  const overHandle = cursor.x >= bounds.x && cursor.x < bounds.x + Math.min(64, bounds.width) &&
    cursor.y >= bounds.y && cursor.y < bounds.y + Math.min(32, bounds.height);
  return !overHandle;
}
