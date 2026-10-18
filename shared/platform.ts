export type CaptureKind = 'loopback' | 'input';

/** Electron's display-media loopback token is currently Windows-only. */
export function captureKindForPlatform(platform: string): CaptureKind {
  return platform === 'win32' ? 'loopback' : 'input';
}

/** Defaults apply only to newly created settings; saved user choices win. */
export function defaultHotkeysForPlatform(platform: string): {
  toggle: string;
  shot: string;
  fullShot: string;
  visionBatch: string;
  visionPrev: string;
  visionNext: string;
  visionClear: string;
  answerScrollUp: string;
  answerScrollDown: string;
} {
  if (platform === 'darwin') {
    return {
      toggle: 'Command+B',
      shot: 'Command+Shift+S',
      fullShot: 'Command+Option+S',
      visionBatch: '',
      visionPrev: 'Command+Option+PageUp',
      visionNext: 'Command+Option+PageDown',
      visionClear: 'Command+Option+Home',
      answerScrollUp: '',
      answerScrollDown: '',
    };
  }
  return {
    toggle: 'Control+B',
    shot: 'Control+Shift+S',
    fullShot: 'Control+Alt+S',
    visionBatch: '',
    visionPrev: 'Control+Alt+PageUp',
    visionNext: 'Control+Alt+PageDown',
    visionClear: 'Control+Alt+Home',
    answerScrollUp: '',
    answerScrollDown: '',
  };
}

export function whisperExecutionProvidersForPlatform(
  platform: string,
): ('dml' | 'cpu')[] {
  return platform === 'win32' ? ['dml', 'cpu'] : ['cpu'];
}
