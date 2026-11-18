/**
 * mapview.ts - the view of the world: the ground, then what lies on it, then everyone, then what stands over them,
 * with what the party cannot see from where it stands left black (Nuvie's MapWindow.cpp). Drawn as palette indices at
 * the game's own 16 pixels a square, and turned to colour through a palette that cycles (fires, water, magic).
 */
import type { Game } from '../game/game.ts';
import { mapWidth, wrap } from '../game/map.ts';
import { STATUS_INVISIBLE, type Obj } from '../game/objects.ts';
import { F1_WALL, F1_WALL_EAST, F1_WALL_MASK, F1_WALL_NORTH, F1_WALL_SOUTH, F1_WALL_WEST, F2_BOUNDARY, F2_WINDOW, type Tile } from '../game/tiles.ts';
import { OBJ } from '../game/u6tables.ts';

const BORDER = 3;

/** A mark over a square: the way a tap will take, or a square being chosen. */
export interface Mark {
  x: number;
  y: number;
  color: string;
  kind: 'dot' | 'box';
}

export class MapView {
  cols = 11;
  rows = 11;
  /** The top left square shown. */
  curX = 0;
  curY = 0;
  marks: Mark[] = [];
  private tmp = new Uint16Array(0);
  private tw = 0;
  private th = 0;
  private buf = new Uint8Array(0);
  private image: ImageData | null = null;
  /** The game's palette, 8 bits each of red, green and blue. */
  readonly palette = new Uint8Array(768);
  private readonly pal32 = new Uint32Array(256);
  private rotCounter = 0;
  private readonly ctx: CanvasRenderingContext2D;
  /** Night and the dark underground, drawn over the map: smooth, not in the map's own pixels. */
  readonly light = document.createElement('canvas');
  /** Pixels of the light canvas to a square. */
  private static readonly LP = 48;

  constructor(
    readonly game: Game,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const pal = game.files.get(game.paletteFile);
    if (pal) for (let i = 0; i < 768; i++) this.palette[i] = Math.min(255, (pal[i] << 2) | (pal[i] >> 4));
    this.buildPal();
    this.resize(11, 11);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.tw = cols + BORDER * 2;
    this.th = rows + BORDER * 2;
    this.tmp = new Uint16Array(this.tw * this.th);
    this.buf = new Uint8Array(cols * 16 * rows * 16);
    this.canvas.width = cols * 16;
    this.canvas.height = rows * 16;
    this.image = this.ctx.createImageData(cols * 16, rows * 16);
    this.light.width = cols * MapView.LP;
    this.light.height = rows * MapView.LP;
  }

  private buildPal(): void {
    const p = this.palette;
    for (let i = 0; i < 256; i++) this.pal32[i] = 0xff000000 | (p[i * 3 + 2] << 16) | (p[i * 3 + 1] << 8) | p[i * 3];
  }

  private rotate(first: number, n: number): void {
    const p = this.palette;
    const last = p.slice((first + n - 1) * 3, (first + n) * 3);
    p.copyWithin((first + 1) * 3, first * 3, (first + n - 1) * 3);
    p.set(last, first * 3);
  }

  /** One step of the animation: tiles that move, and the colours that cycle. */
  tick(): void {
    this.game.tiles.update(this.game.clock.hour);
    this.rotate(0xe0, 8);
    this.rotate(0xe8, 8);
    if (this.rotCounter === 0) {
      this.rotate(0xf0, 4);
      this.rotate(0xf4, 4);
      this.rotate(0xf8, 4);
    }
    this.rotCounter ^= 1;
    this.buildPal();
  }

  /** The palette's colour for an index, as CSS. */
  css(i: number): string {
    return `rgb(${this.palette[i * 3]},${this.palette[i * 3 + 1]},${this.palette[i * 3 + 2]})`;
  }

