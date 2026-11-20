/**
 * acknowledgements.ts - Ultima VI's Acknowledgements, as intro.lua shows them from its menu: four pages of who made the
 * game, written on the vellum scroll (vellum1.shp) in the game's own letters and colours.
 */
import { loadImages, loadPalette, shapeRgba } from '../files/cutscene.ts';
import type { GameFiles } from '../files/gamefiles.ts';

/** [text, x, y, colour] as image_print lays them on the scroll. */
type Line = [string, number, number, number];

const HEADER: Line[] = [['Ultima VI', 115, 9, 0x3d], ['A Lord British Production', 63, 17, 0x3d]];

export const ACK_PAGES: Line[][] = [
  [
    ['Produced by', 106, 32, 0xc], ['Richard Garriott and Warren Spector', 28, 40, 0x48],
    ['Executive Producer', 82, 56, 0xc], ['Dallas Snell', 106, 64, 0x48],
    ['Programming', 104, 80, 0xc], ['Cheryl Chen    John Miles', 67, 88, 0x48], ['Herman Miller    Gary Scott Smith', 40, 96, 0x48],
  ],
  [
    ['Writing', 120, 47, 0xc], ["Stephen Beeman    Dr. Cat    'Manda Dee", 25, 55, 0x48], ['Richard Garriott    Greg Malone', 46, 63, 0x48],
    ['John Miles    Herman Miller', 61, 71, 0x48], ['Todd Porter    Warren Spector', 50, 79, 0x48],
  ],
  [
    ['Art', 132, 31, 0xc], ['Keith Berdak    Daniel Bourbonnais', 37, 39, 0x48], ["Jeff Dee    'Manda Dee", 75, 47, 0x48],
    ['Glen Johnson    Denis Loubet', 56, 55, 0x48],
    ['Music', 126, 71, 0xc], ['Ken Arnold    Iolo Fitzowen', 61, 79, 0x48], ['Herman Miller    Todd Porter', 56, 87, 0x48],
  ],
  [
    ['Quality Assurance', 87, 31, 0xc], ['Paul Malone    Mike Romero', 62, 39, 0x48],
    ['Additional Support', 84, 63, 0xc], ['Michelle Caddel    Melanie Fleming', 39, 71, 0x48], ['Alan Gardner    Jeff Hillhouse', 51, 79, 0x48],
    ['Sherry Hunter    Steve Muchow', 49, 87, 0x48], ['Cheryl Neeld', 104, 95, 0x48],
  ],
];

/** A page of the Acknowledgements on the scroll, or null where the files lack it. */
export function ackPicture(files: GameFiles, page: number): HTMLCanvasElement | null {
  const shape = loadImages(files, 'vellum1.shp')[0]?.[0];
  const pal = loadPalette(files, 'palettes.int', 0);
  if (!shape || !pal) return null;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 200;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 320, 200);
  const tmp = document.createElement('canvas');
  tmp.width = shape.w;
  tmp.height = shape.h;
  tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(shapeRgba(shape, pal)), shape.w, shape.h), 0, 0);
  // The scroll where intro.lua puts it, the words on it.
  const ox = 0x10;
  const oy = Math.max(0, Math.min(0x50, 200 - shape.h));
  ctx.drawImage(tmp, ox, oy);
  ctx.font = '8px NuvieGame, monospace';
  ctx.textBaseline = 'top';
  const colour = (i: number): string => `rgb(${pal[i * 3]},${pal[i * 3 + 1]},${pal[i * 3 + 2]})`;
  // Each line centred on the scroll, as the original lays them, and narrowed where these letters run wider.
  const mid = ox + shape.w / 2;
  const room = shape.w - 24;
  ctx.textAlign = 'center';
  for (const [text, , y, col] of [...HEADER, ...ACK_PAGES[page]]) {
    ctx.fillStyle = colour(col);
    const w = ctx.measureText(text).width;
    ctx.save();
    ctx.translate(mid, oy + y);
    if (w > room) ctx.scale(room / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  ctx.fillStyle = colour(0x3d);
  ctx.fillRect(ox + 9, oy + 26, 266, 1);
  return c;
}
