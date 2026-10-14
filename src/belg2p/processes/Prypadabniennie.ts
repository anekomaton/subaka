/**
 * Port of org.alex73.fanetyka.processes.Prypadabniennie
 */

import { BAZAVY_HUK, Huk } from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

export const prypadabniennieMethods = new Map<string, IProcessMethod>([
  [
    "Прыпадабненне: ц'-т -> т-т; ц'-ц -> ц-ц",
    (_context: ProcessContext, h1: Huk | null, h2: Huk | null) => {
      if (!h1 || !h2) return false;
      h1.bazavyHuk = h2.bazavyHuk;
      h1.miakki = 0;
      return true;
    }
  ],
  [
    'Прыпадабненне свісцячых па мяккасці',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.miakki = 0;
      return true;
    }
  ],
  [
    'Прыпадабненне: т-ш -> ч-ш пасля галоснага',
    (_context: ProcessContext, _h1: Huk | null, h2: Huk | null) => {
      if (!h2) return false;
      h2.bazavyHuk = BAZAVY_HUK.ч;
      return true;
    }
  ],
  [
    'Прыпадабненне: шумны пярэднеязычны змычны+шумны пярэднеязычны змычна-шчылінны',
    (_context: ProcessContext, _h1: Huk | null, h2: Huk | null, h3: Huk | null) => {
      if (!h2 || !h3) return false;
      h2.bazavyHuk = h3.bazavyHuk;
      return true;
    }
  ],
  [
    'Прыпадабненне: ґ+г -> г:',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.bazavyHuk = BAZAVY_HUK.г;
      return true;
    }
  ],
  [
    'Прыпадабненне: дз+д -> д+д',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.bazavyHuk = BAZAVY_HUK.д;
      h1.miakki = 0;
      return true;
    }
  ]
]);
