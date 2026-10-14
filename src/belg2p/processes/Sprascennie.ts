/**
 * Port of org.alex73.fanetyka.processes.Sprascennie
 */

import { BAZAVY_HUK, HALOSNYJA, Huk } from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

export const sprascennieMethods = new Map<string, IProcessMethod>([
  [
    'Спрашчэнне: шумны глухі шчылінны пярэднеязычны + шумны глухі змычна-шчылінны пярэднеязычны + шумны глухі змычны',
    (context: ProcessContext) => {
      if (context.currentPosition > 0) {
        const h = context.huki[context.currentPosition - 1];
        if (!HALOSNYJA.has(h.bazavyHuk)) {
          return false;
        }
      }
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: шумны глухі шчылінны + шумны глухі змычны + шумны глухі змычна-шчылінны',
    (context: ProcessContext) => {
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: шумны шчылінны зубны + шумны змычны зубны + санорны носавы',
    (context: ProcessContext) => {
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: шумны шчылінны пярэднеязычны + шумны шчылінны пярэднеязычны + шумны змычны',
    (context: ProcessContext) => {
      context.vydalicPierad(1);
      return true;
    }
  ],
  [
    'Спрашчэнне: зычны + заднеязычны + шумны глухі шчылінны + заднеязычны',
    (context: ProcessContext) => {
      context.vydalicPierad(2);
      return true;
    }
  ],
  [
    'Спрашчэнне: Шумны глухі шчылінны, пярэднеязычны апікальны, зубны + Шумны глухі змычны, пярэднеязычны апікальны, зубны + Шумны глухі шчылінны, пярэднеязычны апікальны, зубны',
    (context: ProcessContext) => {
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: Шумны звонкі шчылінны, пярэднеязычны апікальны, зубны + Шумны звонкі змычны, пярэднеязычны апікальны, зубны + Шумны глухі змычна-шчылінны, пярэднеязычны апікальны, пярэднепаднябенны',
    (context: ProcessContext) => {
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: шумны шчылінны + шумны змычна-шчылінны + мяжа + любы зычны',
    (context: ProcessContext) => {
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: н-т-ш-ч -> н-ш-ч',
    (context: ProcessContext) => {
      context.vydalicPierad(2);
      return true;
    }
  ],
  [
    'Спрашчэнне: н-т-с -> н-с',
    (context: ProcessContext) => {
      context.vydalicPierad(2);
      return true;
    }
  ],
  [
    'Спрашчэнне: т-с не на мяжы -> ц',
    (context: ProcessContext, huk1: Huk | null) => {
      if (!huk1) return false;
      if (
        context.currentPosition > 0 &&
        context.huki[context.currentPosition - 1].bazavyHuk === BAZAVY_HUK.н
      ) {
        return false;
      }
      huk1.bazavyHuk = BAZAVY_HUK.ц;
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Пераход: т-с на мяжы -> ц-с',
    (context: ProcessContext, huk1: Huk | null) => {
      if (!huk1) return false;
      if (
        context.currentPosition > 0 &&
        context.huki[context.currentPosition - 1].bazavyHuk === BAZAVY_HUK.н
      ) {
        return false;
      }
      huk1.bazavyHuk = BAZAVY_HUK.ц;
      return true;
    }
  ],
  [
    'Спрашчэнне: ц-ч -> ч',
    (_context: ProcessContext, _hal: Huk | null, h1: Huk | null) => {
      if (!h1) return false;
      h1.bazavyHuk = BAZAVY_HUK.ч;
      h1.miakki = 0;
      return true;
    }
  ],
  [
    'Спрашчэнне: д-т -> т',
    (context: ProcessContext) => {
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: с-ш -> ш',
    (context: ProcessContext) => {
      context.vydalicPasla(0);
      return true;
    }
  ],
  [
    'Спрашчэнне: шчылінны пярэднепаднябенны цвёрды + шчылінны пярэднепаднябенны цвёрды + шчылінны пярэднепаднябенны цвёрды',
    (context: ProcessContext) => {
      context.vydalicPierad(2);
      return true;
    }
  ],
  [
    'Спрашчэнне: т-ш -> ч-ш, т+ч -> ч на канцы слова',
    (context: ProcessContext) => {
      context.vydalicPierad(1);
      return true;
    }
  ]
]);
