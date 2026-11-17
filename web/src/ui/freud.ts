/**
 * freud.ts - Martian Dreams' character creation (data/scripts/md/intro.lua, create_character): Sigmund Freud's
 * interview aboard the capsule. Its lines are the game's own (scenetxt.lzc, item 5); the steps (char_creation_tbl)
 * and the branches by which the answers set strength, dexterity and intelligence are intro.lua's.
 */

/** char_creation_tbl: [line (0 ends a question; negative is Freud speaking), what is asked: -1 go on, -2 A/B, -3 A/B/C, -4 a name]. */
const STEPS: [number, number][] = [[-1, -1], [-2, -1], [3, -1], [4, -1], [5, -4], [6, -1], [7, -2], [0, -1], [8, -1], [9, -1], [0, -1], [10, -1], [11, -1], [0, -1], [12, -1], [13, -1], [14, -3], [0, -1], [15, -1], [0, -1], [16, -1], [17, -2], [0, -1], [18, -1], [19, -2], [0, -1], [20, -1], [21, -2], [0, -1], [22, -2], [0, -1], [23, -1], [24, -1], [0, -1], [25, -1], [26, -1], [0, -1], [27, -1], [28, -2], [0, -1], [29, -1], [30, -1], [0, -1], [31, -1], [32, -1], [0, -1], [33, -1], [34, -2], [0, -1], [35, -1], [36, -1], [0, -1], [37, -1], [38, -1], [0, -1], [39, -1], [40, -1], [0, -1], [41, -1], [42, -1], [0, -1], [43, -1], [44, -2], [0, -1], [45, -1], [0, -1], [46, -1], [47, -1], [0, -1], [48, -1], [49, -1], [0, -1], [50, -1], [51, -2], [0, -1], [52, -1], [53, -1], [0, -1], [54, -1], [55, -1], [0, -1], [56, -1], [57, -1], [0, -1], [58, -1], [59, -2], [0, -1], [60, -1], [61, -1], [0, -1], [62, -1], [63, -1], [0, -1]];

export interface Step {
  text: string;
  freud: boolean;
  /** 'go' to go on; 'ab', 'abc' an answer; 'name' the player's name. */
  ask: 'go' | 'ab' | 'abc' | 'name';
}
export interface Hero {
  name: string;
  female: boolean;
  str: number;
  dex: number;
  int: number;
}

/** The interview, a step at a time: next() is given the answer to the step before ('a', 'b', 'c' or a name). */
export function* interview(lines: string[], rand: (lo: number, hi: number) => number): Generator<Step, Hero, string> {
  let name = 'Avatar';
  const high = rand(24, 26);
  const low = rand(22, 24);
  const base = rand(18, 22);
  let str = base;
  let dex = base;
  let int = base;
  const say = (t: string): string => t.replace(/\$P/g, name);
  function* ask(i: number): Generator<Step, string, string> {
    let key = '';
    while (STEPS[i] && STEPS[i][0] !== 0) {
      const [line, action] = STEPS[i];
      const answer = yield { text: say(lines[Math.abs(line)] ?? ''), freud: line < 0, ask: action === -2 ? 'ab' : action === -3 ? 'abc' : action === -4 ? 'name' : 'go' };
      if (action === -4) name = answer.trim().slice(0, 13) || name;
      else if (action !== -1) key = answer;
      i++;
    }
    return key;
  }
  const set = (hi: 'str' | 'dex' | 'int', lo: 'str' | 'dex' | 'int'): void => {
    const v = { str, dex, int };
    v[hi] = high;
    v[lo] = low;
    ({ str, dex, int } = v);
  };
  const gender = yield* ask(0);
  const male = gender !== 'b';
  yield* ask(male ? 8 : 11);
  const first = yield* ask(14);
  // The branches of question_1_answer_a, _b and _c.
  const strInt = function* (): Generator<Step, void, string> {
    const a = yield* ask(29);
    if (a === 'a') {
      set('str', 'int');
      yield* ask(male ? 31 : 34);
    } else set('int', 'str');
  };
  const intDex = function* (): Generator<Step, void, string> {
    const a = yield* ask(37);
    if (a === 'a') {
      set('int', 'dex');
      yield* ask(40);
    } else {
      set('dex', 'int');
      yield* ask(43);
    }
  };
  const strDex = function* (): Generator<Step, void, string> {
    const a = yield* ask(46);
    if (a === 'a') {
      set('str', 'dex');
      yield* ask(male ? 49 : 52);
    } else {
      set('dex', 'str');
      yield* ask(male ? 58 : 55);
    }
  };
  if (first === 'a') {
    yield* ask(18);
    if ((yield* ask(20)) === 'a') {
      if ((yield* ask(23)) === 'a') yield* strInt();
      else yield* intDex();
    } else if ((yield* ask(26)) === 'a') yield* strDex();
    else {
      const a = yield* ask(61);
      if (a === 'a') {
        set('int', 'dex');
        yield* ask(64);
      } else {
        set('dex', 'int');
        yield* ask(66);
      }
    }
  } else if (first === 'b') {
    if ((yield* ask(26)) === 'a') {
      if ((yield* ask(23)) === 'a') yield* strInt();
      else yield* intDex();
    } else if ((yield* ask(20)) === 'a') {
      const a = yield* ask(72);
      if (a === 'a') {
        set('int', 'str');
        yield* ask(75);
      } else {
        set('str', 'int');
        yield* ask(78);
      }
    } else yield* strDex();
  } else {
    yield* ask(81);
    if ((yield* ask(23)) === 'a') {
      if ((yield* ask(26)) === 'a') yield* strDex();
      else yield* intDex();
    } else if ((yield* ask(20)) === 'a') yield* strInt();
    else {
      const a = yield* ask(84);
      if (a === 'a') {
        set('dex', 'str');
        yield* ask(87);
      } else {
        set('str', 'dex');
        yield* ask(90);
      }
    }
  }
  yield* ask(69);
  return { name, female: !male, str, dex, int };
}
