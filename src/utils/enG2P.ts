/**
 * English Phonetic Converter (Google Translate pronunciation style)
 * Забяспечвае выразную фанетычную транскрыпцыю англійскай мовы
 */

// Базавы слоўнік найбольш ужывальных ангельскіх слоў (IPA / Google Translate style)
const COMMON_EN_IPA: Record<string, string> = {
  'the': 'ðə',
  'be': 'biː',
  'to': 'tuː',
  'of': 'əv',
  'and': 'ænd',
  'a': 'ə',
  'in': 'ɪn',
  'that': 'ðæt',
  'have': 'hæv',
  'i': 'aɪ',
  'it': 'ɪt',
  'for': 'fɔːr',
  'not': 'nɑːt',
  'on': 'ɑːn',
  'with': 'wɪð',
  'he': 'hiː',
  'as': 'æz',
  'you': 'juː',
  'do': 'duː',
  'at': 'æt',
  'this': 'ðɪs',
  'but': 'bʌt',
  'his': 'hɪz',
  'by': 'baɪ',
  'from': 'frʌm',
  'they': 'ðeɪ',
  'we': 'wiː',
  'say': 'seɪ',
  'her': 'hɜːr',
  'she': 'ʃiː',
  'or': 'ɔːr',
  'an': 'æn',
  'will': 'wɪl',
  'my': 'maɪ',
  'one': 'wʌn',
  'all': 'ɔːl',
  'would': 'wʊd',
  'there': 'ðer',
  'their': 'ðer',
  'what': 'wʌt',
  'so': 'soʊ',
  'up': 'ʌp',
  'out': 'aʊt',
  'if': 'ɪf',
  'about': 'əˈbaʊt',
  'who': 'huː',
  'get': 'ɡɛt',
  'which': 'wɪtʃ',
  'go': 'ɡoʊ',
  'me': 'miː',
  'when': 'wɛn',
  'make': 'meɪk',
  'can': 'kæn',
  'like': 'laɪk',
  'time': 'taɪm',
  'no': 'noʊ',
  'just': 'dʒʌst',
  'him': 'hɪm',
  'know': 'noʊ',
  'take': 'teɪk',
  'people': 'ˈpiːpəl',
  'into': 'ˈɪntuː',
  'year': 'jɪr',
  'your': 'jʊr',
  'good': 'ɡʊd',
  'some': 'sʌm',
  'could': 'kʊd',
  'them': 'ðɛm',
  'see': 'siː',
  'other': 'ˈʌðər',
  'than': 'ðæn',
  'then': 'ðɛn',
  'now': 'naʊ',
  'look': 'lʊk',
  'only': 'ˈoʊnli',
  'come': 'kʌm',
  'its': 'ɪts',
  'over': 'ˈoʊvər',
  'think': 'θɪŋk',
  'also': 'ˈɔːlsoʊ',
  'back': 'bæk',
  'after': 'ˈæftər',
  'use': 'juːz',
  'two': 'tuː',
  'how': 'haʊ',
  'our': 'aʊər',
  'work': 'wɜːrk',
  'first': 'fɜːrst',
  'well': 'wɛl',
  'way': 'weɪ',
  'even': 'ˈiːvən',
  'new': 'nuː',
  'want': 'wɑːnt',
  'because': 'bɪˈkɔːz',
  'any': 'ˈɛni',
  'these': 'ðiːz',
  'give': 'ɡɪv',
  'day': 'deɪ',
  'most': 'moʊst',
  'us': 'ʌs',
  'hello': 'həˈloʊ',
  'hi': 'haɪ',
  'world': 'wɜːrld',
  'welcome': 'ˈwɛlkəm',
  'subtitle': 'ˈsʌbˌtaɪtəl',
  'subtitles': 'ˈsʌbˌtaɪtəlz',
  'video': 'ˈvɪdioʊ',
  'audio': 'ˈɔːdioʊ',
  'speech': 'spiːtʃ',
  'transcription': 'trænˈskrɪpʃən',
  'phonetic': 'fəˈnɛtɪk',
  'phonetics': 'fəˈnɛtɪks',
  'belarusian': 'ˌbɛləˈruːʃən',
  'english': 'ˈɪŋɡlɪʃ',
  'translator': 'trænsˈleɪtər',
  'editor': 'ˈɛdɪtər',
  'name': 'neɪm',
  'please': 'pliːz',
  'thank': 'θæŋk',
  'thanks': 'θæŋks',
  'yes': 'jɛs',
  'friend': 'frɛnd',
  'morning': 'ˈmɔːrnɪŋ',
  'night': 'naɪt',
  'love': 'lʌv',
  'great': 'ɡreɪt',
  'help': 'hɛlp',
  'start': 'stɑːrt',
  'stop': 'stɑːp'
};

/**
 * Правілы прыблізнай транскрыпцыі англійскіх слоў, якіх няма ў слоўніку
 */
function ruleBasedEnG2P(rawWord: string): string {
  let w = rawWord.toLowerCase();

  // Некаторыя асноўныя англійскія графемна-фанетычныя шаблоны
  w = w.replace(/tion/g, 'ʃən');
  w = w.replace(/sion/g, 'ʒən');
  w = w.replace(/cious|tious/g, 'ʃəs');
  w = w.replace(/ight/g, 'aɪt');
  w = w.replace(/ough/g, 'oʊ');
  w = w.replace(/augh/g, 'ɔː');
  w = w.replace(/eigh/g, 'eɪ');
  w = w.replace(/tch/g, 'tʃ');
  w = w.replace(/ch/g, 'tʃ');
  w = w.replace(/sh/g, 'ʃ');
  w = w.replace(/th/g, 'θ');
  w = w.replace(/ph/g, 'f');
  w = w.replace(/wh/g, 'w');
  w = w.replace(/qu/g, 'kw');
  w = w.replace(/ck/g, 'k');
  w = w.replace(/ee|ea/g, 'iː');
  w = w.replace(/oo/g, 'uː');
  w = w.replace(/ai|ay/g, 'eɪ');
  w = w.replace(/oi|oy/g, 'ɔɪ');
  w = w.replace(/ou|ow/g, 'aʊ');
  w = w.replace(/au|aw/g, 'ɔː');
  w = w.replace(/er|ir|ur/g, 'ɜːr');
  w = w.replace(/ar/g, 'ɑːr');
  w = w.replace(/or/g, 'ɔːr');
  w = w.replace(/ng/g, 'ŋ');
  w = w.replace(/c([eiy])/g, 's$1');
  w = w.replace(/g([eiy])/g, 'dʒ$1');
  w = w.replace(/x/g, 'ks');

  return w;
}

export function convertWordEnG2P(word: string): string {
  const clean = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return word;

  if (COMMON_EN_IPA[clean]) {
    return COMMON_EN_IPA[clean];
  }

  return ruleBasedEnG2P(clean);
}

export function convertTextEnG2P(text: string): string {
  if (!text || !text.trim()) return '';

  const tokens = text.split(/(\s+|[.,!?:;—"«»()]+)/g);
  const result: string[] = [];

  for (const token of tokens) {
    if (!token) continue;
    if (/^[\s.,!?:;—"«»()]+$/.test(token)) {
      result.push(token);
    } else {
      result.push(convertWordEnG2P(token));
    }
  }

  return result.join('').trim();
}
