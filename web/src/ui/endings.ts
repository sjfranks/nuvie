/**
 * endings.ts - the endings' pictures, a still for each page of words: the pieces the games' ending.lua scripts lay out
 * (each picture placed by its hot spot), on the 320 by 200 screen in the ending's own palette.
 */
import { loadImages, loadPalette, shapeRgba } from '../files/cutscene.ts';
import type { GameFiles } from '../files/gamefiles.ts';

/** [group, picture, x, y]; `g` in a picture number is 1 for a man, 2 for a woman. */
type Layer = [number, number | 'g', number, number];

const SCENES: Record<'u6' | 'md' | 'se', { images: string; palette: [string, number]; pages: Layer[][] }> = {
  u6: {
    images: 'end.shp',
    palette: ['endpal.lbm', 0],
    pages: [
      [[7, 0, 0, 0]], [[7, 0, 0, 0]], [[7, 0, 0, 0]], [[7, 0, 0, 0]], [[7, 0, 0, 0], [2, 0, 140, 40]], [[7, 0, 0, 0]],
      [[8, 0, 0, 0]], [[8, 0, 0, 0]], [[9, 0, 0, 0]], [[9, 0, 0, 0]], [[9, 0, 0, 0]],
    ],
  },
  md: {
    images: 'endgame.lzc',
    palette: ['md_title.pal', 0],
    pages: [
      [[0, 0, 0, 24], [0, 'g', 155, 151]], [[0, 0, 0, 24], [0, 'g', 155, 151]],
      [[1, 0, 0, 24], [1, 1, 105, 112]],
      [[2, 0, 0, 24], [2, 1, 170, 150]], [[2, 0, 0, 24], [2, 1, 170, 150]],
      [[3, 0, 0, 24], [3, 'g', 190, 151]],
      [[4, 0, 0, 24], [4, 'g', 195, 151], [4, 3, 75, 151]], [[4, 5, 0, 24]],
      [[5, 0, 0, 24], [8, 0, 0, 140], [7, 4, 240, 140]], [[5, 0, 0, 24], [7, 4, 240, 140]],
    ],
  },
  se: {
    images: 'endgame.lzc',
    palette: ['savage.pal', 1],
    pages: [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4, 1].map((k): Layer[] => [[0, k, 0, 0]]),
  },
};

/** A still from any of a game's image libraries: layers of [picture (or group, picture), x, y] by their hot spots. */
export function stillPicture(files: GameFiles, images: string, palette: [string, number], layers: number[][]): HTMLCanvasElement | null {
  const all = loadImages(files, images);
  const pal = loadPalette(files, palette[0], palette[1]);
  if (!all.length || !pal) return null;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 200;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 320, 200);
  for (const layer of layers) {
    // [picture, x, y] from a library of single pictures, or [group, picture, x, y].
    const [grp, pic, x, y] = layer.length === 4 ? layer : [layer[0], 0, layer[1], layer[2]];
    const s = all[grp]?.[pic];
    if (!s) continue;
    const tmp = document.createElement('canvas');
    tmp.width = s.w;
    tmp.height = s.h;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(shapeRgba(s, pal)), s.w, s.h), 0, 0);
    ctx.drawImage(tmp, x - (s.hx ?? 0), y - (s.hy ?? 0));
  }
  return c;
}

/** The picture for an ending's page, or null where the files lack it. */
export function endingPicture(files: GameFiles, kind: 'u6' | 'md' | 'se', page: number, female: boolean): HTMLCanvasElement | null {
  const scene = SCENES[kind];
  const layers = scene.pages[Math.min(page, scene.pages.length - 1)];
  const images = loadImages(files, scene.images);
  const pal = loadPalette(files, scene.palette[0], scene.palette[1]);
  if (!images.length || !pal) return null;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 200;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 320, 200);
  let drawn = false;
  for (const [grp, pic, x, y] of layers) {
    const s = images[grp]?.[pic === 'g' ? (female ? 2 : 1) : pic];
    if (!s) continue;
    const img = new ImageData(new Uint8ClampedArray(shapeRgba(s, pal)), s.w, s.h);
    const tmp = document.createElement('canvas');
    tmp.width = s.w;
    tmp.height = s.h;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(tmp, x - (s.hx ?? 0), y - (s.hy ?? 0));
    drawn = true;
  }
  return drawn ? c : null;
}
