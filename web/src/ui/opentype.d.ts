declare module 'opentype.js' {
  export class Path {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
  }
  export class Glyph {
    constructor(o: { name: string; unicode: number; advanceWidth: number; path: Path });
  }
  export class Font {
    constructor(o: { familyName: string; styleName: string; unitsPerEm: number; ascender: number; descender: number; glyphs: Glyph[] });
    toArrayBuffer(): ArrayBuffer;
  }
  const opentype: { Path: typeof Path; Glyph: typeof Glyph; Font: typeof Font };
  export default opentype;
}
