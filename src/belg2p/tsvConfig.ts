/**
 * BelG2P TSV Config Parsers
 * Port of org.alex73.fanetyka.config.TsvConfig and TsvCrossConfig
 */

import {
  Case,
  CaseCross,
  HukCheck,
  MODE,
  MultiMode,
  PADZIEL_APOSTRAF,
  PADZIEL_PRYSTAUKA,
  PADZIEL_PRYNAZOUNIK,
  PADZIEL_KARANI,
  PADZIEL_SLOVY,
  PADZIEL_ZLUCOK,
  MIAKKASC_ASIMILACYJNAJA,
  MIAKKASC_PAZNACANAJA,
  TypZmiahcennia
} from './types';
import { checkHukFactory } from './processRunner';

export const TASK_HEADERS = [
  'Умовы:',
  'якія гукі',
  'апостраф',
  'прыстаўка+(прыстаўка ці корань)',
  'корань+корань',
  'мяжа слова',
  'злучок',
  'мяккасць - асіміляцыйная',
  'мяккасць - пазначаная',
  'націск'
];

function splitLine(s: string): string[] {
  return s.split('\t');
}

export class TsvConfig {
  configName: string;
  cases: Map<string, Case> = new Map();
  casesOrder: string[] = [];

  constructor(configName: string, content: string) {
    this.configName = configName;
    const lines = content.replace(/\r/g, '').split('\n').map(splitLine);
    this.parse(lines);
  }

  private parse(lines: string[][]) {
    let lineIndex = 0;
    while (lineIndex < lines.length) {
      // Find start of task
      while (
        lineIndex < lines.length &&
        (lines[lineIndex].length === 0 || !lines[lineIndex][0] || lines[lineIndex][0].trim() === '')
      ) {
        lineIndex++;
      }
      if (lineIndex >= lines.length) break;

      const line = lines[lineIndex];
      if (line[0].trim() !== "З'ява:") {
        throw new Error(`[${this.configName}#${lineIndex + 1}] Expected "З'ява:", got "${line[0]}"`);
      }

      const t = new Case();
      t.name = line[1]?.trim() || '';
      if (!t.name) {
        throw new Error(`[${this.configName}#${lineIndex + 1}] Missing case name`);
      }
      if (this.cases.has(t.name)) {
        throw new Error(`[${this.configName}#${lineIndex + 1}] Duplicate case name: ${t.name}`);
      }
      this.cases.set(t.name, t);
      this.casesOrder.push(t.name);
      lineIndex++;

      // Details
      const detLine = lines[lineIndex];
      if (detLine[0]?.trim() !== 'Падрабязнасці:') {
        throw new Error(`[${this.configName}#${lineIndex + 1}] Expected "Падрабязнасці:"`);
      }
      t.details = detLine[1]?.trim() || '';
      lineIndex++;

      // What happens
      const chLine = lines[lineIndex];
      if (chLine[0]?.trim() !== 'Што адбываецца:') {
        throw new Error(`[${this.configName}#${lineIndex + 1}] Expected "Што адбываецца:"`);
      }
      t.changeDescription = chLine[1]?.trim() || '';
      lineIndex++;

      // Skip empty leading column comments
      while (lineIndex < lines.length && (!lines[lineIndex][0] || lines[lineIndex][0].trim() === '')) {
        lineIndex++;
      }

      // Parse table
      this.parseTable(t, lines, lineIndex);
      lineIndex += TASK_HEADERS.length;
    }
  }

  private parseTable(t: Case, lines: string[][], lineIndex: number) {
    for (let i = 0; i < TASK_HEADERS.length; i++) {
      if (lines[lineIndex + i][0].trim() !== TASK_HEADERS[i]) {
        throw new Error(
          `[${this.configName}#${lineIndex + i + 1}] Expected "${TASK_HEADERS[i]}", got "${lines[lineIndex + i][0]}"`
        );
      }
    }

    let hukIndex = 1;
    let byuHuk: boolean | null = null;
    let check: HukCheck | null = null;

    const headerLine = lines[lineIndex];
    for (let c = 1; c < headerLine.length; c++) {
      const header = headerLine[c]?.trim() || '';
      if (!header) {
        break;
      }

      if (header === 'мяжа') {
        if (byuHuk === null) {
          // Border before first sound
          t.borderCheckBefore = check = new HukCheck();
        } else if (!byuHuk) {
          throw new Error(`[${this.configName}] Border column after border column`);
        }
        if (check) {
          this.readMultiMode(lines, lineIndex, 2, c, check.pasziel, PADZIEL_APOSTRAF);
          this.readMultiMode(lines, lineIndex, 3, c, check.pasziel, PADZIEL_PRYSTAUKA | PADZIEL_PRYNAZOUNIK);
          this.readMultiMode(lines, lineIndex, 4, c, check.pasziel, PADZIEL_KARANI);
          this.readMultiMode(lines, lineIndex, 5, c, check.pasziel, PADZIEL_SLOVY);
          this.readMultiMode(lines, lineIndex, 6, c, check.pasziel, PADZIEL_ZLUCOK);
        }
        byuHuk = false;
      } else if (
        header === `гук ${hukIndex}` ||
        header === `гук ${hukIndex} (неабавязковы)`
      ) {
        check = new HukCheck();
        t.checks.push(check);
        check.which = this.readHuki(lines, lineIndex, 1, c);
        check.whichFunctions = check.which.map(w => checkHukFactory(w));

        this.readMultiMode(lines, lineIndex, 7, c, check.miakkasc, MIAKKASC_ASIMILACYJNAJA);
        this.readMultiMode(lines, lineIndex, 8, c, check.miakkasc, MIAKKASC_PAZNACANAJA);
        check.nacisk = this.readMode(lines, lineIndex, 9, c);

        if (header.includes('неабавязковы')) {
          check.optionalHuk = true;
        } else {
          t.requiresHuks++;
        }
        byuHuk = true;
        hukIndex++;
      } else {
        // examples column or comment
        break;
      }
    }
  }

