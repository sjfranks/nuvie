/**
 * voxelview.ts - the map in voxels: every pixel of the picture the flat view draws (mapview.ts) raised into a column
 * as tall as the thing drawn there stands (MapView.heightOf: walls a square high, tables and rocks part way, people
 * a little under a square, the ground flat, water sunk), coloured by the pixel, lit from above, and seen at a slant.
 * The flat view still decides what is drawn - line of sight, roofs, animation, night - so the two always agree.
 */
import * as THREE from 'three';

export interface VoxelFrame {
  buf: Uint8Array;
  hbuf: Uint8Array;
  ubuf: Uint8Array;
  uhbuf: Uint8Array;
  pal: Uint32Array;
  w: number;
  h: number;
}

/** How steeply the map is looked down on, from the south (radians from the level). */
const TILT = (42 * Math.PI) / 180;
/** The columns reach down to here, below the ground, so no gaps show between them. */
const FLOOR = -3;
/** In the height buffer (mapview.ts): a figure standing up, and the upper of its two squares. */
const STAND = 0x80;
const UPPER = 0x40;
/** How thick a figure standing up is, front to back. */
const THICK = 3;

export class VoxelView {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  private mesh: THREE.InstancedMesh | null = null;
  private colors: THREE.InstancedBufferAttribute | null = null;
  private cap = 0;
  private w = 0;
  private h = 0;
  private readonly geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  private readonly mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.7);
  private readonly sky = new THREE.AmbientLight(0xffffff, 1.1);

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'voxels';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // Light from the front and a little to the left, on the faces the view sees.
    this.sun.position.set(-0.45, 0.9, 0.7);
    this.scene.add(this.sun, this.sky);
  }

  /** Make room for a picture of this many pixels, and look at it. */
  private setup(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const need = w * h * 2;
    if (need > this.cap) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.dispose();
      }
      this.cap = need;
      this.mesh = new THREE.InstancedMesh(this.geo, this.mat, need);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.colors = new THREE.InstancedBufferAttribute(new Float32Array(need * 3), 3);
      this.colors.setUsage(THREE.DynamicDrawUsage);
      this.mesh.instanceColor = this.colors;
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    }
    // From the south, looking down at a slant, the middle of the picture in the middle of the view.
    const c = new THREE.Vector3(w / 2, 4, h / 2);
    const d = 1000;
    this.camera.position.set(c.x, c.y + Math.sin(TILT) * d, c.z + Math.cos(TILT) * d);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c);
    this.fit();
  }

  /** The view as wide as the canvas allows: the whole depth of the picture shown, its sides trimmed to fit. */
  private fit(): void {
    const r = this.canvas.getBoundingClientRect();
    const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : this.w / Math.max(1, this.h);
    const vh = this.h * Math.sin(TILT) + 16 * Math.cos(TILT);
    const vw = vh * aspect;
    this.camera.left = -vw / 2;
    this.camera.right = vw / 2;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    this.camera.updateProjectionMatrix();
    if (r.width > 0) this.renderer.setSize(r.width, r.height, false);
  }

  /** Draw the picture in voxels. */
  draw(f: VoxelFrame): void {
    this.setup(f.w, f.h);
    this.fit();
    const mesh = this.mesh!;
    const m = mesh.instanceMatrix.array as Float32Array;
    const col = this.colors!.array as Float32Array;
    // Zoomed out, a voxel for each two pixels square, so there are not too many.
    const step = f.w > 240 ? 2 : 1;
    let n = 0;
    const put = (x: number, y0: number, y1: number, z: number, depth: number, c: number): void => {
      const rgba = f.pal[c];
      const o = n * 16;
      m.fill(0, o, o + 16);
      m[o] = step;
      m[o + 5] = y1 - y0;
      m[o + 10] = depth;
      m[o + 12] = x;
      m[o + 13] = y0;
      m[o + 14] = z;
      m[o + 15] = 1;
      col[n * 3] = (rgba & 0xff) / 255;
      col[n * 3 + 1] = ((rgba >> 8) & 0xff) / 255;
      col[n * 3 + 2] = ((rgba >> 16) & 0xff) / 255;
      n++;
    };
    const column = (x: number, y: number, c: number, ht: number): void => {
      if (c === 0 && ht === 0) return; // unseen: nothing there
      const rgba = f.pal[c];
      // A little grain: the lighter pixels stand a voxel prouder.
      const lum = ((rgba & 0xff) * 3 + ((rgba >> 8) & 0xff) * 6 + ((rgba >> 16) & 0xff)) / 10;
      const top = ht === 0 ? -0.6 : ht + (lum > 150 ? 1 : 0);
      put(x, FLOOR, top, y, step, c);
    };
    for (let y = 0; y < f.h; y += step) {
      for (let x = 0; x < f.w; x += step) {
        const i = y * f.w + x;
        const hv = f.hbuf[i];
        if (!(hv & STAND)) {
          let ht = hv;
          if (step > 1) ht = Math.max(ht, f.hbuf[i + 1] & 0x3f, f.hbuf[i + f.w] & 0x3f, f.hbuf[i + f.w + 1] & 0x3f);
          column(x, y, f.buf[i], ht);
          continue;
        }
        // The ground under it, then the figure standing up at the front of its square: each row of its picture a row
        // of voxels, the bottom row on the ground, the upper square's rows above the lower's.
        column(x, y, f.ubuf[i], f.uhbuf[i] & 0x3f);
        const row = y & 15;
        const upper = !!(hv & UPPER);
        const front = (y >> 4) * 16 + (upper ? 31 : 15);
        const up = 15 - row + (upper ? 16 : 0);
        put(x, up, up + step, front - THICK + 1, THICK, f.buf[i]);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.colors!.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  /** Where on the picture a point of the canvas falls (on the ground), as fractions of its width and height. */
  pick(cx: number, cy: number): { fx: number; fy: number } | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !this.w) return null;
    const ndc = new THREE.Vector2((cx / r.width) * 2 - 1, -(cy / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1), hit)) return null;
    return { fx: hit.x / this.w, fy: hit.z / this.h };
  }

  dispose(): void {
    this.mesh?.dispose();
    this.renderer.dispose();
  }
}
