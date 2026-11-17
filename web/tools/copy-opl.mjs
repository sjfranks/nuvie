// Copies the OPL emulator's two files (the music's synthesiser) to public/opl, where the browser loads them from.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const from = new URL('../node_modules/@malvineous/opl/lib/', import.meta.url);
const to = new URL('../public/opl/', import.meta.url);
if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  for (const f of ['opl.js', 'opl.wasm']) copyFileSync(new URL(f, from), new URL(f, to));
}
