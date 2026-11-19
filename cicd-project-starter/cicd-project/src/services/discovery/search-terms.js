const blockedTerms = [
  'fuck',
  'fucked',
  'fucker',
  'fuckers',
  'fucking',
  'motherfucker',
  'motherfuckers',
  'motherfucking',
  'shit',
  'shits',
  'shitty',
  'shitting',
  'bullshit',
  'bitch',
  'bitches',
  'bitching',
  'asshole',
  'assholes',
  'cunt',
  'cunts',
  'porn',
  'porno',
  'pornography',
  'pornographic',
  'pussy',
  'pussies',
  'penis',
  'penises',
  'vagina',
  'vaginas',
  'nigger',
  'niggers',
  'nigga',
  'niggas',
  'niggle',
  'niggles',
  'niggerhead',
  'niggerheads',
  'niggerheads',
  'niggerheads',
  'nsfw',
  'blowjob',
  'blowjobs',
  'handjob',
  'handjobs',
  'dick',
  'dicks',
  'cock',
  'cocks',
];

// Match complete words and common disguises while allowing terms like "cocktail" and "assignment".
const separator = String.raw`[\s\p{P}\p{S}]*`;
const mask = '[*•#]+';
const obscuredTerms = [
  `f(?:${mask}c|u${mask}|${mask})k(?:ed|ing|ers?)?`,
  `sh${mask}t(?:s|ty)?`,
  `b${mask}tch(?:es|ing)?`,
  `a${mask}hole(?:s)?`,
  `p${mask}rn(?:o|ography|ographic)?`,
];
const patterns = blockedTerms.map((term) => Array.from(term).join(separator));
const blocked = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${[...patterns, ...obscuredTerms].join('|')})(?![\p{L}\p{N}])`,
  'u',
);
const substitutions = {
  0: 'o',
  1: 'i',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  '@': 'a',
  '!': 'i',
  $: 's',
};

function containsBlockedSearchTerm(query) {
  const normalized = query
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\p{Cf}\p{M}]/gu, '');
  const unmasked = normalized
    .replace(/[013457]/g, (character) => substitutions[character])
    .replace(/(?<=[a-z])[@!$](?=[a-z])/g, (character) => substitutions[character]);
  return blocked.test(normalized) || blocked.test(unmasked);
}

module.exports = { containsBlockedSearchTerm };
