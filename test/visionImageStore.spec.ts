import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VisionImageStore } from '../electron/visionImageStore';

let dir: string;
let store: VisionImageStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-vision-images-'));
  store = new VisionImageStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('VisionImageStore', () => {
  it('round-trips a PNG data URL by safe image id', () => {
    const dataUrl = 'data:image/png;base64,AQIDBA==';
    store.saveDataUrl('shot-1', dataUrl);
    expect(store.loadDataUrl('shot-1')).toBe(dataUrl);
  });

  it('removes only images no longer referenced by sessions', () => {
    store.saveDataUrl('keep', 'data:image/png;base64,AQ==');
    store.saveDataUrl('drop', 'data:image/png;base64,Ag==');
    store.reconcile(new Set(['keep']));
    expect(existsSync(join(dir, 'keep.png'))).toBe(true);
    expect(existsSync(join(dir, 'drop.png'))).toBe(false);
  });

  it('rejects path traversal ids and non-PNG payloads', () => {
    expect(() => store.saveDataUrl('../outside', 'data:image/png;base64,AQ==')).toThrow();
    expect(() => store.saveDataUrl('shot-1', 'data:image/jpeg;base64,AQ==')).toThrow();
  });
});
