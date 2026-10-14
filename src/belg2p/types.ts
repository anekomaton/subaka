/**
 * BelG2P Types & Constants
 * Port of org.alex73.fanetyka.impl.Huk, Case, etc.
 */

export enum BAZAVY_HUK {
  а = 'а',
  б = 'б',
  в = 'в',
  β = 'β',
  г = 'г',
  ґ = 'ґ',
  д = 'д',
  э = 'э',
  дж = 'дж',
  дз = 'дз',
  ж = 'ж',
  з = 'з',
  і = 'і',
  к = 'к',
  л = 'л',
  м = 'м',
  ɱ = 'ɱ',
  н = 'н',
  о = 'о',
  п = 'п',
  р = 'р',
  с = 'с',
  т = 'т',
  у = 'у',
  ў = 'ў',
  ф = 'ф',
  х = 'х',
  ц = 'ц',
  ч = 'ч',
  ш = 'ш',
  ы = 'ы',
  j = 'j'
}

export enum POUNY_HUK {
  а = 'а',
  ɐ = 'ɐ',
  б = 'б',
  бь = 'бь',
  в = 'в',
  вь = 'вь',
  β = 'β',
  βь = 'βь',
  г = 'г',
  гь = 'гь',
  ґ = 'ґ',
  ґь = 'ґь',
  д = 'д',
  дь = 'дь',
  э = 'э',
  дж = 'дж',
  дз = 'дз',
  дзь = 'дзь',
  ж = 'ж',
  з = 'з',
  зь = 'зь',
  і = 'і',
  к = 'к',
  кь = 'кь',
  л = 'л',
  ль = 'ль',
  м = 'м',
  мь = 'мь',
  ɱ = 'ɱ',
  н = 'н',
  нь = 'нь',
  о = 'о',
  п = 'п',
  пь = 'пь',
  р = 'р',
  с = 'с',
  сь = 'сь',
  т = 'т',
  ть = 'ть',
  у = 'у',
  ў = 'ў',
  ф = 'ф',
  фь = 'фь',
  х = 'х',
  хь = 'хь',
  ц = 'ц',
  ць = 'ць',
  ч = 'ч',
  ш = 'ш',
  ы = 'ы',
  ə = 'ə',
  j = 'j'
}

export const PADZIEL_SLOVY = 0x0001;
export const PADZIEL_PRYNAZOUNIK = 0x0002;
export const PADZIEL_ZLUCOK = 0x0004;
export const PADZIEL_APOSTRAF = 0x0008;
export const PADZIEL_PRYSTAUKA = 0x0010;
export const PADZIEL_KARANI = 0x0020;

export const MIAKKASC_PAZNACANAJA = 0x01;
export const MIAKKASC_ASIMILACYJNAJA = 0x02;

export const HALOSNYJA = new Set<BAZAVY_HUK>([
  BAZAVY_HUK.а,
  BAZAVY_HUK.э,
  BAZAVY_HUK.і,
  BAZAVY_HUK.о,
  BAZAVY_HUK.у,
  BAZAVY_HUK.ы
]);

export const PARNYJA_ZVONKIJA = new Set<BAZAVY_HUK>([
  BAZAVY_HUK.б,
  BAZAVY_HUK.д,
  BAZAVY_HUK.дз,
  BAZAVY_HUK.з,
  BAZAVY_HUK.ж,
  BAZAVY_HUK.дж,
  BAZAVY_HUK.г,
  BAZAVY_HUK.ґ
]);

export const HLUCHIJA = new Set<BAZAVY_HUK>([
  BAZAVY_HUK.п,
  BAZAVY_HUK.т,
  BAZAVY_HUK.ц,
  BAZAVY_HUK.с,
  BAZAVY_HUK.ш,
  BAZAVY_HUK.ч,
  BAZAVY_HUK.х,
  BAZAVY_HUK.к,
  BAZAVY_HUK.ф
]);

export const SYPIACYJA = new Set<BAZAVY_HUK>([
  BAZAVY_HUK.ж,
  BAZAVY_HUK.ш,
  BAZAVY_HUK.ч,
  BAZAVY_HUK.дж
]);

export const SVIASCIACYJA = new Set<BAZAVY_HUK>([
  BAZAVY_HUK.з,
  BAZAVY_HUK.с,
  BAZAVY_HUK.ц,
  BAZAVY_HUK.дз
]);

export const SANORNYJA = new Set<BAZAVY_HUK>([
  BAZAVY_HUK.ў,
  BAZAVY_HUK.j,
  BAZAVY_HUK.л,
  BAZAVY_HUK.м,
  BAZAVY_HUK.н,
  BAZAVY_HUK.р,
  BAZAVY_HUK.в,
  BAZAVY_HUK.β,
  BAZAVY_HUK.ɱ
]);

export interface WordContext {
  word: string;
  amonimy?: any[];
  asnounaja?: any;
}

export class Huk {
  zychodnyjaLitary: string;
  bazavyHuk: BAZAVY_HUK;
  padzielPasla: number = 0;
  miakki: number = 0;
  stress: boolean = false;
  redukavany: boolean = false;
  debug: boolean = false;
  wordContext: WordContext = { word: '' };

