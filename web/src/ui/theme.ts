/**
 * theme.ts - the look of everything round the map, taken at run time from the player's own copy of the game so that
 * it reads as the game does: its typeface (u6.ch, eight pixels square, made into a font the page can set text in),
 * its parchment with the burnt edge (paper.bmp, cut into a frame for panes and buttons), and its colours (the
 * scroll's cream, the dark red it writes in, the red of a keyword). None of it is in this repository: without the
 * files - the demo world - the page falls back to plain colours and the device's monospace.
 */
import opentype from 'opentype.js';
import type { GameFiles } from '../files/gamefiles.ts';
import { Lib } from '../files/lib.ts';
import { lzwFile } from '../files/lzw.ts';

const FAMILY = 'NuvieGame';
/** The scroll's ground, its text and its keywords in the game's palette. */
const PAL_BG = 0x31;
const PAL_TEXT = 0x48;
const PAL_KEY = 0x0c;

/** The game's letters as a font: each lit pixel a square of the glyph's outline. */
async function installFont(ch: Uint8Array, wou: boolean): Promise<boolean> {
  const U = 100;
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 8 * U, path: new opentype.Path() })];
  // Curly quotes are drawn with the game's own: Martian Dreams and Savage Empire have an opening " and a closing &.
  const codes: [number, number][] = [];
  for (let c = 32; c < 127; c++) codes.push([c, c]);
  codes.push([0x201c, 34], [0x201d, wou ? 38 : 34]);
  for (const [unicode, c] of codes) {
    const path = new opentype.Path();
    for (let row = 0; row < 8; row++) {
      const bits = ch[c * 8 + row] ?? 0;
      for (let x = 0; x < 8; x++) {
        if (!(bits & (0x80 >> x))) continue;
        let x1 = x;
        while (x1 < 8 && bits & (0x80 >> x1)) x1++;
        // The baseline lies under the seventh row.
        const top = (7 - row) * U;
        const bottom = (6 - row) * U;
        path.moveTo(x * U, bottom);
        path.lineTo(x * U, top);
        path.lineTo(x1 * U, top);
        path.lineTo(x1 * U, bottom);
        path.close();
        x = x1;
      }
    }
    glyphs.push(new opentype.Glyph({ name: `u${unicode.toString(16)}`, unicode, advanceWidth: 8 * U, path }));
  }
  const font = new opentype.Font({ familyName: FAMILY, styleName: 'Regular', unitsPerEm: 8 * U, ascender: 7 * U, descender: -U, glyphs });
  const face = new FontFace(FAMILY, font.toArrayBuffer());
  await face.load();
  document.fonts.add(face);
  return true;
}

/**
 * A frame cut from the parchment picture (320 by 200): its burnt corners and edges, ten pixels deep, round a plain
 * middle - a 100-pixel square whose slices a CSS border-image lays round any box, drawn at twice the size.
 */
function frameUrl(paper: Uint8Array, rgb: (i: number) => [number, number, number], bg: number): string | null {
  const raw = lzwFile(paper);
  const w = raw[0] | (raw[1] << 8);
  const h = raw[2] | (raw[3] << 8);
  if (w !== 320 || h !== 200 || raw.length < 4 + w * h) return null;
  const N = 100;
  const E = 10;
  const at = (x: number, y: number): number => raw[4 + y * w + x];
  const out = new Uint8Array(N * N).fill(bg);
  const copy = (sx: number, sy: number, dx: number, dy: number, cw: number, chh: number, flipX = false): void => {
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) out[(dy + y) * N + dx + x] = at(sx + (flipX ? cw - 1 - x : x), sy + y);
  };
  copy(0, 0, 0, 0, E, E); // corners
  copy(w - E, 0, N - E, 0, E, E);
  copy(0, h - E, 0, N - E, E, E);
  copy(0, h - E, N - E, N - E, E, E, true); // the picture's own is under a window: the other bottom corner, turned
  copy(30, 0, E, 0, N - 2 * E, E); // edges
  copy(30, h - E, E, N - E, N - 2 * E, E);
  for (let y = 0; y < N - 2 * E; y++) for (let x = 0; x < E; x++) {
    out[(E + y) * N + x] = at(x, 30 + y);
    out[(E + y) * N + N - E + x] = at(w - E + x, 10 + y);
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const px = new Uint32Array(img.data.buffer);
  for (let i = 0; i < N * N; i++) {
    const [r, g, b] = rgb(out[i]);
    // The black beyond the burn is where what lies under the paper shows through.
    px[i] = out[i] === 0 ? 0 : 0xff000000 | (b << 16) | (g << 8) | r;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Whether the game's own command icons (tiles 400 to 409) are there to put on the buttons. */
export let haveIcons = false;

export async function installTheme(files: GameFiles): Promise<void> {
  const root = document.documentElement;
  root.classList.remove('game-font', 'game-paper');
  haveIcons = files.has('u6.ch') && files.has('paper.bmp');
  for (const v of ['--paper', '--parch', '--ink', '--key']) root.style.removeProperty(v);
  const pal = files.get('u6pal') ?? files.get('mdpal') ?? files.get('sepal');
  const rgb = (i: number): [number, number, number] => (pal ? [Math.min(255, pal[i * 3] << 2), Math.min(255, pal[i * 3 + 1] << 2), Math.min(255, pal[i * 3 + 2] << 2)] : [0, 0, 0]);
  const css = (i: number): string => `rgb(${rgb(i).join(',')})`;
  try {
    // Ultima 6's letters, or the system font the other two keep in system.lzc (FontManager::initWOUSystemFont).
    const u6 = files.get('u6.ch');
    const ch = u6 ?? (files.has('system.lzc') ? new Lib(files.get('system.lzc')!, 4, true).item(3) ?? undefined : undefined);
    if (ch && ch.length >= 127 * 8 && (await installFont(ch, !u6))) root.classList.add('game-font');
  } catch {
    // The device's own letters will do.
  }
  try {
    const paper = files.get('paper.bmp');
    const url = paper && pal ? frameUrl(paper, rgb, PAL_BG) : null;
    if (url) {
      root.style.setProperty('--paper', `url(${url})`);
      root.style.setProperty('--parch', css(PAL_BG));
      root.style.setProperty('--ink', css(PAL_TEXT));
      root.style.setProperty('--key', css(PAL_KEY));
      root.classList.add('game-paper');
    }
  } catch {
    // Plain colours will do.
  }
}
