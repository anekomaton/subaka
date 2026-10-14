/**
 * BelG2P Main Phonetic Engine
 * Port of org.alex73.fanetyka.impl.Fanetyka3
 */

import { BAZAVY_HUK, HALOSNYJA, Huk, PADZIEL_PRYNAZOUNIK } from './types';
import { TsvConfig, TsvCrossConfig } from './tsvConfig';
import { ProcessRunner } from './processRunner';
import { ProcessCrossRunner } from './processCrossRunner';
import { ToStringBase, ToStringIPA, ToStringSkolny } from './toString';

import {
  ahlusennieTsv,
  miakkascTsv,
  pazicyjnyjaTsv,
  prypadabniennieTsv,
  redukavanyjaTsv,
  sprascennieTsv,
  sypiacyjaTsv,
  ustaunyJTsv
} from './dataFiles';

// Import process handlers
import { ahlusennieAzvancennieMethods } from './processes/AhlusennieAzvancennie';
import { pazicyjnyjaMethods } from './processes/Pazicyjnyja';
import { prypadabniennieMethods } from './processes/Prypadabniennie';
import { redukavanyjaMethods } from './processes/Redukavanyja';
import { sprascennieMethods } from './processes/Sprascennie';
import { sypiacyjaSvisciacyjaMethods } from './processes/SypiacyjaSvisciacyja';
import { ustaunyJMethods } from './processes/UstaunyJ';

export class Fanetyka3 {
  huki: Huk[] = [];

  private static ustaunyJRunner: ProcessRunner;
  private static miakkascCrossRunner: ProcessCrossRunner;
  private static sprascennieRunner: ProcessRunner;
  private static prypadabniennieRunner: ProcessRunner;
  private static ahlusennieAzvancennieRunner: ProcessRunner;
  private static sypiacyjaRunner: ProcessRunner;
  private static redukavanyjaRunner: ProcessRunner;
  private static pazicyjnyjaRunner: ProcessRunner;
  private static ipaFormatter: ToStringIPA;
  private static skolnyFormatter: ToStringSkolny;
  private static initialized = false;

  private static init() {
    if (this.initialized) return;
    this.ustaunyJRunner = new ProcessRunner(
      new TsvConfig('UstaunyJ', ustaunyJTsv),
      ustaunyJMethods
    );
    this.miakkascCrossRunner = new ProcessCrossRunner(
      new TsvCrossConfig('Miakkasc', miakkascTsv)
    );
    this.sprascennieRunner = new ProcessRunner(
      new TsvConfig('Sprascennie', sprascennieTsv),
      sprascennieMethods
    );
    this.prypadabniennieRunner = new ProcessRunner(
      new TsvConfig('Prypadabniennie', prypadabniennieTsv),
      prypadabniennieMethods
    );
    this.ahlusennieAzvancennieRunner = new ProcessRunner(
      new TsvConfig('AhlusennieAzvancennie', ahlusennieTsv),
      ahlusennieAzvancennieMethods
    );
    this.sypiacyjaRunner = new ProcessRunner(
      new TsvConfig('SypiacyjaSvisciacyja', sypiacyjaTsv),
      sypiacyjaSvisciacyjaMethods
    );
    this.redukavanyjaRunner = new ProcessRunner(
      new TsvConfig('Redukavanyja', redukavanyjaTsv),
      redukavanyjaMethods
    );
    this.pazicyjnyjaRunner = new ProcessRunner(
      new TsvConfig('Pazicyjnyja', pazicyjnyjaTsv),
      pazicyjnyjaMethods
    );
    this.ipaFormatter = new ToStringIPA();
    this.skolnyFormatter = new ToStringSkolny();
    this.initialized = true;
  }

  constructor(huki: Huk[]) {
    Fanetyka3.init();
    this.huki = huki;
  }

  process() {
    this.jakannie();
    this.vybuchnojeG();

    let lastDump = Fanetyka3.ipaFormatter.toString(this.huki);
    let iterations = 0;

    while (iterations < 50) {
      this.vybuchnojeG();
      Fanetyka3.ustaunyJRunner.process(this);
      Fanetyka3.miakkascCrossRunner.process(this);
      Fanetyka3.sprascennieRunner.process(this);
      Fanetyka3.prypadabniennieRunner.process(this);
      Fanetyka3.ahlusennieAzvancennieRunner.process(this);
      Fanetyka3.sypiacyjaRunner.process(this);
      Fanetyka3.redukavanyjaRunner.process(this);
      Fanetyka3.pazicyjnyjaRunner.process(this);

      const currentDump = Fanetyka3.ipaFormatter.toString(this.huki);
      if (currentDump === lastDump) {
        break;
      }
      lastDump = currentDump;
      iterations++;
    }
  }

  private vybuchnojeG() {
    // Паводле правілаў беларускай арфаэпіі:
    // Пасля свісцячых [з], [дз] гук [г] вымаўляецца як выбухны [ґ] (у тым ліку на мяжы прыназоўніка ці прыстаўкі)
    for (let i = 0; i < this.huki.length - 1; i++) {
      const h0 = this.huki[i];
      const h1 = this.huki[i + 1];
      if (
        (h0.bazavyHuk === BAZAVY_HUK.з || h0.bazavyHuk === BAZAVY_HUK.дз) &&
        h1.bazavyHuk === BAZAVY_HUK.г
      ) {
        h1.bazavyHuk = BAZAVY_HUK.ґ;
      }
    }
  }

  private jakannie() {
    for (let i = 0; i < this.huki.length - 2; i++) {
      const h0 = this.huki[i];
      const h1 = this.huki[i + 1];

      // Check 'не'
      if (h0.bazavyHuk === BAZAVY_HUK.н && h1.bazavyHuk === BAZAVY_HUK.э) {
        if ((h1.padzielPasla & PADZIEL_PRYNAZOUNIK) !== 0) {
          if (this.isFirstSyllableStressed(i + 2)) {
            h1.bazavyHuk = BAZAVY_HUK.а;
          }
        }
      } else if (i < this.huki.length - 3) {
        // Check 'без'
        const h2 = this.huki[i + 2];
        if (
          h0.bazavyHuk === BAZAVY_HUK.б &&
          h1.bazavyHuk === BAZAVY_HUK.э &&
          h2.bazavyHuk === BAZAVY_HUK.з
        ) {
          if ((h2.padzielPasla & PADZIEL_PRYNAZOUNIK) !== 0) {
            if (this.isFirstSyllableStressed(i + 3)) {
              h1.bazavyHuk = BAZAVY_HUK.а;
            }
          }
        }
      }
    }
  }

  private isFirstSyllableStressed(fromIndex: number): boolean {
    for (let i = fromIndex; i < this.huki.length; i++) {
      const h = this.huki[i];
      if (HALOSNYJA.has(h.bazavyHuk)) {
        return h.stress;
      }
    }
    return false;
  }

  toString(formatter?: ToStringBase): string {
    const fmt = formatter || Fanetyka3.skolnyFormatter;
    return fmt.toString(this.huki);
  }

  toIPA(): string {
    return Fanetyka3.ipaFormatter.toString(this.huki);
  }
}