  constructor(zychodnyjaLitary: string, bazavyHuk: BAZAVY_HUK) {
    this.zychodnyjaLitary = zychodnyjaLitary;
    this.bazavyHuk = bazavyHuk;
  }

  pouny(): POUNY_HUK {
    switch (this.bazavyHuk) {
      case BAZAVY_HUK.а:
        return this.redukavany ? POUNY_HUK.ɐ : POUNY_HUK.а;
      case BAZAVY_HUK.б:
        return this.miakki === 0 ? POUNY_HUK.б : POUNY_HUK.бь;
      case BAZAVY_HUK.в:
        return this.miakki === 0 ? POUNY_HUK.в : POUNY_HUK.вь;
      case BAZAVY_HUK.β:
        return this.miakki === 0 ? POUNY_HUK.β : POUNY_HUK.βь;
      case BAZAVY_HUK.г:
        return this.miakki === 0 ? POUNY_HUK.г : POUNY_HUK.гь;
      case BAZAVY_HUK.ґ:
        return this.miakki === 0 ? POUNY_HUK.ґ : POUNY_HUK.ґь;
      case BAZAVY_HUK.д:
        return this.miakki === 0 ? POUNY_HUK.д : POUNY_HUK.дь;
      case BAZAVY_HUK.э:
        return POUNY_HUK.э;
      case BAZAVY_HUK.дж:
        return POUNY_HUK.дж;
      case BAZAVY_HUK.дз:
        return this.miakki === 0 ? POUNY_HUK.дз : POUNY_HUK.дзь;
      case BAZAVY_HUK.ж:
        return POUNY_HUK.ж;
      case BAZAVY_HUK.з:
        return this.miakki === 0 ? POUNY_HUK.з : POUNY_HUK.зь;
      case BAZAVY_HUK.і:
        return POUNY_HUK.і;
      case BAZAVY_HUK.к:
        return this.miakki === 0 ? POUNY_HUK.к : POUNY_HUK.кь;
      case BAZAVY_HUK.л:
        return this.miakki === 0 ? POUNY_HUK.л : POUNY_HUK.ль;
      case BAZAVY_HUK.м:
        return this.miakki === 0 ? POUNY_HUK.м : POUNY_HUK.мь;
      case BAZAVY_HUK.ɱ:
        return POUNY_HUK.ɱ;
      case BAZAVY_HUK.н:
        return this.miakki === 0 ? POUNY_HUK.н : POUNY_HUK.нь;
      case BAZAVY_HUK.о:
        return POUNY_HUK.о;
      case BAZAVY_HUK.п:
        return this.miakki === 0 ? POUNY_HUK.п : POUNY_HUK.пь;
      case BAZAVY_HUK.р:
        return POUNY_HUK.р;
      case BAZAVY_HUK.с:
        return this.miakki === 0 ? POUNY_HUK.с : POUNY_HUK.сь;
      case BAZAVY_HUK.т:
        return this.miakki === 0 ? POUNY_HUK.т : POUNY_HUK.ть;
      case BAZAVY_HUK.у:
        return POUNY_HUK.у;
      case BAZAVY_HUK.ў:
        return POUNY_HUK.ў;
      case BAZAVY_HUK.ф:
        return this.miakki === 0 ? POUNY_HUK.ф : POUNY_HUK.фь;
      case BAZAVY_HUK.х:
        return this.miakki === 0 ? POUNY_HUK.х : POUNY_HUK.хь;
      case BAZAVY_HUK.ц:
        return this.miakki === 0 ? POUNY_HUK.ц : POUNY_HUK.ць;
      case BAZAVY_HUK.ч:
        return POUNY_HUK.ч;
      case BAZAVY_HUK.ш:
        return POUNY_HUK.ш;
      case BAZAVY_HUK.ы:
        return this.redukavany ? POUNY_HUK.ə : POUNY_HUK.ы;
      case BAZAVY_HUK.j:
        return POUNY_HUK.j;
      default:
        return POUNY_HUK.а;
    }
  }
}

export enum MODE {
  DONT_CARE = 'DONT_CARE',
  YES = 'YES',
  NO = 'NO',
  ERROR = 'ERROR'
}

export interface MultiMode {
  maskYes: number;
  maskNo: number;
  maskError: number;
}

export class HukCheck {
  which: string[] = [];
  whichFunctions: ((huk: Huk) => boolean)[] = [];
  pasziel: MultiMode = { maskYes: 0, maskNo: 0, maskError: 0 };
  miakkasc: MultiMode = { maskYes: 0, maskNo: 0, maskError: 0 };
  nacisk: MODE = MODE.DONT_CARE;
  optionalHuk: boolean = false;
}

export class Case {
  name: string = '';
  details: string = '';
  changeDescription: string = '';
  borderCheckBefore: HukCheck | null = null;
  checks: HukCheck[] = [];
  requiresHuks: number = 0;
  table: string[][] = [];
}

export interface TypZmiahcennia {
  nievyznacana?: boolean;
  zmiahcajecca?: boolean;
  pierakrocvajeMiezyUsizredzinieSlova?: boolean;
  pierakrocvajeMiezySlou?: boolean;
}

export class CaseCross {
  values: Record<string, Record<string, TypZmiahcennia>> = {};
  table: string[][] = [];
}
