/**
 * main.ts - the first screen, as the originals open on their titles: the three games side by side, each shown by its
 * own title picture once its files are here, each with its own files and its own saved game. A tap on one plays it;
 * the demo world is there to try the controls with.
 */
import { buildDemo } from './demo/demo.ts';
import { kvDelete, kvGet, kvSet, readPicked, type GameFiles } from './files/gamefiles.ts';
import { Game, type SaveState } from './game/game.ts';
import { detectKind, type Kind } from './game/kind.ts';
import { App } from './ui/app.ts';
import { stillPicture } from './ui/endings.ts';
import { installTheme } from './ui/theme.ts';

const host = document.getElementById('app')!;
try {
  if (localStorage.getItem('nuvie.text') === 'large') document.documentElement.classList.add('big-text');
  if (localStorage.getItem('nuvie.frame') === 'off') document.documentElement.classList.add('no-frame');
} catch {
  // Small text.
}
let app: App | null = null;

type Slot = Kind | 'demo';

const GAMES: { kind: Kind; name: string; sub: string }[] = [
  { kind: 'u6', name: 'Ultima VI', sub: 'The False Prophet' },
  { kind: 'se', name: 'The Savage Empire', sub: 'Worlds of Ultima' },
  { kind: 'md', name: 'Martian Dreams', sub: 'Worlds of Ultima' },
];

/** Each game's title picture, as its own opening shows it, from its files. */
function titlePicture(files: GameFiles, kind: Kind): HTMLCanvasElement | null {
  if (kind === 'u6') return stillPicture(files, 'titles.shp', ['palettes.int', 0], [[0, 0x13, 0], [1, 0x3b, 0x2f]]);
  if (kind === 'md') return stillPicture(files, 'mdmenu.lzc', ['md_title.pal', 0], [[0, 0, 0, 0]]);
  return stillPicture(files, 'intro.lzc', ['savage.pal', 0], [[1, 0, 0, 0], [1, 2, 0, 0], [1, 5, 0, 0], [2, 0, 0, 0]]);
}

/** Keep a game's files in its own place, with its title picture to show on the first screen. */
async function keep(files: GameFiles, kind: Kind): Promise<void> {
  await kvSet(`files:${kind}`, [...files]);
  await kvSet(`has:${kind}`, true);
  const pic = titlePicture(files, kind);
  if (pic) await kvSet(`art:${kind}`, pic.toDataURL('image/png')).catch(() => {});
}

async function filesOf(kind: Kind): Promise<GameFiles | null> {
  const kept = await kvGet<[string, Uint8Array][]>(`files:${kind}`).catch(() => undefined);
  return kept ? new Map(kept) : null;
}

/**
 * Before there were three places there was one: the files of whichever game was chosen, and its saved game. Moved
 * to that game's own place, once.
 */
async function migrate(): Promise<void> {
  const old = await kvGet<[string, Uint8Array][]>('files').catch(() => undefined);
  if (!old) return;
  const files = new Map(old);
  const kind = detectKind(files);
  if (!(await kvGet(`has:${kind}`).catch(() => undefined))) {
    await keep(files, kind);
    const save = await kvGet<SaveState>('save:game').catch(() => undefined);
    if (save) await kvSet(`save:${kind}`, save);
  }
  await kvDelete('files').catch(() => {});
  await kvDelete('save:game').catch(() => {});
}

async function start(files: GameFiles, slot: Slot, fresh = false): Promise<void> {
  const saveKey = `save:${slot}`;
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
      if (forget) void start(files, slot, true);
      else void splash();
    },
  });
  (window as unknown as { nuvie: unknown }).nuvie = { game, app };
}

