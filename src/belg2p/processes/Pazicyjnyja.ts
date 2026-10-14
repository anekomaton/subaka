/**
 * Port of org.alex73.fanetyka.processes.Pazicyjnyja
 */

import { BAZAVY_HUK, Huk } from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

export const pazicyjnyjaMethods = new Map<string, IProcessMethod>([
  [
    "Білабіяльны 'в'",
    (_context: ProcessContext, huk: Huk | null) => {
      if (!huk) return false;
      huk.bazavyHuk = BAZAVY_HUK.β;
      return true;
    }
  ],
  [
    "Пераход 'ф'->'ў' перад звонкім пасля галоснага",
    (_context: ProcessContext, _huk1: Huk | null, huk2: Huk | null) => {
      if (!huk2) return false;
      huk2.bazavyHuk = BAZAVY_HUK.ў;
      return true;
    }
  ],
  [
    "Пераход 'ф'->'в' перад звонкім пасля зычнага",
    (_context: ProcessContext, _huk1: Huk | null, huk2: Huk | null) => {
      if (!huk2) return false;
      huk2.bazavyHuk = BAZAVY_HUK.в;
      return true;
    }
  ],
  [
    "Губна-зубны 'м'",
    (_context: ProcessContext, huk: Huk | null) => {
      if (!huk) return false;
      huk.bazavyHuk = BAZAVY_HUK.ɱ;
      return true;
    }
  ]
]);
