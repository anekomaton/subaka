/**
 * BelG2P Process Runner & Process Context
 * Port of org.alex73.fanetyka.impl.ProcessRunner & ProcessContext
 */

import {
  BAZAVY_HUK,
  Case,
  HALOSNYJA,
  HLUCHIJA,
  Huk,
  HukCheck,
  MODE,
  MultiMode,
  PADZIEL_SLOVY,
  PARNYJA_ZVONKIJA,
  SANORNYJA,
  SVIASCIACYJA,
  SYPIACYJA
} from './types';
import { TsvConfig } from './tsvConfig';
import type { Fanetyka3 } from './fanetyka3';

export class ProcessContext {
  huki: Huk[] = [];
  currentPosition: number = 0;

  vydalicPierad(offsetFromCurrent: number) {
    const pos = this.currentPosition + offsetFromCurrent;
    this.huki[pos].zychodnyjaLitary =
      this.huki[pos - 1].zychodnyjaLitary + this.huki[pos].zychodnyjaLitary;
    this.huki[pos].debug = this.huki[pos - 1].debug || this.huki[pos].debug;
    this.huki.splice(pos - 1, 1);
  }

  vydalicPasla(offsetFromCurrent: number) {
    const pos = this.currentPosition + offsetFromCurrent;
    this.huki[pos].zychodnyjaLitary =
      this.huki[pos].zychodnyjaLitary + this.huki[pos + 1].zychodnyjaLitary;
    this.huki[pos].debug = this.huki[pos + 1].debug || this.huki[pos].debug;
    this.huki[pos].padzielPasla =
      this.huki[pos + 1].padzielPasla | this.huki[pos].padzielPasla;
    this.huki.splice(pos + 1, 1);
  }

  dadac(offsetFromCurrent: number, huk: Huk) {
    const pos = this.currentPosition + offsetFromCurrent;
    this.huki.splice(pos, 0, huk);
  }
}

export function checkHukFactory(which: string): (huk: Huk) => boolean {
  switch (which) {
    case 'любы':
      return () => true;
    case 'звонкі':
      return huk => PARNYJA_ZVONKIJA.has(huk.bazavyHuk);
    case 'глухі':
      return huk => HLUCHIJA.has(huk.bazavyHuk);
    case 'галосны':
      return huk => HALOSNYJA.has(huk.bazavyHuk);
    case 'зычны':
      return huk => !HALOSNYJA.has(huk.bazavyHuk);
    case 'шыпячы':
      return huk => SYPIACYJA.has(huk.bazavyHuk);
    case 'свісцячы':
      return huk => SVIASCIACYJA.has(huk.bazavyHuk);
    case 'санорны':
      return huk => SANORNYJA.has(huk.bazavyHuk);
    default:
      return huk => huk.bazavyHuk === which;
  }
}

function checkMode(mode: MODE, val: boolean): boolean {
  switch (mode) {
    case MODE.DONT_CARE:
      return true;
    case MODE.YES:
      return val === true;
    case MODE.NO:
      return val === false;
    case MODE.ERROR:
      return !val;
    default:
      return true;
  }
}

function checkMultiMode(mode: MultiMode, val: number): boolean {
  if (mode.maskError && (mode.maskError & val) !== 0) {
    return false;
  }
  if (mode.maskYes !== 0) {
    return (mode.maskYes & val) !== 0;
  } else if (mode.maskNo !== 0) {
    return (mode.maskNo & val) === 0;
  }
  return true;
}

export function checkRules(c: HukCheck, huk: Huk): boolean {
  if (!checkMultiMode(c.pasziel, huk.padzielPasla)) return false;
  if (!checkMultiMode(c.miakkasc, huk.miakki)) return false;
  if (!checkMode(c.nacisk, huk.stress)) return false;
  return true;
}

export function checkHukMatch(c: HukCheck, huk: Huk): boolean {
  for (const fn of c.whichFunctions) {
    if (fn(huk)) return true;
  }
  return false;
}

export interface IProcessMethod {
  (context: ProcessContext, ...huks: (Huk | null)[]): boolean;
}

export class ProcessRunner {
  config: TsvConfig;
  methods: Map<string, IProcessMethod>;

  constructor(config: TsvConfig, methods: Map<string, IProcessMethod>) {
    this.config = config;
    this.methods = methods;
  }

  process(instance: Fanetyka3) {
    const context = new ProcessContext();
    context.huki = instance.huki;

    for (const caseName of this.config.casesOrder) {
      const handler = this.methods.get(caseName);
      const ca = this.config.cases.get(caseName);
      if (!handler || !ca) continue;

      for (let pos = instance.huki.length; pos >= 0; pos--) {
        context.currentPosition = pos;

        if (context.currentPosition + ca.requiresHuks > instance.huki.length) {
          continue;
        }

        if (!this.checkCase(ca, context)) {
          continue;
        }

        const h1 = context.currentPosition < context.huki.length ? context.huki[context.currentPosition] : null;
        const h2 = context.currentPosition + 1 < context.huki.length ? context.huki[context.currentPosition + 1] : null;
        const h3 = context.currentPosition + 2 < context.huki.length ? context.huki[context.currentPosition + 2] : null;

        handler(context, h1, h2, h3);
      }
    }
  }

  private checkCase(ca: Case, context: ProcessContext): boolean {
    const before = Math.min(context.currentPosition + ca.checks.length, context.huki.length);

    if (ca.borderCheckBefore) {
      let h: Huk;
      if (context.currentPosition > 0) {
        h = context.huki[context.currentPosition - 1];
      } else {
        h = new Huk('', BAZAVY_HUK.а);
        h.padzielPasla = PADZIEL_SLOVY;
      }
      if (!checkRules(ca.borderCheckBefore, h)) {
        return false;
      }
    }

    for (let i = context.currentPosition; i < before; i++) {
      const check = ca.checks[i - context.currentPosition];
      const huk = context.huki[i];
      if (!checkHukMatch(check, huk)) {
        return false;
      }
    }

    for (let i = context.currentPosition; i < before; i++) {
      const check = ca.checks[i - context.currentPosition];
      const huk = context.huki[i];
      if (!checkRules(check, huk)) {
        return false;
      }
    }

    return true;
  }
}