/** A game's files, chosen by the player: a folder, some files or a .zip. Kept in the place of whichever game they are. */
function chooser(label: string, done: (files: GameFiles, kind: Kind) => void, fail: (why: string) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'choose';
  for (const [text, dir] of [[label, true], ['Files or a .zip', false]] as const) {
    const l = document.createElement('label');
    l.className = 'pick';
    l.textContent = text;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (dir) input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => {
      if (!input.files?.length) return;
      void readPicked(input.files)
        .then((files) => done(files, detectKind(files)))
        .catch((e) => fail(`That did not work: ${(e as Error).message}`));
    });
    l.append(input);
    wrap.append(l);
  }
  return wrap;
}

async function splash(message = ''): Promise<void> {
  await migrate().catch(() => {});
  const box = document.createElement('div');
  box.className = 'splash';
  const head = document.createElement('header');
  head.innerHTML = '<h1>Choose thy world</h1><p>Ultima VI and the Worlds of Ultima, played from your own copies.</p>';
  box.append(head);
  const err = document.createElement('p');
  err.className = 'err';
  err.textContent = message;
  const list = document.createElement('div');
  list.className = 'worlds';
  for (const g of GAMES) {
    const card = document.createElement('section');
    card.className = 'world';
    const art = await kvGet<string>(`art:${g.kind}`).catch(() => undefined);
    const has = !!(await kvGet(`has:${g.kind}`).catch(() => undefined));
    const saved = !!(await kvGet(`save:${g.kind}`).catch(() => undefined));
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'art';
    play.setAttribute('aria-label', `Play ${g.name}`);
    if (art) {
      const img = document.createElement('img');
      img.src = art;
      img.alt = g.name;
      play.append(img);
    } else {
      play.innerHTML = `<span class="name">${g.name}</span><span class="sub">${g.sub}</span>`;
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const caption = document.createElement('p');
    caption.textContent = has ? (saved ? `${g.name} - continue thy journey` : `${g.name} - a new journey`) : `${g.name} - add your copy to play`;
    meta.append(caption);
    const added = (files: GameFiles, kind: Kind): void => {
      err.textContent = 'Keeping the files…';
      void keep(files, kind)
        .then(() => (kind === g.kind ? start(files, kind) : splash(`Those were the files of ${GAMES.find((x) => x.kind === kind)!.name}; kept there.`)))
        .catch((e) => void splash(`That did not work: ${(e as Error).message}`));
    };
    if (has) {
      play.addEventListener('click', () => {
        err.textContent = 'Loading…';
        void filesOf(g.kind)
          .then((files) => (files ? start(files, g.kind) : splash('Those files are gone; add them again.')))
          .catch((e) => void splash(`That did not work: ${(e as Error).message}`));
      });
      const more = document.createElement('details');
      more.innerHTML = '<summary>Files</summary>';
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.textContent = 'Forget this game (files and save)';
      forget.addEventListener('click', () => {
        if (!confirm(`Forget ${g.name}? Its files and saved game are removed from this browser.`)) return;
        void Promise.all(['files', 'save', 'art', 'has'].map((k) => kvDelete(`${k}:${g.kind}`).catch(() => {}))).then(() => splash());
      });
      more.append(chooser('Replace with a folder', added, (w) => (err.textContent = w)), forget);
      meta.append(more);
    } else {
      play.disabled = true;
      meta.append(chooser('Choose its folder', added, (w) => (err.textContent = w)));
    }
    card.append(play, meta);
    list.append(card);
  }
  const demo = document.createElement('button');
  demo.type = 'button';
  demo.className = 'demo';
  demo.textContent = 'Or try the demo world';
  demo.addEventListener('click', () => void start(buildDemo(), 'demo').catch((e) => splash(String(e))));
  const foot = document.createElement('p');
  foot.className = 'small';
  foot.textContent = 'A TypeScript port of the Nuvie engine (GPL). It plays your own copies of the games and ships none of them; their files and saved games are kept in this browser and never leave the device. Each game keeps its own saved game.';
  box.append(list, err, demo, foot);
  host.replaceChildren(box);
}

async function boot(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) return start(buildDemo(), 'demo', q.has('new'));
  return splash();
}

boot().catch((e) => void splash(`That did not work: ${(e as Error).message}`));