  /** Whether a square of the view is in sight. */
  visible(mx: number, my: number): boolean {
    const z = this.game.player.z;
    const vx = wrap(mx - this.curX, z);
    const vy = wrap(my - this.curY, z);
    if (vx >= this.cols || vy >= this.rows) return false;
    return this.tmp[(vy + BORDER) * this.tw + vx + BORDER] !== 0;
  }

  // ---- what is in sight ----

  private fill(sx: number, sy: number): void {
    const g = this.game;
    const z = g.player.z;
    const data = g.map.data(z);
    const pitch = mapWidth(z);
    const px = wrap(this.curX - BORDER, z);
    const py = wrap(this.curY - BORDER, z);
    const stack: number[] = [sx, sy];
    while (stack.length) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      const tx = wrap(x - px, z);
      const ty = wrap(y - py, z);
      if (tx >= this.tw || ty >= this.th) continue;
      const i = ty * this.tw + tx;
      if (this.tmp[i] !== 0) continue;
      const cur = data[y * pitch + x];
      // Tile 0 would read as unseen; it is never ground worth the distinction.
      this.tmp[i] = cur === 0 ? 0x8000 : cur;
      if (g.map.isBoundary(x, y, z) && !this.throughWindow(cur, x, y)) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) stack.push(wrap(x + dx, z), wrap(y + dy, z));
    }
  }

  /** Standing right at a window, the party sees through it. */
  private throughWindow(tileNum: number, x: number, y: number): boolean {
    const g = this.game;
    const z = g.player.z;
    if (!(g.tiles.get(tileNum).flags2 & F2_WINDOW)) {
      const l = g.objects.list(x, y, z);
      const o = l?.[l.length - 1];
      if (!o || !(g.tiles.get(g.objects.tileNum(o)).flags2 & F2_WINDOW)) return false;
    }
    const p = g.player;
    if (p.x === x && (p.y === wrap(y - 1, z) || p.y === wrap(y + 1, z))) return true;
    return p.y === y && (p.x === wrap(x - 1, z) || p.x === wrap(x + 1, z));
  }

  private tmpTile(x: number, y: number): number {
    return this.tmp[y * this.tw + x] & 0x7fff;
  }
  private black(x: number, y: number): boolean {
    return this.tmp[y * this.tw + x] === 0;
  }

  private isWall(x: number, y: number, mask: number): boolean {
    if (this.black(x, y)) return false;
    const g = this.game;
    const z = g.player.z;
    const t = g.tiles.get(this.tmpTile(x, y));
    if (t.flags1 & F1_WALL && t.flags1 & mask) return true;
    const ot = g.objects.tileAt(wrap(this.curX - BORDER + x, z), wrap(this.curY - BORDER + y, z), z, false);
    return !!ot && !!(ot.flags2 & F2_BOUNDARY) && !!(ot.flags1 & mask);
  }

  /** Walls at the edge of what is seen are redrawn so they end cleanly against the dark. */
  private reshape(): void {
    const g = this.game;
    const z = g.player.z;
    for (let y = 1; y < this.th - 1; y++) {
      for (let x = 1; x < this.tw - 1; x++) {
        if (this.black(x, y)) continue;
        let tile = g.tiles.get(this.tmpTile(x, y));
        if (tile.num < 140 || tile.num > 187) continue;
        if (!tile.boundary && !g.objects.isBoundary(wrap(this.curX - BORDER + x, z), wrap(this.curY - BORDER + y, z), z)) continue;
        const orig = tile.flags1 & F1_WALL_MASK;
        let flag = 0;
        if (this.isWall(x, y - 1, F1_WALL_SOUTH)) flag |= F1_WALL_NORTH;
        if (this.isWall(x + 1, y, F1_WALL_WEST)) flag |= F1_WALL_EAST;
        if (this.isWall(x, y + 1, F1_WALL_NORTH)) flag |= F1_WALL_SOUTH;
        if (this.isWall(x - 1, y, F1_WALL_EAST)) flag |= F1_WALL_WEST;
        if (!this.black(x, y - 1) && orig & F1_WALL_NORTH) flag |= F1_WALL_NORTH;
        if (!this.black(x + 1, y) && orig & F1_WALL_EAST) flag |= F1_WALL_EAST;
        if (!this.black(x, y + 1) && orig & F1_WALL_SOUTH) flag |= F1_WALL_SOUTH;
        if (!this.black(x - 1, y) && orig & F1_WALL_WEST) flag |= F1_WALL_WEST;
        if (flag === 0) continue;
        const set = (n: number): void => void (this.tmp[y * this.tw + x] = n);
        const corner = 266 + 2 * ((tile.num - (tile.num % 16) - 140) >> 4);
        if (flag === 48 && this.black(x, y - 1) && this.black(x + 1, y)) {
          set(corner);
          continue;
        }
        if (flag === 192 && this.black(x, y + 1) && this.black(x - 1, y)) {
          set(corner + 1);
          continue;
        }
        if (orig === flag) continue;
        const step = orig > flag && flag !== 144 ? -1 : 1;
        for (let n = 0; n < 16 && (tile.flags1 & F1_WALL_MASK) !== flag && tile.flags1 & F1_WALL_MASK; n++) tile = g.tiles.get(tile.num + step);
        if ((tile.flags1 & F1_WALL_MASK) === flag) set(tile.num);
      }
    }
  }

  private updateSight(): void {
    const g = this.game;
    const p = g.player;
    const z = p.z;
    this.curX = wrap(p.x - (this.cols >> 1), z);
    this.curY = wrap(p.y - (this.rows >> 1), z);
    this.tmp.fill(0);
    // X-ray: everything near is seen, walls or no.
    if (performance.now() < g.xrayUntil) {
      for (let ty = 0; ty < this.th; ty++) {
        for (let tx = 0; tx < this.tw; tx++) {
          const n = g.map.tileNum(this.curX - BORDER + tx, this.curY - BORDER + ty, z);
          this.tmp[ty * this.tw + tx] = n === 0 ? 0x8000 : n;
        }
      }
      return;
    }
    let x = p.x;
    let y = p.y;
    // Standing in a doorway, look from the square beyond it.
    if (g.objects.isBoundary(x, y, z)) {
      const t = g.objects.tileAt(x, y, z, false);
      if (t && (t.flags1 & F1_WALL_MASK) === (F1_WALL_NORTH | F1_WALL_SOUTH)) x = wrap(x + 1, z);
      else y = wrap(y + 1, z);
    }
    this.fill(x, y);
    this.reshape();
  }

  // ---- drawing ----

  private blit(t: Tile, px: number, py: number): void {
    const W = this.cols * 16;
    const H = this.rows * 16;
    const d = t.data;
    for (let j = 0; j < 16; j++) {
      const y = py + j;
      if (y < 0 || y >= H) continue;
      for (let i = 0; i < 16; i++) {
        const x = px + i;
        if (x < 0 || x >= W) continue;
        const c = d[j * 16 + i];
        if (t.transparent && c === 0xff) continue;
        this.buf[y * W + x] = c;
      }
    }
  }

  private drawPart(t: Tile, x: number, y: number, top: boolean): void {
    if (t.toptile === top) this.blit(t, x * 16, y * 16);
  }

  /** A tile with the others of a thing two squares wide or tall, to its left and above. */
  private drawTile(t: Tile, x: number, y: number, top: boolean): void {
    const tiles = this.game.tiles;
    let n = t.num;
    if (x < this.cols && y < this.rows) this.drawPart(tiles.get(n), x, y, top);
    if (t.dblWidth) {
      n--;
      if (x > 0 && y < this.rows) this.drawPart(tiles.get(n), x - 1, y, top);
    }
    if (t.dblHeight) {
      n--;
      if (y > 0 && x < this.cols) this.drawPart(tiles.get(n), x, y - 1, top);
    }
    if (x > 0 && y > 0 && t.dblWidth && t.dblHeight) this.drawPart(tiles.get(n - 1), x - 1, y - 1, top);
  }

  /** Whether a square of the world is on the map now and in the party's sight. */
  canSee(x: number, y: number, z: number): boolean {
    if (z !== this.game.player.z) return false;
    const vx = wrap(x - this.curX, z);
    const vy = wrap(y - this.curY, z);
    return vx >= 0 && vy >= 0 && vx < this.cols && vy < this.rows && this.seen(vx, vy);
  }

  private seen(vx: number, vy: number): boolean {
    return this.tmp[(vy + BORDER) * this.tw + vx + BORDER] !== 0;
  }

  private drawObj(o: Obj, vx: number, vy: number, lower: boolean, top: boolean): void {
    if (o.status & STATUS_INVISIBLE) return;
    const t = this.game.objects.tileOf(o);
    const forceLower = !!(t.flags3 & 0x4);
    if (!lower && forceLower && !top) return;
    if (lower && !forceLower) return;
    if (!this.seen(vx, vy)) return;
    // Nothing on a wall shows where the room beyond it is dark.
    if ((!this.seen(vx + 1, vy) || !this.seen(vx, vy + 1)) && (!(t.flags1 & F1_WALL) || o.objN === OBJ.BARS)) return;
    this.drawTile(t, vx, vy, top);
  }

  private drawObjs(lower: boolean, top: boolean): void {
    const g = this.game;
    const z = g.player.z;
    // From the bottom right to the top left, as MapWindow::drawObjSuperBlock does: a thing two squares wide or tall is
    // based at its bottom right, so what stands on its other squares (a candle on a table) is drawn after it.
    for (let vy = this.rows + 1; vy >= 0; vy--) {
      for (let vx = this.cols + 1; vx >= 0; vx--) {
        const l = g.objects.list(wrap(this.curX + vx, z), wrap(this.curY + vy, z), z);
        if (l) for (const o of l) this.drawObj(o, vx, vy, lower, top);
      }
    }
  }

  private drawActors(): void {
    const g = this.game;
    const z = g.player.z;
    for (const a of g.actors.list) {
      if (a.z !== z || !a.visible || a.objN === 0 || !a.alive) continue;
      // The unseen are not drawn, but for the party's own.
      if (a.objFlags & 0x02 && !a.inParty) continue;
      const infra = g.infraTurns > 0;
      const vx = wrap(a.x - this.curX, z);
      const vy = wrap(a.y - this.curY, z);
      if (vx > this.cols || vy > this.rows || (!infra && !this.seen(Math.min(vx, this.cols - 1), Math.min(vy, this.rows - 1)))) continue;
      if (!infra && vx < this.cols && vy < this.rows && !this.seen(vx, vy)) continue;
      const t = g.tiles.get(g.objects.objToTile[a.objN] + a.frameN);
      for (const part of a.parts()) {
        const bx = wrap(part.x - this.curX, z);
        const by = wrap(part.y - this.curY, z);
        if (bx <= this.cols && by <= this.rows) {
          const bt = g.tiles.get(g.objects.objToTile[part.objN ?? a.objN] + part.frame);
          this.drawTile(bt, bx, by, false);
          this.drawTile(bt, bx, by, true);
        }
      }
      this.drawTile(t, vx, vy, false);
      this.drawTile(t, vx, vy, true);
    }
  }

  render(): void {
    const g = this.game;
    this.updateSight();
    this.buf.fill(0);
    for (let vy = 0; vy < this.rows; vy++) {
      for (let vx = 0; vx < this.cols; vx++) {
        const raw = this.tmp[(vy + BORDER) * this.tw + vx + BORDER];
        if (raw === 0) continue;
        const n = raw & 0x7fff;
        if (g.kind === 'u6' && n >= 16 && n < 48) this.blit(g.tiles.animBase(n), vx * 16, vy * 16);
        this.blit(g.tiles.get(n), vx * 16, vy * 16);
      }
    }
    this.drawObjs(true, false);
    this.drawObjs(false, false);
    this.drawActors();
    this.drawObjs(false, true);
    const blows = this.drawFlashes();
    const out = new Uint32Array(this.image!.data.buffer);
    for (let i = 0; i < this.buf.length; i++) out[i] = this.pal32[this.buf[i]];
    this.ctx.putImageData(this.image!, 0, 0);
    const z = g.player.z;
    // Where there is no hit tile (the demo), a blow is a red burst.
    this.ctx.fillStyle = '#e02818';
    for (const [vx, vy] of blows) {
      for (const [ox, oy, w, h] of [[7, 2, 2, 12], [2, 7, 12, 2], [4, 4, 2, 2], [10, 4, 2, 2], [4, 10, 2, 2], [10, 10, 2, 2]]) this.ctx.fillRect(vx * 16 + ox, vy * 16 + oy, w, h);
    }
    for (const m of this.marks) {
      const vx = wrap(m.x - this.curX, z);
      const vy = wrap(m.y - this.curY, z);
      if (vx >= this.cols || vy >= this.rows) continue;
      this.ctx.fillStyle = m.color;
      if (m.kind === 'dot') this.ctx.fillRect(vx * 16 + 6, vy * 16 + 6, 4, 4);
      else {
        for (const [ox, oy, w, h] of [[0, 0, 5, 2], [0, 0, 2, 5], [11, 0, 5, 2], [14, 0, 2, 5], [0, 14, 5, 2], [0, 11, 2, 5], [11, 14, 5, 2], [14, 11, 2, 5]]) {
          this.ctx.fillRect(vx * 16 + ox, vy * 16 + oy, w, h);
        }
      }
    }
    this.renderLight();
  }

  /** How dark it is, 0 to 1: night out of doors, and always underground. */
  darkness(): number {
    const g = this.game;
    const z = g.player.z;
    if (z !== 0 && z !== 5) return 0.9;
    const t = g.clock.hour + g.clock.minute / 60;
    const NIGHT = 0.8;
    if (g.eclipseTurns > 0) return NIGHT;
    if (t >= 6 && t < 19) return 0;
    if (t >= 19 && t < 21) return ((t - 19) / 2) * NIGHT;
    if (t >= 4 && t < 6) return ((6 - t) / 2) * NIGHT;
    return NIGHT;
  }

  /** The glow of sunset and sunrise, 0 to 1. */
  private glow(): number {
    const g = this.game;
    if (g.player.z !== 0 && g.player.z !== 5) return 0;
    const t = g.clock.hour + g.clock.minute / 60;
    const near = (h: number): number => Math.max(0, 1 - Math.abs(t - h) / 1.25);
    return Math.max(near(19.5), near(5));
  }

  /**
   * Night as a soft blue dusk over the map, with pools of light round the party and whatever burns: lamps, fires,
   * torches. The pools are smooth gradients, cut out of the dark.
   */
  private renderLight(): void {
    const c = this.light.getContext('2d')!;
    const W = this.light.width;
    const H = this.light.height;
    const LP = MapView.LP;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    const dark = this.darkness();
    const glow = this.glow();
    if (dark > 0.01) {
      const g = this.game;
      const z = g.player.z;
      c.fillStyle = z !== 0 && z !== 5 ? `rgba(4,4,10,${dark})` : `rgba(8,14,48,${dark})`;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'destination-out';
      const pool = (vx: number, vy: number, r: number, strength: number): void => {
        const x = (vx + 0.5) * LP;
        const y = (vy + 0.5) * LP;
        const grad = c.createRadialGradient(x, y, 0, x, y, r * LP);
        grad.addColorStop(0, `rgba(0,0,0,${strength})`);
        grad.addColorStop(0.45, `rgba(0,0,0,${strength * 0.7})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grad;
        c.fillRect(x - r * LP, y - r * LP, r * LP * 2, r * LP * 2);
      };
      const RADIUS = [0, 2.4, 3.4, 4.8];
      /** Where firelight falls, to be warmed once the dark is cut. */
      const warm: [number, number, number][] = [];
      for (let vy = -2; vy < this.rows + 2; vy++) {
        for (let vx = -2; vx < this.cols + 2; vx++) {
          const inView = vx >= 0 && vy >= 0 && vx < this.cols && vy < this.rows;
          if (inView && !this.seen(vx, vy)) continue;
          const x = wrap(this.curX + vx, z);
          const y = wrap(this.curY + vy, z);
          let level = inView ? g.tiles.get(this.tmp[(vy + BORDER) * this.tw + vx + BORDER] & 0x7fff).flags2 & 3 : 0;
          const l = g.objects.list(x, y, z);
          if (l) for (const o of l) if (!(o.status & STATUS_INVISIBLE)) level = Math.max(level, g.tiles.get(g.objects.tileNum(o)).flags2 & 3);
          if (level) {
            pool(vx, vy, RADIUS[level], 0.95);
            warm.push([vx, vy, RADIUS[level]]);
          }
        }
      }
      // The party sees a little way by its own eyes, and further by a torch.
      for (const m of g.party) {
        const a = m.actor;
        if (a.z !== z) continue;
        const torch = g.objects.inventories[a.id].some((o) => o.objN === OBJ.TORCH && o.frameN === 1);
        const vx = wrap(a.x - this.curX, z);
        const vy = wrap(a.y - this.curY, z);
        // A Light spell lights the way for the leader; a torch for whoever holds it.
        const spell = a === g.player && g.lightTurns > 0 ? (g.lightTurns > 100 ? 7 : 5.5) : 0;
        pool(vx, vy, Math.max(spell, torch ? 5 : a === g.player ? 2.6 : 1.6), torch || spell ? 1 : 0.8);
        if (torch) warm.push([vx, vy, 5]);
      }
      // Firelight is warm against the blue.
      c.globalCompositeOperation = 'source-over';
      for (const [vx, vy, r] of warm) {
        const x = (vx + 0.5) * LP;
        const y = (vy + 0.5) * LP;
        const grad = c.createRadialGradient(x, y, 0, x, y, r * LP * 0.8);
        grad.addColorStop(0, `rgba(255,170,70,${0.22 * dark})`);
        grad.addColorStop(1, 'rgba(255,170,70,0)');
        c.fillStyle = grad;
        c.fillRect(x - r * LP, y - r * LP, r * LP * 2, r * LP * 2);
      }
    }
    if (glow > 0.01) {
      c.fillStyle = `rgba(255,150,60,${glow * 0.09})`;
      c.fillRect(0, 0, W, H);
    }
    // A storm (the storm cloak) rains on the map (MapWindow::drawRain).
    if (this.game.kind === 'u6' && this.game.stormTurns > 0) {
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = 'rgba(170,190,230,0.55)';
      c.lineWidth = Math.max(1, LP / 16);
      c.beginPath();
      for (let i = 0, n = (W * H) / (LP * LP) * 1.5; i < n; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        c.moveTo(x, y);
        c.lineTo(x - LP * 0.12, y + LP * 0.4);
      }
      c.stroke();
    }
  }

  /** Shots in flight and blows landing (combat.ts), drawn into the picture; returns blows with no tile to show them. */
  private drawFlashes(): [number, number][] {
    const g = this.game;
    const z = g.player.z;
    const now = performance.now();
    const bare: [number, number][] = [];
    for (const f of g.combat.flashes) {
      if (f.z !== z || f.until < now) continue;
      const left = (f.until - now) / 450;
      const vx = wrap(f.x - this.curX, z);
      const vy = wrap(f.y - this.curY, z);
      if (f.shot && left > 0.5) {
        // In flight: from the shooter towards the target.
        const t = (1 - left) / 0.5;
        const fx = wrap(f.shot.fromX - this.curX, z);
        const fy = wrap(f.shot.fromY - this.curY, z);
        const sx = fx < this.cols ? fx : vx;
        const sy = fy < this.rows ? fy : vy;
        this.blit(g.tiles.get(f.shot.tile), Math.round((sx + (vx - sx) * t) * 16), Math.round((sy + (vy - sy) * t) * 16));
        continue;
      }
      if (f.kind !== 'hit' || vx >= this.cols || vy >= this.rows) continue;
      if (g.kind === 'u6' && this.haveHitTile()) this.blit(g.tiles.get(257), vx * 16, vy * 16);
      else bare.push([vx, vy]);
    }
    return bare;
  }

  private hitTile: boolean | null = null;
  private haveHitTile(): boolean {
    this.hitTile ??= this.game.tiles.original(257).data.some((c) => c !== 0 && c !== 0xff);
    return this.hitTile;
  }

  /** The map square under a point of the canvas (CSS pixels from its corner). */
  squareAt(cx: number, cy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const z = this.game.player.z;
    const vx = Math.max(0, Math.min(this.cols - 1, Math.floor((cx / r.width) * this.cols)));
    const vy = Math.max(0, Math.min(this.rows - 1, Math.floor((cy / r.height) * this.rows)));
    return { x: wrap(this.curX + vx, z), y: wrap(this.curY + vy, z) };
  }

  private avg: Uint32Array | null = null;

  /** Each tile's average colour, for the map seen from above. */
  private averages(): Uint32Array {
    if (this.avg) return this.avg;
    const avg = new Uint32Array(2048);
    for (let n = 0; n < 2048; n++) {
      const d = this.game.tiles.original(n).data;
      let r = 0;
      let gr = 0;
      let b = 0;
      let k = 0;
      for (let i = 0; i < 256; i += 3) {
        const c = d[i];
        if (c === 0xff) continue;
        r += this.palette[c * 3];
        gr += this.palette[c * 3 + 1];
        b += this.palette[c * 3 + 2];
        k++;
      }
      avg[n] = k ? 0xff000000 | (Math.round(b / k) << 16) | (Math.round(gr / k) << 8) | Math.round(r / k) : 0xff000000;
    }
    return (this.avg = avg);
  }

  /** The land round the party seen from above, a pixel a square (Peer): its ground, the party a white mark. */
  overhead(size = 128, at?: { x: number; y: number; z: number }): HTMLCanvasElement {
    const g = this.game;
    const p = at ?? g.player;
    const avg = this.averages();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const out = new Uint32Array(img.data.buffer);
    const half = size >> 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) out[y * size + x] = avg[g.map.tileNum(p.x - half + x, p.y - half + y, p.z)];
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(half - 1, half - 1, 3, 3);
    return c;
  }

  /** The whole surface, a square a pixel each (the journal's map, where no picture of the cloth map is given). */
  world(): HTMLCanvasElement {
    const g = this.game;
    const avg = this.averages();
    const n = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    const out = new Uint32Array(img.data.buffer);
    // Water as the sea is drawn on the maps (its tiles' own colours average to near black).
    const sea = 0xff000000 | (0x9b << 16) | (0x5d << 8) | 0x2b;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const t = g.map.tileNum(x, y, 0);
        out[y * n + x] = g.tiles.original(t).water ? sea : avg[t];
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** A tile as a picture (for the party's faces and what they carry). */
  tileImage(tileNum: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(16, 16);
    const out = new Uint32Array(img.data.buffer);
    const t = this.game.tiles.original(tileNum);
    for (let i = 0; i < 256; i++) out[i] = t.transparent && t.data[i] === 0xff ? 0 : this.pal32[t.data[i]];
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** A face as a picture. */
  portraitImage(face: { w: number; h: number; data: Uint8Array }): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = face.w;
    c.height = face.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(face.w, face.h);
    const out = new Uint32Array(img.data.buffer);
    const data = face.data;
    for (let i = 0; i < face.w * face.h; i++) out[i] = data[i] === 0xff ? 0 : this.pal32[data[i]];
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
