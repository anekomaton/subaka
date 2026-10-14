/**
 * BelG2P: Афіцыйны фанетычны канвертар беларускай мовы
 * Выкарыстоўвае выключна рухавік і арыгінальныя канфігурацыйныя файлы праекта BelG2P (https://github.com/Belarus/BelG2P)
 * Без хардкоду правіл, дакладна той рухавік.
 */

export {
  convertTextBelG2P,
  convertPhoneticPhraseBelG2P,
  Fanetyka3,
  FanetykaText,
  WordInitialConverter,
  ToStringSkolny,
  ToStringIPA,
  ToStringIPA2TTS
} from '../belg2p';

export type { BelG2POptions, BelG2POptions as G2POptions } from '../belg2p';
