import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { ExportSink } from './export.types';

/**
 * {@link ExportSink} that writes an export as a browsable directory tree (the
 * CLI's `--out <dir>`). Parent directories (e.g. `memories/`) are created on
 * demand. Relative paths use `/` separators; they are resolved under `root` and
 * rejected if they escape it.
 */
export class DirectorySink implements ExportSink {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const target = resolve(this.root, relativePath);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Refusing to write outside export root: ${relativePath}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}
