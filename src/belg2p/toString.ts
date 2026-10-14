/**
 * BelG2P ToString formatters
 * Port of ToStringBase, ToStringSkolny, ToStringIPA
 */

import {
  BAZAVY_HUK,
  HALOSNYJA,
  Huk,
  PADZIEL_KARANI,
  PADZIEL_PRYNAZOUNIK,
  PADZIEL_PRYSTAUKA,
  PADZIEL_SLOVY,
  PADZIEL_ZLUCOK,
  POUNY_HUK,
  SANORNYJA
} from './types';
import { outSkolnyTxt, outIpaTxt, ipaStressTxt, outIpaTtsTxt } from './dataFiles';

function parseOutputMap(content: string): Map<POUNY_HUK, string> {
  const map = new Map<POUNY_HUK, string>();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.substring(0, eqIdx).trim();
    let val = line.substring(eqIdx + 1).trim();
    // Resolve unicode escape sequences like \u0361
    val = val.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    map.set(key as POUNY_HUK, val);
  }
  return map;
}

export abstract class ToStringBase {
  abstract huk2str(huk: Huk): string;
  abstract getStressCharBefore(): string;
  abstract getStressCharAfter(): string;
  abstract getPadvojenyChar(): string;

  doubleAroundSpace(): boolean {
    return true;
  }

  toString(huki: Huk[]): string {
    let out = '';
    let prevHukStr: string | null = null;

    for (const h of huki) {
      const hukStr = this.huk2str(h);
      if (this.getStressCharBefore() && h.stress) {
        out += this.getStressCharBefore();
      }

      if (!HALOSNYJA.has(h.bazavyHuk) && hukStr === prevHukStr) {
        if (out.endsWith(' ')) {
          if (this.doubleAroundSpace()) {
            out = out.slice(0, -1) + this.getPadvojenyChar();
          } else {
            out += hukStr;
          }
        } else {
          out += this.getPadvojenyChar();
        }
      } else {
        out += hukStr;
      }

      prevHukStr = hukStr;

      if (this.getStressCharAfter() && h.stress) {
        out += this.getStressCharAfter();
      }

      if ((h.padzielPasla & (PADZIEL_SLOVY | PADZIEL_PRYNAZOUNIK)) !== 0) {
        out += ' ';
      }
    }

    return out.trim();
  }
}

export class ToStringSkolny extends ToStringBase {
  private static skolnyMap = parseOutputMap(outSkolnyTxt);

  getStressCharBefore(): string {
    return '';
  }

  getStressCharAfter(): string {
    return '\u0301';
  }

  getPadvojenyChar(): string {
    return ':';
  }

  huk2str(huk: Huk): string {
    return ToStringSkolny.skolnyMap.get(huk.pouny()) || huk.bazavyHuk;
  }
}

enum IPA_TYPE {
  J = 'J',
  H = 'H',
  S = 'S',
  Z = 'Z'
}

class HukChars {
  ipaStressBefore: boolean = false;
  spaceAfter: boolean = false;
  stress: boolean = false;
  padzielPasla: number = 0;
  zycny: boolean = false;
  str: string = '';
  tp: IPA_TYPE;

  constructor(huk: Huk, hukStr: string) {
    this.str = hukStr;
    this.stress = huk.stress;
    this.spaceAfter = (huk.padzielPasla & (PADZIEL_SLOVY | PADZIEL_PRYNAZOUNIK)) !== 0;
    this.padzielPasla = huk.padzielPasla;
    this.zycny = !HALOSNYJA.has(huk.bazavyHuk);

    if (
      huk.bazavyHuk === BAZAVY_HUK.ў ||
      huk.bazavyHuk === BAZAVY_HUK.j ||
      huk.bazavyHuk === BAZAVY_HUK.р
    ) {
      this.tp = IPA_TYPE.J;
    } else if (HALOSNYJA.has(huk.bazavyHuk)) {
      this.tp = IPA_TYPE.H;
    } else if (SANORNYJA.has(huk.bazavyHuk)) {
      this.tp = IPA_TYPE.S;
    } else {
      this.tp = IPA_TYPE.Z;
    }
  }
}

