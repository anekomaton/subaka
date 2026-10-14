/**
 * Port of org.alex73.fanetyka.processes.Miakkasc
 */

import { Huk, MIAKKASC_ASIMILACYJNAJA } from '../types';
import { ProcessContext, IProcessMethod } from '../processRunner';

export const miakkascMethods = new Map<string, IProcessMethod>([
  [
    'Змякчэнне перад мяккімі галоснымі',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.miakki = MIAKKASC_ASIMILACYJNAJA;
      return true;
    }
  ],
  [
    'Змякчэнне перад мяккімі зычнымі',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.miakki = MIAKKASC_ASIMILACYJNAJA;
      return true;
    }
  ],
  [
    'Змякчэнне д,т перад мяккімі зычнымі',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.miakki = MIAKKASC_ASIMILACYJNAJA;
      return true;
    }
  ],
  [
    'Змякчэнне дз перад мяккімі зычнымі',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.miakki = MIAKKASC_ASIMILACYJNAJA;
      return true;
    }
  ],
  [
    'Змякчэнне перад мяккімі вф',
    (_context: ProcessContext, h1: Huk | null) => {
      if (!h1) return false;
      h1.miakki = MIAKKASC_ASIMILACYJNAJA;
      return true;
    }
  ]
]);
