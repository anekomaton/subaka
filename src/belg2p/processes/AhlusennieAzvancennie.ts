/**
 * Port of org.alex73.fanetyka.processes.AhlusennieAzvancennie
 */

import { BAZAVY_HUK, Huk, PADZIEL_SLOVY } from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

const PARY = 'б/п, д/т, дз/ц, з/с, ж/ш, дж/ч, г/х, ґ/к';
const ahlusennieMap: Record<string, BAZAVY_HUK> = {};
const azvancennieMap: Record<string, BAZAVY_HUK> = {};

for (const p of PARY.split(',')) {
  const [h1, h2] = p.trim().split('/') as [BAZAVY_HUK, BAZAVY_HUK];
  ahlusennieMap[h1] = h2;
  azvancennieMap[h2] = h1;
}

export const ahlusennieAzvancennieMethods = new Map<string, IProcessMethod>([
  [
    'Аглушэнне',
    (_context: ProcessContext, huk: Huk | null, h2?: Huk | null) => {
      if (!huk) return false;
      // Асобныя літары (напрыклад «ґ», «ж», «б», «д», «з», «г») і часціцы («ж»)
      // не аглушаюцца толькі на канцы выказвання / калі пасля іх няма наступнага глухога зычнага.
      // Калі пасля іх ідзе глухі зычны (напрыклад «з табой», «з хаты», «з печы»),
      // адбываецца рэгрэсіўная асіміляцыя па глухасці (з -> с)!
      const cleanWord = huk.wordContext?.word?.replace(/[\p{M}\+\u00B4]/gu, '').toLowerCase();
      if (!h2 && cleanWord && cleanWord.length === 1 && 'бвгґджзклмнпрстфхцчшў'.includes(cleanWord)) {
        return false;
      }
      const replaceTo = ahlusennieMap[huk.bazavyHuk];
      if (!replaceTo) return false;
      huk.bazavyHuk = replaceTo;
      return true;
    }
  ],
  [
    'Азванчэнне',
    (_context: ProcessContext, huk: Huk | null) => {
      if (!huk) return false;
      const replaceTo = azvancennieMap[huk.bazavyHuk];
      if (!replaceTo) return false;
      huk.bazavyHuk = replaceTo;
      return true;
    }
  ]
]);