export class ToStringIPA extends ToStringBase {
  public static readonly IPA_STRESS_CHAR = 'ˈ';
  private static ipaMap = parseOutputMap(outIpaTxt);
  private static ipaStresses: Map<string, number> = new Map();

  static {
    for (const rawLine of ipaStressTxt.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const p = line.indexOf('ˈ');
      if (p < 0) continue;
      const s = line.substring(0, p) + line.substring(p + 1);
      ToStringIPA.ipaStresses.set(s, p);
    }
  }

  huk2str(huk: Huk): string {
    return ToStringIPA.ipaMap.get(huk.pouny()) || huk.bazavyHuk;
  }

  getStressCharBefore(): string {
    return '';
  }

  getStressCharAfter(): string {
    return '';
  }

  getPadvojenyChar(): string {
    return 'ː';
  }

  toString(huki: Huk[]): string {
    const hs: HukChars[] = huki.map(h => new HukChars(h, this.huk2str(h)));

    // Gemination / doubling
    for (let i = 1; i < hs.length; i++) {
      const p = hs[i - 1];
      const c = hs[i];
      if (p.zycny && c.zycny && p.str === c.str) {
        p.str += this.getPadvojenyChar();
        p.stress = p.stress || c.stress;
        p.spaceAfter = c.spaceAfter;
        if (i > 1) {
          hs[i - 2].padzielPasla |= p.padzielPasla;
          p.padzielPasla = 0;
        }
        p.padzielPasla |= c.padzielPasla;
        hs.splice(i, 1);
        i--;
      }
    }

    // Mark IPA stress before syllable
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (h.stress) {
        const syllStart = this.getSyllStart(hs, i);
        let pattern = '';
        for (let p = syllStart; p <= i; p++) {
          pattern += hs[p].tp;
        }
        const stressPos = ToStringIPA.ipaStresses.get(pattern);
        if (stressPos !== undefined && hs[syllStart + stressPos]) {
          hs[syllStart + stressPos].ipaStressBefore = true;
        } else {
          hs[syllStart].ipaStressBefore = true;
        }
      }
    }

    if (hs.length > 0) {
      hs[hs.length - 1].spaceAfter = false;
    }

    let out = '';
    for (const h of hs) {
      if (h.ipaStressBefore) {
        out += ToStringIPA.IPA_STRESS_CHAR;
      }
      out += h.str;
      if (h.spaceAfter) {
        out += ' ';
      }
    }

    return out.trim();
  }

  protected getSyllStart(hs: HukChars[], halIndex: number): number {
    let syllStart = 0;
    let syllStartAfterPadziel = -1;

    for (let i = halIndex - 1; i >= 0; i--) {
      const t = hs[i];
      if (t.spaceAfter || (t.padzielPasla & (PADZIEL_KARANI | PADZIEL_ZLUCOK)) !== 0) {
        syllStart = i + 1;
        break;
      }
      if (t.tp === IPA_TYPE.H) {
        if (syllStartAfterPadziel >= 0) {
          syllStart = syllStartAfterPadziel;
        } else {
          syllStart = i;
        }
        break;
      }
      if ((t.padzielPasla & PADZIEL_PRYSTAUKA) !== 0) {
        syllStartAfterPadziel = i + 1;
      }
    }
    return syllStart;
  }
}

/**
 * Канвертавання гукаў у String для IPA, у варыянце для Text-to-Speech.
 * Дакладны порт org.alex73.fanetyka.impl.str.ToStringIPA2TTS з праекта BelG2P.
 *
 * Адрозненні ад звычайнага IPA вываду:
 * - гук не пазначаецца як падвоены на мяжы слоў
 * - выкарыстоўвае спецыяльную карту фанем out_ipa_tts.txt для TTS
 */
export class ToStringIPA2TTS extends ToStringBase {
  private static ipaTtsMap = parseOutputMap(outIpaTtsTxt);

  huk2str(huk: Huk): string {
    return ToStringIPA2TTS.ipaTtsMap.get(huk.pouny()) || huk.bazavyHuk;
  }

  getStressCharBefore(): string {
    return ToStringIPA.IPA_STRESS_CHAR;
  }

  getStressCharAfter(): string {
    return '';
  }

  doubleAroundSpace(): boolean {
    return false;
  }

  getPadvojenyChar(): string {
    return 'ː';
  }
}
