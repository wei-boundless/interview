import { describe, expect, it } from 'vitest';
import {
  captureKindForPlatform,
  defaultHotkeysForPlatform,
  whisperExecutionProvidersForPlatform,
} from '../shared/platform';

describe('platform defaults', () => {
  it('uses familiar Command shortcuts on macOS without changing Windows defaults', () => {
    expect(defaultHotkeysForPlatform('darwin')).toEqual({
      toggle: 'Command+B',
      shot: 'Command+Shift+S',
      fullShot: 'Command+Option+S',
      visionBatch: '',
      visionPrev: 'Command+Option+PageUp',
      visionNext: 'Command+Option+PageDown',
      visionClear: 'Command+Option+Home',
      answerScrollUp: '',
      answerScrollDown: '',
    });
    expect(defaultHotkeysForPlatform('win32')).toEqual({
      toggle: 'Control+B',
      shot: 'Control+Shift+S',
      fullShot: 'Control+Alt+S',
      visionBatch: '',
      visionPrev: 'Control+Alt+PageUp',
      visionNext: 'Control+Alt+PageDown',
      visionClear: 'Control+Alt+Home',
      answerScrollUp: '',
      answerScrollDown: '',
    });
  });

  it('uses Electron loopback only on Windows', () => {
    expect(captureKindForPlatform('win32')).toBe('loopback');
    expect(captureKindForPlatform('darwin')).toBe('input');
    expect(captureKindForPlatform('linux')).toBe('input');
  });

  it('never attempts the Windows DirectML provider on macOS', () => {
    expect(whisperExecutionProvidersForPlatform('win32')).toEqual(['dml', 'cpu']);
    expect(whisperExecutionProvidersForPlatform('darwin')).toEqual(['cpu']);
  });
});
