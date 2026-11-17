/**
 * map.ts - the world's ground: the surface (1024 squares a side) and five dungeon levels (256), built from 8 by 8
 * chunks (Nuvie's Map.cpp).
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { Objects, PASS_NO_OBJ, PASS_NOT } from './objects.ts';
import { F2_MISSILE_BOUNDARY, type Tile, type Tiles } from './tiles.ts';

export const mapWidth = (z: number): number => (z === 0 ? 1024 : 256);
export const wrap = (v: number, z: number): number => v & (z === 0 ? 1023 : 255);

export class GameMap {
  readonly surface = new Uint8Array(1024 * 1024);
  readonly dungeons: Uint8Array[] = [];

  constructor(
    files: GameFiles,
    readonly tiles: Tiles,
    readonly objects: Objects,
  ) {
    const map = files.get('map');
    const chunks = files.get('chunks');
    if (!map || !chunks) throw new Error('missing game file: map or chunks');
    let p = 0;
    // The surface: 64 superchunks of 16 by 16 chunks, each chunk number 12 bits.
    for (let s = 0; s < 64; s++, p += 384) this.insert(this.surface, 1024, map, p, chunks, (s % 8) * 128, (s >> 3) * 128, 16);
    for (let l = 0; l < 5; l++, p += 1536) {
      const d = new Uint8Array(256 * 256);
      this.insert(d, 256, map, p, chunks, 0, 0, 32);
      this.dungeons.push(d);
    }
  }

  private insert(dest: Uint8Array, pitch: number, map: Uint8Array, p: number, chunks: Uint8Array, wx: number, wy: number, n: number): void {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j += 2, p += 3) {
        const c1 = ((map[p + 1] & 0xf) << 8) | map[p];
        const c2 = (map[p + 2] << 4) | (map[p + 1] >> 4);
        this.chunk(dest, pitch, chunks, c1, wx + j * 8, wy + i * 8);
        this.chunk(dest, pitch, chunks, c2, wx + (j + 1) * 8, wy + i * 8);
      }
    }
  }

  private chunk(dest: Uint8Array, pitch: number, chunks: Uint8Array, c: number, x: number, y: number): void {
    for (let i = 0; i < 8; i++) dest.set(chunks.subarray(c * 64 + i * 8, c * 64 + i * 8 + 8), (y + i) * pitch + x);
  }

  data(z: number): Uint8Array {
    return z === 0 ? this.surface : this.dungeons[Math.min(z, 5) - 1];
  }

  tileNum(x: number, y: number, z: number): number {
    const w = mapWidth(z);
    return this.data(z)[(y & (w - 1)) * w + (x & (w - 1))];
  }

  tile(x: number, y: number, z: number): Tile {
    return this.tiles.original(this.tileNum(x, y, z));
  }

  isPassable(x: number, y: number, z: number): boolean {
    x = wrap(x, z);
    y = wrap(y, z);
    const st = this.objects.isPassable(x, y, z);
    if (st === PASS_NOT) return false;
    // Bridges, doorways and the like make the ground under them walkable.
    if (st !== PASS_NO_OBJ && this.objects.isForcedPassable(x, y, z)) return true;
    return this.tile(x, y, z).passable;
  }

  isBoundary(x: number, y: number, z: number): boolean {
    x = wrap(x, z);
    y = wrap(y, z);
    if (this.tiles.get(this.tileNum(x, y, z)).boundary && !this.objects.isForcedPassable(x, y, z)) return true;
    return this.objects.isBoundary(x, y, z);
  }

  isMissileBoundary(x: number, y: number, z: number): boolean {
    x = wrap(x, z);
    y = wrap(y, z);
    if (this.tiles.get(this.tileNum(x, y, z)).flags2 & F2_MISSILE_BOUNDARY && !this.objects.isForcedPassable(x, y, z)) return true;
    return this.objects.isBoundary(x, y, z, F2_MISSILE_BOUNDARY);
  }

  isWater(x: number, y: number, z: number): boolean {
    return !this.objects.get(wrap(x, z), wrap(y, z), z) && this.tile(x, y, z).water;
  }
}