  private readHuki(lines: string[][], lineIndex: number, lineOffset: number, column: number): string[] {
    const val = lines[lineIndex + lineOffset][column]?.trim() || '';
    return val.split(/\s+/).filter(Boolean);
  }

  private readMode(lines: string[][], lineIndex: number, lineOffset: number, column: number): MODE {
    const val = lines[lineIndex + lineOffset][column]?.trim() || '';
    switch (val) {
      case '':
        return MODE.DONT_CARE;
      case 'так':
        return MODE.YES;
      case 'не':
        return MODE.NO;
      case '-':
        return MODE.ERROR;
      default:
        throw new Error(`[${this.configName}] Invalid mode: "${val}"`);
    }
  }

  private readMultiMode(
    lines: string[][],
    lineIndex: number,
    lineOffset: number,
    column: number,
    multiMode: MultiMode,
    mask: number
  ) {
    const val = lines[lineIndex + lineOffset][column]?.trim() || '';
    switch (val) {
      case '':
        break;
      case 'так':
        multiMode.maskYes |= mask;
        break;
      case 'не':
        multiMode.maskNo |= mask;
        break;
      case '-':
        multiMode.maskError |= mask;
        break;
      default:
        throw new Error(`[${this.configName}] Invalid multi-mode: "${val}"`);
    }
  }
}

export class TsvCrossConfig {
  configName: string;
  cross: CaseCross;

  constructor(configName: string, content: string) {
    this.configName = configName;
    const lines = content.replace(/\r/g, '').split('\n').map(splitLine);
    this.cross = this.parse(lines);
  }

  private parse(lines: string[][]): CaseCross {
    let lineIndex = 0;
    while (
      lineIndex < lines.length &&
      (lines[lineIndex].length === 0 || !lines[lineIndex][0] || lines[lineIndex][0].trim() === '')
    ) {
      lineIndex++;
    }

    const headerLine = lines[lineIndex];
    const cols: string[] = [];
    for (let c = 1; c < headerLine.length; c++) {
      const v = headerLine[c]?.trim();
      if (v) cols.push(v);
    }

    const rows: string[] = [];
    for (let r = lineIndex + 1; r < lines.length; r++) {
      const c = lines[r][0]?.trim();
      if (!c) break;
      rows.push(c);
    }

    const cross = new CaseCross();
    for (let col = 0; col < cols.length; col++) {
      for (let row = 0; row < rows.length; row++) {
        const h1 = rows[row];
        const h2 = cols[col];
        let text = lines[lineIndex + 1 + row][1 + col]?.trim() || '';
        text = text.replace(/\?$/, '');

        const zm: TypZmiahcennia = {};
        if (text === h1 + h2) {
          zm.zmiahcajecca = true;
        } else if (text.startsWith(h1 + h2)) {
          zm.zmiahcajecca = true;
          const suffix = text.substring((h1 + h2).length);
          switch (suffix) {
            case '*':
              zm.pierakrocvajeMiezyUsizredzinieSlova = true;
              break;
            case '+':
              zm.pierakrocvajeMiezySlou = true;
              break;
            case '+*':
            case '*+':
              zm.pierakrocvajeMiezyUsizredzinieSlova = true;
              zm.pierakrocvajeMiezySlou = true;
              break;
            default:
              break;
          }
        } else if (!text) {
          zm.nievyznacana = true;
        }

        if (!cross.values[h1]) {
          cross.values[h1] = {};
        }
        cross.values[h1][h2] = zm;
      }
    }

    return cross;
  }
}
