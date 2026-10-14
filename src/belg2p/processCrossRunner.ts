/**
 * BelG2P Process Cross Runner (Softness Assimilation Matrix)
 * Port of org.alex73.fanetyka.impl.ProcessCrossRunner
 */

import {
  Huk,
  MIAKKASC_ASIMILACYJNAJA,
  PADZIEL_APOSTRAF,
  PADZIEL_KARANI,
  PADZIEL_PRYNAZOUNIK,
  PADZIEL_PRYSTAUKA,
  PADZIEL_SLOVY,
  PADZIEL_ZLUCOK
} from './types';
import { TsvCrossConfig } from './tsvConfig';
import type { Fanetyka3 } from './fanetyka3';

export class ProcessCrossRunner {
  config: TsvCrossConfig;

  constructor(config: TsvCrossConfig) {
    this.config = config;
  }

  process(instance: Fanetyka3) {
    const ca = this.config.cross;

    for (let pos = instance.huki.length - 2; pos >= 0; pos--) {
      const h1 = instance.huki[pos];
      const h2 = instance.huki[pos + 1];

      // Second sound must be soft, first sound must not already be soft
      if (h2.miakki === 0 || h1.miakki !== 0) {
        continue;
      }

      const zm = ca.values[h1.bazavyHuk]?.[h2.bazavyHuk];
      if (zm && zm.zmiahcajecca) {
        if (this.miazaSlou(h1)) {
          if (zm.pierakrocvajeMiezySlou) {
            h1.miakki = MIAKKASC_ASIMILACYJNAJA;
          }
        } else if (this.miazaUsiaredzinieSlova(h1)) {
          if (zm.pierakrocvajeMiezyUsizredzinieSlova) {
            h1.miakki = MIAKKASC_ASIMILACYJNAJA;
          }
        } else {
          h1.miakki = MIAKKASC_ASIMILACYJNAJA;
        }
      }
    }
  }

  private miazaUsiaredzinieSlova(h1: Huk): boolean {
    const mask =
      PADZIEL_KARANI |
      PADZIEL_PRYSTAUKA |
      PADZIEL_PRYNAZOUNIK |
      PADZIEL_APOSTRAF;
    return (h1.padzielPasla & mask) !== 0;
  }

  private miazaSlou(h1: Huk): boolean {
    const mask = PADZIEL_ZLUCOK | PADZIEL_SLOVY;
    return (h1.padzielPasla & mask) !== 0;
  }
}
