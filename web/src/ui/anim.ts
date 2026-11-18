/**
 * anim.ts - cutscenes in motion, as ScriptCutscene.cpp plays them: sprites (a picture placed by its hot spot, perhaps
 * scaled, clipped or see-through) drawn a frame at a time onto a 320 by 200 screen in the scene's palette, which may
 * turn (canvas_rotate_palette). A frame lasts as long as the script's poll_for_key_or_button waits: a cycle of the
 * canvas's update interval more than it asks for.
 */
import { loadImages, loadPalette } from '../files/cutscene.ts';
import type { GameFiles } from '../files/gamefiles.ts';
import type { Shape } from '../files/shape.ts';

export interface Sprite {
  /** Which library (by file name), group and picture; or a picture made on the spot. */
  lib?: string;
  grp?: number;
  pic?: number;
  shape?: Shape;
  x: number;
  y: number;
  /** Percent, as image.scale. */
  scale?: number;
  /** create_sprite's clip: the band of the screen between y 24 and 152. */
  clip?: boolean;
  /** A clip of its own: x, y, width, height. */
  clipRect?: [number, number, number, number];
  /** 0 to 1. */
  opacity?: number;
  /** image_set_transparency_colour(0): colour 0 is see-through too. */
  key0?: boolean;
}

export interface Frame {
  sprites: Sprite[];
  /** How long this frame shows, in milliseconds. */
  ms: number;
  /** canvas_set_opacity, 0 to 1. */
  opacity?: number;
  /** The palette turned this many times: [first colour, how many, turns]. */
  rot?: [number, number, number];
}

/** A scene: its frames, made on demand in order, and how many (Infinity for one that goes on); after the last it holds, or begins again. */
export interface Scene {
  frames: number;
  frame: (i: number) => Frame;
  loop?: boolean;
}

/** A scene of frames made beforehand. */
export const of = (frames: Frame[], loop = false): Scene => ({ frames: frames.length, frame: (i) => frames[i], loop });

/** A scene from a generator of frames; it holds on the last frame if the generator ends. */
export function fromGen(gen: Generator<Frame>): Scene {
  let last: Frame = { sprites: [], ms: 25 };
  return {
    frames: Infinity,
    frame: () => {
      const n = gen.next();
      if (!n.done) last = n.value;
      return n.done ? { ...last, ms: 1e9 } : last;
    },
  };
}

/** Play a scene on a new canvas; stop() ends it (the canvas keeps its last frame). Null where the files lack it. */
export function play(files: GameFiles, palette: [string, number], scene: Scene): { canvas: HTMLCanvasElement; stop: () => void } | null {
  const base = loadPalette(files, palette[0], palette[1]);
  if (!base) return null;
  const libs = new Map<string, Shape[][]>();
  const shapeOf = (sp: Sprite): Shape | undefined => {
    if (sp.shape) return sp.shape;
    let l = libs.get(sp.lib!);
    if (!l) libs.set(sp.lib!, (l = loadImages(files, sp.lib!)));
    return l[sp.grp ?? 0]?.[sp.pic ?? 0];
  };
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(320, 200);
  const px = img.data;
  const pal = new Uint8Array(base);
  const draw = (f: Frame): void => {
    pal.set(base);
    if (f.rot) {
      const [at, n, turns] = f.rot;
      for (let c = 0; c < n; c++) {
        const from = at + ((((c - turns) % n) + n) % n);
        for (let k = 0; k < 3; k++) pal[(at + c) * 3 + k] = base[from * 3 + k];
      }
    }
    px.fill(0);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    for (const sp of f.sprites) {
      const s = shapeOf(sp);
      if (!s) continue;
      const k = (sp.scale ?? 100) / 100;
      const w = Math.max(1, Math.round(s.w * k));
      const h = Math.max(1, Math.round(s.h * k));
      const ox = Math.round(sp.x - (s.hx ?? 0) * k);
      const oy = Math.round(sp.y - (s.hy ?? 0) * k);
      let [cx, cy, cw, ch] = sp.clipRect ?? (sp.clip ? [0, 24, 320, 128] : [0, 0, 320, 200]);
      cw = Math.min(320, cx + cw);
      ch = Math.min(200, cy + ch);
      const a = sp.opacity ?? 1;
      if (a <= 0) continue;
      for (let y = Math.max(oy, cy, 0); y < Math.min(oy + h, ch); y++) {
        const sy = Math.floor((y - oy) / k);
        for (let x = Math.max(ox, cx, 0); x < Math.min(ox + w, cw); x++) {
          const c = s.data[sy * s.w + Math.floor((x - ox) / k)];
          if (c === 0xff || (c === 0 && sp.key0)) continue;
          const o = (y * 320 + x) * 4;
          if (a >= 1) {
            px[o] = pal[c * 3];
            px[o + 1] = pal[c * 3 + 1];
            px[o + 2] = pal[c * 3 + 2];
          } else {
            px[o] += (pal[c * 3] - px[o]) * a;
            px[o + 1] += (pal[c * 3 + 1] - px[o + 1]) * a;
            px[o + 2] += (pal[c * 3 + 2] - px[o + 2]) * a;
          }
        }
      }
    }
    const o = f.opacity ?? 1;
    if (o < 1) for (let i = 0; i < px.length; i += 4) {
      px[i] *= o;
      px[i + 1] *= o;
      px[i + 2] *= o;
    }
    ctx.putImageData(img, 0, 0);
  };
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const step = (): void => {
    const f = scene.frame(i);
    draw(f);
    i++;
    if (i >= scene.frames) {
      if (!scene.loop) return;
      i = 0;
    }
    if (f.ms < 1e9) timer = setTimeout(step, f.ms);
  };
  step();
  return {
    canvas,
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** How long poll_for_key_or_button(n) waits at an update interval. */
export const poll = (n: number, interval = 25): number => (n + 1) * interval;

/** fade_in(speed): frames of rising opacity, a canvas update each, at an update interval. */
export function fadeFrames(speed: number, sprites: Sprite[], interval = 25, out = false): Frame[] {
  const f: Frame[] = [];
  for (let i = 0; i <= 0xff; i += speed) f.push({ sprites, ms: interval, opacity: (out ? 0xff - i : i) / 0xff });
  return f;
}

/** image_new_starfield and its update (CSStarFieldImage): stars streaming out from the middle along lines to the edges. */
export function starField(w: number, h: number): () => Shape {
  const data = new Uint8Array(w * h);
  const stars: { pts: [number, number][]; at: number; color: number }[] = [];
  const rand = (n: number): number => Math.floor(Math.random() * n);
  const line = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
    const pts: [number, number][] = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let x = x0, y = y0; ; ) {
      pts.push([x, y]);
      if (x === x1 && y === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return pts;
  };
  const NUM = 70;
  return () => {
    data.fill(0);
    for (let i = 0; i < NUM; i++) {
      const s = stars[i];
      if (!s || s.at >= s.pts.length) {
        const cx = w >> 1;
        const cy = h >> 1;
        const [ex, ey] = [[0, rand(h)], [w - 1, rand(h)], [rand(w), 0], [rand(w), h - 1]][rand(4)];
        stars[i] = { pts: line(cx, cy, ex, ey), at: rand(w >> 1), color: rand(10) + 229 };
        continue;
      }
      const [x, y] = s.pts[s.at++];
      data[y * w + x] = s.color;
    }
    return { w, h, data };
  };
}
