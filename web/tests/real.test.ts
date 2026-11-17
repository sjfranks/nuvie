/**
 * Tests on a real copy of Ultima 6, where there is one in gamedata/ultima6/ (it is never committed); skipped without.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameFiles } from '../src/files/gamefiles.ts';
import { Game } from '../src/game/game.ts';
import { SPELLS } from '../src/game/u6combat.ts';

const GAMES = [
  ['Ultima 6', 'ultima6', 199],
  ['Savage Empire', 'savage', 40],
  ['Martian Dreams', 'martian', 40],
] as const;

for (const [title, folder, people] of GAMES) {
const DIR = join(import.meta.dirname, '../gamedata', folder);
const have = existsSync(join(DIR, 'MAP')) || existsSync(join(DIR, 'map'));

function load(): GameFiles {
  const files: GameFiles = new Map();
  const walk = (d: string, save: boolean): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, true);
      else if (!(save && files.has(n.toLowerCase()))) files.set(n.toLowerCase(), new Uint8Array(readFileSync(p)));
    }
  };
  walk(DIR, false);
  return files;
}

describe.skipIf(!have)(`a real copy of ${title}`, () => {
  it('loads a new game', () => {
    const g = new Game(load());
    const p = g.player;
    console.log(g.kind, 'player', g.playerName(), p.x, p.y, p.z, 'obj', p.objN, g.date(), g.time(), 'party', g.party.map((m) => m.name + ':' + m.actor.id));
    console.log('objects on map', g.objects.all().length, 'ground', g.tiles.look(g.map.tileNum(p.x, p.y, p.z), 0));
    expect(g.party.length).toBeGreaterThan(0);
    expect(g.objects.all().length).toBeGreaterThan(5000);
    expect(g.map.isPassable(p.x, p.y, p.z)).toBe(true);
    for (let i = 0; i < 200; i++) g.pass();
    const s = JSON.parse(JSON.stringify(g.save()));
    const h = new Game(load(), s);
    expect(h.objects.all().length).toBe(g.objects.all().length);
  });

  it.runIf(folder === 'ultima6')('hatches the opening gargoyles, and fights to the death', () => {
    const g = new Game(load());
    const gargoyles = g.actors.list.filter((a) => a.id >= 203 && a.objN === 363);
    expect(gargoyles.length).toBe(3);
    expect(gargoyles.every((a) => g.combat.hostile(a))).toBe(true);
    // A troll beside the party is fought until it falls, and leaves gold.
    const p = g.player;
    const troll = g.combat.spawn(371, p.x + 2, p.y, p.z, 0, 8)!;
    g.log = [];
    for (const a of gargoyles) Object.assign(a, { objN: 0, visible: false }); // the gargoyles keep out of it
    for (let i = 0; i < 300 && troll.objN !== 0; i++) {
      if (g.attackAt(troll.x, troll.y)) continue;
      // Out of reach (it may flee): after it.
      const way = g.pathTo(troll.x, troll.y, true);
      if (way?.length) g.move(way[0][0], way[0][1]);
      else g.pass();
    }
    const text = g.log.map((l) => l.text).join('\n');
    expect(text).toContain('Troll killed!');
    expect(g.party.length).toBe(4);
  });

  it.runIf(folder === 'ultima6')('casts spells from a readied book, using magic points and reagents', () => {
    const g = new Game(load());
    const avatar = g.player;
    const spell = (name: string) => SPELLS.find((s) => s.name === name)!;
    expect(g.magic.cannot(avatar, spell('Light'))).toBe('No spellbook is readied.');
    const book = g.objects.create(57, 0, 0);
    g.objects.toInventory(book, avatar.id);
    expect(g.ready(book, avatar)).toBe(true);
    const page = g.objects.create(58, 0, 255); // every spell
    g.objects.toContainer(page, book);
    expect(g.magic.known(avatar).length).toBe(80);
    expect(g.magic.cannot(avatar, spell('Magic Arrow'))).toBe('No reagents.');
    for (const r of [65, 66, 67, 68, 69, 70, 71, 72]) g.invNew(avatar.id, r, 10, 0);
    avatar.level = 8;
    avatar.magic = 30;
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const troll = g.combat.spawn(371, avatar.x + 2, avatar.y, avatar.z, 0, 8)!;
    g.log = [];
    g.castSpell(avatar, spell('Magic Arrow'), troll.x, troll.y);
    expect(avatar.magic).toBe(28);
    expect(g.invCount(avatar.id, 65)).toBe(9); // black pearl (and sulfurous ash)
    g.castSpell(avatar, spell('Light'));
    expect(g.lightTurns).toBeGreaterThan(90);
    avatar.hp = 10;
    g.castSpell(avatar, spell('Great Heal'), avatar.x, avatar.y);
    expect(avatar.hp).toBe(avatar.maxHp);
    g.castSpell(avatar, spell('Create Food'));
    g.castSpell(avatar, spell('Kill'), troll.x, troll.y);
    console.log(g.log.map((l) => l.text).join(' | '));
    expect(g.log.some((l) => /Create \d+ food/.test(l.text))).toBe(true);
  });

  it.runIf(folder === 'ultima6')('readies and unreadies what the party carries', () => {
    const g = new Game(load());
    const dupre = g.party[1].actor;
    const inv = g.objects.inventories[dupre.id];
    const sword = inv.find((o) => o.objN === 43)!;
    expect(sword.loc).toBe('readied');
    g.unready(sword);
    expect(sword.loc).toBe('inv');
    expect(g.ready(sword, dupre)).toBe(true);
    // A second weapon held in both hands will not go on beside it.
    const halberd = g.objects.create(47, 0, 0);
    g.objects.toInventory(halberd, dupre.id);
    expect(g.ready(halberd, dupre)).toBe(false);
    expect(g.ready(g.objects.create(55, 5, 0), dupre)).toBe(false); // arrows
    console.log('Dupre readied:', inv.filter((o) => o.loc === 'readied').map((o) => g.objects.look(o)));
  });

  it('holds a conversation with everyone who has one, without the interpreter failing', () => {
    const g = new Game(load());
    let talked = 0;
    const odd: string[] = [];
    for (const a of g.actors.list) {
      if (a === g.player || !g.lib.script(g.lib.scriptNum(a))) continue;
      a.statusFlags &= ~0x04;
      g.log = [];
      g.talkTo(a);
      if (!g.converse) continue;
      talked++;
      // Ask what there is to ask, then leave.
      for (let n = 0; n < 40 && g.converse; n++) {
        if (g.paused) g.continueTalk();
        else {
          const ask = g.asking();
          const opts = g.sayOptions();
          if (!ask) break;
          const pick = opts[n] ?? opts[opts.length - 1];
          g.reply(ask.type === 'number' ? '1' : ask.type === 'char' ? ask.allowed[0] ?? 'n' : pick ? pick.say : 'bye');
        }
      }
      if (g.converse) {
        for (let n = 0; n < 30 && g.converse; n++) (g.paused ? g.continueTalk() : g.reply(g.asking()?.type === 'char' ? 'n' : 'bye'));
      }
      const text = g.log.map((l) => l.text).join('');
      // A few story scenes will not let go until the right thing is asked; that is the script, not the interpreter.
      if (g.converse && !g.log.some((l) => l.kind === 'npc')) odd.push(`${a.id}: said nothing`);
      if (/\[|[\x00-\x09\x0b-\x1f\x7f-\xff]/.test(text)) odd.push(`${a.id}: ${JSON.stringify(text.match(/.{0,30}(\[|[\x00-\x09\x0b-\x1f\x7f-\xff]).{0,30}/)?.[0])}`);
      g.converse = null;
      g.paused = false;
    }
    console.log('talked with', talked, 'odd:', odd.length, odd.slice(0, 25));
    expect(odd).toEqual([]);
    expect(talked).toBeGreaterThanOrEqual(people);
  });
});
}
