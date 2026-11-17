/**
 * journal.ts - the notebook the original left to the player: who was met, what each said to what was asked, the
 * words they dropped that can be asked about, and what was read on signs and in books.
 */
export interface JournalNote {
  date: string;
  asked: string;
  said: string;
}

export interface JournalPerson {
  actor: number;
  name: string;
  desc: string;
  where: string;
  met: string;
  notes: JournalNote[];
  /** Words heard from them that they answer to. */
  topics: string[];
}

export interface JournalReading {
  date: string;
  what: string;
  where: string;
  text: string;
}

export interface JournalData {
  people: JournalPerson[];
  readings: JournalReading[];
}

const MAX_NOTES = 60;
const MAX_READINGS = 100;

export class Journal {
  data: JournalData = { people: [], readings: [] };

  person(actor: number): JournalPerson | undefined {
    return this.data.people.find((p) => p.actor === actor);
  }

  meet(actor: number, name: string, desc: string, where: string, date: string): JournalPerson {
    let p = this.person(actor);
    if (!p) {
      p = { actor, name, desc, where, met: date, notes: [], topics: [] };
      this.data.people.push(p);
    }
    if (name) p.name = name;
    if (desc) p.desc = desc;
    return p;
  }

  /** Keep what was said to a question; asked again, the newer answer replaces the older. */
  note(actor: number, asked: string, said: string, date: string): void {
    const p = this.person(actor);
    said = said.replace(/@/g, '').replace(/\s*\n\s*/g, ' ').trim();
    if (!p || !said) return;
    const key = asked.toLowerCase();
    const old = p.notes.findIndex((n) => n.asked.toLowerCase() === key);
    if (old >= 0) p.notes.splice(old, 1);
    p.notes.push({ date, asked, said });
    if (p.notes.length > MAX_NOTES) p.notes.shift();
  }

  addTopic(actor: number, word: string): void {
    const p = this.person(actor);
    if (p && !p.topics.includes(word)) p.topics.push(word);
  }

  read(what: string, where: string, text: string, date: string): void {
    text = text.trim();
    if (!text || this.data.readings.some((r) => r.text === text)) return;
    this.data.readings.push({ date, what, where, text });
    if (this.data.readings.length > MAX_READINGS) this.data.readings.shift();
  }
}
