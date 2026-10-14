/**
 * Port of org.alex73.fanetyka.processes.UstaunyJ
 */

import { BAZAVY_HUK, Huk, MIAKKASC_PAZNACANAJA } from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

function jot(): Huk {
  const j = new Huk('', BAZAVY_HUK.j);
  j.miakki = MIAKKASC_PAZNACANAJA;
  return j;
}

export const ustaunyJMethods = new Map<string, IProcessMethod>([
  [
    "Злучнік 'і' пераходзіць у 'й'",
    (_context: ProcessContext, _h1: Huk | null, h2: Huk | null, h3: Huk | null) => {
      if (!h2) return false;
      if (h3 && h3.bazavyHuk === BAZAVY_HUK.ў) {
        return false;
      }
      h2.bazavyHuk = BAZAVY_HUK.j;
      return true;
    }
  ],
  [
    "Пераход 'і' ў 'йі' напачатку слова пад націскам",
    (context: ProcessContext) => {
      context.dadac(0, jot());
      return true;
    }
  ],
  [
    "Пераход 'і' ў 'й' напачатку слова не пад націскам",
    (_context: ProcessContext, _h1: Huk | null, h2: Huk | null) => {
      if (!h2) return false;
      h2.bazavyHuk = BAZAVY_HUK.j;
      return true;
    }
  ],
  [
    "Пераход 'і' ў 'ы' пасля цвёрдага зычнага і мяжы (ці апострафа)",
    (_context: ProcessContext, _h1: Huk | null, h2: Huk | null) => {
      if (!h2) return false;
      h2.bazavyHuk = BAZAVY_HUK.ы;
      h2.miakki = 0;
      return true;
    }
  ],
  [
    "Пераход 'і' ў 'йі' пасля галоснай і 'ў' у сярэдзіне слова",
    (context: ProcessContext) => {
      context.dadac(1, jot());
      return true;
    }
  ],
  [
    'Дадаецца j перад галоснай на пачатку слова ці пасля падзелу',
    (context: ProcessContext) => {
      context.dadac(0, jot());
      return true;
    }
  ],
  [
    'Дадаецца j перад галоснай пасля апострафу',
    (context: ProcessContext) => {
      context.dadac(0, jot());
      return true;
    }
  ],
  [
    "Дадаецца j перад галоснай пасля галоснай ці 'ў т д р ж ш ч'",
    (context: ProcessContext) => {
      context.dadac(1, jot());
      return true;
    }
  ],
  [
    "Пераход 'і' ў 'йі' пасля прыстаўкі на галосную, 'ў' ці 'j'",
    (context: ProcessContext) => {
      context.dadac(1, jot());
      return true;
    }
  ],
  [
    "Дадаецца 'j' перад галоснай пасля прыстаўкі на '-j'",
    (context: ProcessContext) => {
      context.dadac(1, jot());
      return true;
    }
  ],
  [
    "Пераход 'і' ў 'йі' пасля мяккага зычнага",
    (context: ProcessContext, h1: Huk | null) => {
      if (h1 && h1.bazavyHuk === BAZAVY_HUK.j) {
        return false;
      }
      context.dadac(1, jot());
      return true;
    }
  ],
  [
    'Дадаецца j перад галоснай пасля мяккага',
    (context: ProcessContext, h1: Huk | null) => {
      if (h1 && h1.bazavyHuk === BAZAVY_HUK.j) {
        return false;
      }
      context.dadac(1, jot());
      return true;
    }
  ]
]);
