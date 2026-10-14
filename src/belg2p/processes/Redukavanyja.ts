/**
 * Port of org.alex73.fanetyka.processes.Redukavanyja
 */

import {
  BAZAVY_HUK,
  HALOSNYJA,
  Huk,
  PADZIEL_SLOVY,
  PADZIEL_ZLUCOK
} from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

enum PLACE_TYPE {
  NONE = 'NONE',
  ROOT = 'ROOT',
  SUFFIX = 'SUFFIX'
}

function inRoot(context: ProcessContext): PLACE_TYPE {
  let stressesBefore = 0;
  let stressesAfter = 0;
  let syllBefore = 0;
  let syllAfter = 0;

  for (let i = context.currentPosition - 1; i >= 0; i--) {
    const h = context.huki[i];
    if ((h.padzielPasla & (PADZIEL_SLOVY | PADZIEL_ZLUCOK)) !== 0) {
      break;
    }
    if (HALOSNYJA.has(h.bazavyHuk)) {
      syllBefore++;
    }
    if (h.stress) {
      stressesBefore++;
    }
  }

  for (let i = context.currentPosition; i < context.huki.length; i++) {
    const h = context.huki[i];
    if (HALOSNYJA.has(h.bazavyHuk)) {
      syllAfter++;
    }
    if (h.stress) {
      stressesAfter++;
    }
    if ((h.padzielPasla & (PADZIEL_SLOVY | PADZIEL_ZLUCOK)) !== 0) {
      break;
    }
  }

  if (syllBefore === 0 && syllAfter === 0) {
    return PLACE_TYPE.NONE;
  } else if (syllAfter === 0) {
    return PLACE_TYPE.SUFFIX;
  } else if (stressesAfter > 0) {
    return PLACE_TYPE.ROOT;
  } else if (syllAfter === 1 && syllBefore > 1) {
    return PLACE_TYPE.SUFFIX;
  } else if (syllAfter === 1 && stressesBefore > 0) {
    return PLACE_TYPE.SUFFIX;
  } else {
    return PLACE_TYPE.ROOT;
  }
}

export const redukavanyjaMethods = new Map<string, IProcessMethod>([
  [
    "Устаўны 'а' перад цвёрдым 'р' пасля зычных акрамя р,j,ў",
    (context: ProcessContext) => {
      const place = inRoot(context);
      if (place === PLACE_TYPE.NONE) return false;
      const h = new Huk('', place === PLACE_TYPE.ROOT ? BAZAVY_HUK.ы : BAZAVY_HUK.а);
      h.redukavany = true;
      context.dadac(1, h);
      return true;
    }
  ],
  [
    "Устаўны 'а' перад мяккім 'л'",
    (context: ProcessContext) => {
      const place = inRoot(context);
      if (place === PLACE_TYPE.NONE) return false;
      const h = new Huk('', place === PLACE_TYPE.ROOT ? BAZAVY_HUK.ы : BAZAVY_HUK.а);
      h.redukavany = true;
      context.dadac(1, h);
      return true;
    }
  ]
]);
