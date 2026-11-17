/**
 * gypsy.ts - Ultima VI's character creation (data/scripts/u6/intro.lua, create_character): the gypsy's questions of
 * the eight virtues, asked as a contest - four pairs, then the winners in two pairs, then the last two - each answer
 * pouring a vial that adds to strength, dexterity or intelligence.
 */

export const VIRTUES = ['Honesty', 'Compassion', 'Valor', 'Justice', 'Sacrifice', 'Honor', 'Spirituality', 'Humility'];
/** What each virtue's vial adds (strength, dexterity, intelligence). */
const STR = [0, 0, 2, 0, 1, 1, 1, 0];
const DEX = [0, 2, 0, 1, 1, 0, 1, 0];
const INT = [2, 0, 0, 1, 0, 1, 1, 0];

/** gypsy_questions: the question set between two virtues, numbered from 0x69. */
const QUESTION = [
  -1, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f,
  0x69, -1, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75,
  0x6a, 0x70, -1, 0x76, 0x77, 0x78, 0x79, 0x7a,
  0x6b, 0x71, 0x76, -1, 0x7b, 0x7c, 0x7d, 0x7e,
  0x6c, 0x72, 0x77, 0x7b, -1, 0x7f, 0x80, 0x81,
  0x6d, 0x73, 0x78, 0x7c, 0x7f, -1, 0x82, 0x83,
  0x6e, 0x74, 0x79, 0x7d, 0x80, 0x82, -1, 0x84,
  0x6f, 0x75, 0x7a, 0x7e, 0x81, 0x83, 0x84, -1,
];
/** gypsy_ab_select's lookups: the virtue answer A or B stands for. */
const A = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6];
const B = [1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 3, 4, 5, 6, 7, 4, 5, 6, 7, 5, 6, 7, 6, 7, 7];

export const QUESTIONS = [
  'Entrusted to deliver an uncounted purse of gold, thou dost meet a poor beggar. Dost thou A) deliver the gold Honestly, knowing the trust in thee was well-placed; or B) show Compassion and give the beggar a coin, knowing it won\'t be missed?',
  'Thou has been prohibited by thy absent Lord from joining thy friends in a close-pitched battle. Dost thou A) refrain, so thou may Honestly claim obedience; or B) show Valor and aid thy comrades, knowing thou may deny it later?',
  'A merchant owes thy friend money, now long past due. Thou dost see the same merchant drop a purse of gold. Dost thou A) Honestly return the purse intact; or B) Justly give thy friend a portion of the gold first?',
  'Thee and thy friend are valiant but penniless warriors. Thou both set forth to slay a mighty dragon. Thy friend dost think he slew it, but the killing blow was thine. Dost thou A) Honestly claim the reward; or B) Sacrifice the gold for the sake of thy friendship?',
  'Thou art sworn to protect thy Lord at any cost, yet thou knowest he hath committed a crime. Authorities ask thee of the affair. Dost thou A) Break thine oath by Honestly speaking; or B) uphold Honor by silently keeping thine oath?',
  'Thy friend doth seek admittance to thy spiritual order. Thou art asked to vouch for his purity of spirit, of which thou art uncertain. Dost thou A) Honestly express thy doubt; or B) Vouch for him, hoping for his Spiritual improvement?',
  'Thy Lord doth mistakenly believe he slew a dragon. Thou hast proof that thy lance felled the beast. When asked, dost thou A) Honestly claim the kill; or B) Humbly permit thy Lord his belief?',
  'Thou dost manage to disarm thy mortal enemy in a duel. He is at thy mercy. Dost thou A) Show Compassion by permitting him to yield; or B) Slay him, as expected of a Valiant duelist?',
  'After twenty years thou hast found the slayer of thy best friends. The villain proves to be a man who provides the sole support for a young girl. Dost thou A) Spare him in Compassion for the child; or B) Slay him in the name of Justice?',
  'Thee and thy friends hath been routed and ordered to retreat. In defiance of thy orders, dost thou A) Stop in Compassion to aid a wounded comrade; or B) Sacrifice thyself to slow the pursuing enemy so that others might escape?',
  'Thou art sworn to uphold a Lord who doth participate in the forbidden torture of prisoners. Each night their cries of pain reach thee. Dost thou A) Show Compassion by reporting the deeds; or B) Honor thy oath and ignore the deeds?',
  'Thou hast been taught to preserve all life as sacred. A man lies fatally stung by a venomous serpent. He prays for a merciful death. Dost thou A) Show Compassion and end his pain; or B) heed thy Spiritual beliefs and turn away?',
  'The Captain of the King\'s Guard asks that one among thee visit a hospital to cheer the children with tales of valiant personal deeds. Dost thou A) Show thy Compassion and play the braggart; or B) Humbly let another go?',
  'Thou hast been sent to secure a needed treaty with a distant Lord. Thy host is agreeable to thy proposal but insults thy country at dinner. Dost thou A) Valiantly bear the slurs; or B) Justly rise and demand an apology?',
  'A burly knight accosts thee and demands thy food. Dost thou A) Valiantly refuse and engage the knight, or B) Sacrifice thy rations unto the hungry knight?',
  'During battle thou art ordered to guard thy commander\'s empty tent. The battle goes poorly and thou dost yearn to aid thy fellows. Dost thou A) Valiantly enter the battle; or B) Honor thy post as guard?',
  'A local bully pushes for a fight. Dost thou A) Valiantly trounce the rogue; or B) Decline, knowing in thy Spirit that no lasting good will come of it?',
  'Although a simple fisherman, thou art also a skillful swordsman. Thy Lord dost seek to assemble a peacetime guard. Dost thou A) Answer the call, so that all may witness thy Valor; or B) Humbly decline the offer to join thy Lord\'s largely ceremonial knighthood?',
  'During a pitched battle, thou dost see a fellow desert his post, endangering many. As he flees, he is set upon by several enemies. Dost thou A) Justly let him fight alone; or B) Risk the Sacrifice of thine own life to aid him?',
  'Thou hast sworn to do thy Lord\'s bidding in all. He covets a piece of land and orders its owner removed. Dost thou A) Serve Justice, refusing to act, thus being disgraced; or B) Honor thine oath and evict the landowner?',
  'Thou dost believe that virtue resides in all people. Thou dost see a rogue steal from thy Lord. Dost thou A) Call him to Justice; or B) Personally try to sway him back to the Spiritual path of good?',
  'Unwitnessed, thou hast slain a mighty dragon in defense of thy life. A poor warrior claims the offered reward. Dost thou A) Justly step forward to claim the bounty; or B) Humbly go about thy life, secure in thy self-esteem?',
  'Thou art a bounty hunter sworn to return an alleged murderer. After his capture, thou dost come to believe him innocent. Dost thou A) Sacrifice thy sizable bounty for thy belief; or B) Honor thine oath to return him as promised?',
  'Thou hast spent thy life in charitable and righteous work. Thine uncle the innkeeper lies ill and asks thee to take over his tavern. Dost thou A) Sacrifice thy life of purity to aid thy kin; or B) Decline and follow the call of Spirituality?',
  'Thou art an elderly, wealthy merchant. Thy end is near. Dost thou A) Sacrifice all thy wealth to feed hundreds of starving children, receiving public adulation; or B) Humbly live out thy life, willing thy fortune to thy heirs?',
  'In thy youth thou didst pledge to marry thy sweetheart. Now thou art on a sacred quest in distant lands. Thy sweetheart doth ask thee to keep thy vow. Dost thou A) Honor thy pledge to wed; or B) Follow thy Spiritual crusade?',
  'Though thou art but a peasant shepherd, thou art discovered to be the sole descendant of a noble family long thought extinct. Dost thou A) Honorably take up the arms of thy ancestors; or B) Humbly resume thy life of simplicity and peace?',
  'Thy parents wish thee to become an apprentice. Two positions are available. Dost thou A) Become an acolyte in a worthy Spiritual order; or B) Become an assistant to a humble village cobbler?',
];

