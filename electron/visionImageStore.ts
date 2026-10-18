import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/;

export class VisionImageStore {
  constructor(private readonly dir: string) {}

  private pathFor(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error('invalid vision image id');
    return join(this.dir, `${id}.png`);
  }

  saveDataUrl(id: string, dataUrl: string): void {
    const match = PNG_DATA_URL.exec(dataUrl);
    if (!match) throw new Error('unsupported screenshot image format');
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.pathFor(id), Buffer.from(match[1], 'base64'));
  }

  loadDataUrl(id: string): string {
    const path = this.pathFor(id);
    if (!existsSync(path)) throw new Error('original screenshot is unavailable');
    return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  }

  remove(id: string): void {
    const path = this.pathFor(id);
    if (existsSync(path)) unlinkSync(path);
  }

  reconcile(keepIds: ReadonlySet<string>): void {
    if (!existsSync(this.dir)) return;
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.png')) continue;
      const id = name.slice(0, -4);
      if (SAFE_ID.test(id) && !keepIds.has(id)) unlinkSync(join(this.dir, name));
    }
  }
}
