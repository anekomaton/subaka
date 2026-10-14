/**
 * Port of org.alex73.fanetyka.processes.SypiacyjaSvisciacyja
 */

import { BAZAVY_HUK, Huk } from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

const PARY = 'ж/з, ш/с, ч/ц, дж/дз';
const svisciacyjaMap: Record<string, BAZAVY_HUK> = {};
const sypiacyjaMap: Record<string, BAZAVY_HUK> = {};

for (const p of PARY.split(',')) {
  const [syp, svis] = p.trim().split('/') as [BAZAVY_HUK, BAZAVY_HUK];
  svisciacyjaMap[syp] = svis;
  sypiacyjaMap[svis] = syp;
}

export const sypiacyjaSvisciacyjaMethods = new Map<string, IProcessMethod>([
  [
    'Пераход шыпячых перад свісцячымі (ва ўскосных склонах)',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      const target = svisciacyjaMap[h1.bazavyHuk];
      if (!target) return false;
      h1.bazavyHuk = target;
      return true;
    }
  ],
  [
    'Пераход свісцячых у шыпячыя',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      const target = sypiacyjaMap[h1.bazavyHuk];
      if (!target) return false;
      h1.bazavyHuk = target;
      h1.miakki = 0;
      return true;
    }
  ],
  [
    'Пераход шыпячых у свісцячыя',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      const target = svisciacyjaMap[h1.bazavyHuk];
      if (!target) return false;
      h1.bazavyHuk = target;
      return true;
    }
  ]
]);
