/**
 * Tests on a real copy of Ultima 6, where there is one in gamedata/ultima6/ (it is never committed); skipped without.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameFiles } from '../src/files/gamefiles.ts';
import { Game } from '../src/game/game.ts';

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