/** The contest in progress: ask `question()`, give `answer('a' | 'b')` until `done`. */
export class Gypsy {
  str = 15;
  dex = 15;
  int = 15;
  /** Questions asked so far, of seven. */
  asked = 0;
  private tbl = [0, 1, 2, 3, 4, 5, 6, 7];
  private round = 0;
  private inRound = 0;
  /** Questions in each round (gypsy_ask_questions(4), (2), (1)). */
  private static ROUNDS = [4, 2, 1];

  constructor(private readonly rand: (n: number) => number = (n) => Math.floor(Math.random() * n)) {
    this.shuffle(8);
  }

  get done(): boolean {
    return this.round >= Gypsy.ROUNDS.length;
  }

  /** The question now: its text, split at its two answers. */
  question(): { text: string; a: string; b: string; virtues: [string, string] } {
    const q = this.current();
    const t = QUESTIONS[q - 0x69];
    const m = t.match(/^(.*?)A\)\s*(.*?)(?:;|,)?\s*or B\)\s*(.*)$/s);
    return { text: m ? m[1].trim() : t, a: m ? m[2].trim() : 'A', b: m ? m[3].trim() : 'B', virtues: [VIRTUES[A[q - 0x69]], VIRTUES[B[q - 0x69]]] };
  }

  answer(which: 'a' | 'b'): void {
    const q = this.current();
    const v = (which === 'a' ? A : B)[q - 0x69];
    this.str += STR[v];
    this.dex += DEX[v];
    this.int += INT[v];
    this.tbl[this.inRound] = v;
    this.asked++;
    if (++this.inRound >= Gypsy.ROUNDS[this.round]) {
      this.inRound = 0;
      this.round++;
      if (this.round === 1) this.shuffle(4);
    }
  }

  private current(): number {
    const i = this.inRound;
    return QUESTION[this.tbl[i * 2] * 8 + this.tbl[i * 2 + 1]];
  }

  /** shuffle_question_tbl */
  private shuffle(len: number): void {
    const c = this.rand(len * len) + len;
    for (let i = 0; i <= c; i++) {
      const j = this.rand(len);
      const k = this.rand(len);
      [this.tbl[j], this.tbl[k]] = [this.tbl[k], this.tbl[j]];
    }
  }
}
