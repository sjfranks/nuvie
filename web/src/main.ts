/**
 * main.ts - the first screen (choose your copy of the game, or try the demo world) and starting the game from it.
 */
import { buildDemo } from './demo/demo.ts';
import { kvDelete, kvGet, kvSet, readPicked, type GameFiles } from './files/gamefiles.ts';
import { Game, type SaveState } from './game/game.ts';
import { App } from './ui/app.ts';
import { installTheme } from './ui/theme.ts';

const host = document.getElementById('app')!;
try {
  if (localStorage.getItem('nuvie.text') === 'large') document.documentElement.classList.add('big-text');
} catch {
  // Small text.
}
let app: App | null = null;

type Kind = 'demo' | 'game';

async function start(files: GameFiles, kind: Kind, fresh = false): Promise<void> {
  const saveKey = `save:${kind}`;
  if (fresh) await kvDelete(saveKey).catch(() => {});
  const saved = await kvGet<SaveState>(saveKey).catch(() => undefined);
  let game: Game;
  try {
    game = new Game(files, saved?.version === 1 ? saved : undefined);
  } catch (e) {
    // A saved game that no longer fits is not worth losing the world over.
    if (!saved) throw e;
    game = new Game(files);
  }
  app?.dispose();
  await installTheme(files);
  app = new App(host, game, {
    save: (s) => void kvSet(saveKey, s).catch(() => {}),
    leave: (forget) => {
      app?.dispose();
      app = null;
      if (forget) void start(files, kind, true);
      else void kvDelete('last').then(() => intro());
    },
  });
  await kvSet('last', kind).catch(() => {});
  (window as unknown as { nuvie: unknown }).nuvie = { game, app };
}

function intro(error = ''): void {
  const box = document.createElement('div');
  box.className = 'intro paper';
  box.innerHTML = `
    <h1>Nuvie Web</h1>
    <p>The Nuvie engine, ported to TypeScript for a phone held upright (or sideways): the map above, the log and the party below, and conversations by menu, with a journal of what was said.</p>
    <p>It plays <b>your own copy</b> of the game, and ships none of it. Choose the game's folder, its files, or a .zip of them; they are kept in this browser and never leave the device.</p>
    <label class="pick">Choose a folder<input id="dir" type="file" webkitdirectory multiple /></label>
    <label class="pick">Choose files or a .zip<input id="files" type="file" multiple /></label>
    <button id="demo" type="button">Try the demo world</button>
    <p class="err" id="err"></p>
    <p class="small">The demo is a small island made for this port, to try the controls with. Ultima 6 is the game supported so far: walking, looking, talking, doors, ladders, containers and reading work; combat and magic are not ported yet.</p>`;
  host.replaceChildren(box);
  const err = box.querySelector<HTMLElement>('#err')!;
  err.textContent = error;
  const picked = async (input: HTMLInputElement): Promise<void> => {
    if (!input.files?.length) return;
    err.textContent = 'Reading…';
    try {
      const files = await readPicked(input.files);
      await start(files, 'game');
      await kvSet('files', [...files]).catch(() => {});
    } catch (e) {
      intro(`That did not work: ${(e as Error).message}`);
    }
  };
  for (const id of ['dir', 'files']) {
    const input = box.querySelector<HTMLInputElement>('#' + id)!;
    input.addEventListener('change', () => void picked(input));
  }
  box.querySelector('#demo')!.addEventListener('click', () => void start(buildDemo(), 'demo').catch((e) => intro(String(e))));
}

async function boot(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) return start(buildDemo(), 'demo', q.has('new'));
  const last = await kvGet<Kind>('last').catch(() => undefined);
  if (last === 'demo') return start(buildDemo(), 'demo');
  if (last === 'game') {
    const kept = await kvGet<[string, Uint8Array][]>('files').catch(() => undefined);
    if (kept) return start(new Map(kept), 'game');
  }
  intro();
}

boot().catch((e) => intro(`That did not work: ${(e as Error).message}`));
