export interface OutputSize { height: number }
export interface OutputBounds extends OutputSize { x: number; y: number; width: number }

export function isOutputSize(value: unknown): value is OutputSize {
  if (!value || typeof value !== 'object') return false;
  const size = value as OutputSize;
  return Number.isFinite(size.height) && size.height > 0;
}

/** Keep a fixed anchor where possible; constrain output to the current monitor. */
export function fitOutputBounds(current: OutputBounds, wanted: OutputSize, work: OutputBounds): OutputBounds {
  const height = Math.round(Math.min(work.height, Math.max(72, wanted.height)));
  return {
    x: current.x,
    y: Math.round(Math.max(work.y, Math.min(current.y, work.y + work.height - height))),
    width: current.width, height,
  };
}
