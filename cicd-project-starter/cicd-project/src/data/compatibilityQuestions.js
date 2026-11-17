'use strict';

const QUESTIONNAIRE_VERSION = 'compatibility-v1';

const CATEGORIES = Object.freeze({
  goals: { label: 'Relationship goals', weight: 0.3 },
  values: { label: 'Values', weight: 0.25 },
  communication: { label: 'Communication', weight: 0.2 },
  lifestyle: { label: 'Lifestyle', weight: 0.15 },
  interests: { label: 'Interests', weight: 0.1 },
});

function question(id, category, text, options, settings = {}) {
  return {
    id,
    category,
    text,
    required: settings.required ?? true,
    sensitive: settings.sensitive ?? false,
    maxSelections: settings.maxSelections ?? 1,
    options: options.map(([value, label]) => ({ value, label })),
  };
}

const QUESTIONS = [
  question('goals-01', 'goals', 'What are you looking for right now?', [
    ['serious', 'A serious relationship'],
    ['casual', 'Casual dating'],
    ['exploring', 'Getting to know people first'],
    ['unsure', 'Still figuring it out'],
  ]),

  question('goals-02', 'goals', 'What pace feels comfortable when dating?', [
    ['slow', 'Take it slowly'],
    ['steady', 'Build a connection steadily'],
    ['fast', 'Move quickly when it feels right'],
    ['flexible', 'It depends on the connection'],
  ]),

  question('goals-03', 'goals', 'What kind of relationship would you prefer?', [
    ['exclusive', 'An exclusive relationship'],
    ['nonexclusive', 'A consensually non-exclusive relationship'],
    ['discuss', 'I would like to discuss it together'],
    ['unsure', 'I am not sure yet'],
  ]),

  question('goals-04', 'goals', 'How open are you to long-distance dating?', [
    ['comfortable', 'Comfortable with it'],
    ['temporary', 'Only if it is temporary'],
    ['nearby', 'I prefer someone nearby'],
    ['unsure', 'I am not sure'],
  ], { required: false }),

  question('communication-01', 'communication',
    'How do you prefer to stay in touch?', [
      ['text', 'Text messages'],
      ['calls', 'Voice calls'],
      ['inperson', 'In-person conversations'],
      ['mix', 'A mix of these'],
    ]),

  question('communication-02', 'communication',
    'How often would you like to hear from someone you are dating?', [
      ['frequent', 'Several times throughout the day'],
      ['daily', 'A check-in each day'],
      ['fewdays', 'Every few days'],
      ['flexible', 'Whatever works for both of us'],
    ]),

  question('communication-03', 'communication',
    'When a disagreement happens, what helps you most?', [
      ['immediate', 'Talking about it straight away'],
      ['space', 'Some time to think before talking'],
      ['written', 'Writing down my thoughts first'],
      ['flexible', 'Choosing an approach together'],
    ]),

  question('communication-04', 'communication',
    'What helps you feel supported when you are stressed?', [
      ['listening', 'Someone listening to me'],
      ['advice', 'Practical advice'],
      ['company', 'Quiet company'],
      ['space', 'Some space to myself'],
    ], { required: false }),

  question('lifestyle-01', 'lifestyle',
    'What does your ideal weekend usually look like?', [
      ['home', 'Relaxing at home'],
      ['out', 'Going out and being active'],
      ['mix', 'A mix of staying in and going out'],
      ['spontaneous', 'Deciding as I go'],
    ]),

  question('lifestyle-02', 'lifestyle',
    'When do you usually feel most energetic?', [
      ['morning', 'In the morning'],
      ['afternoon', 'In the afternoon'],
      ['night', 'At night'],
      ['varies', 'It varies'],
    ]),

  question('lifestyle-03', 'lifestyle',
    'How do you usually approach spending on dates?', [
      ['budget', 'Keep things budget-friendly'],
      ['occasional', 'Mostly affordable, with occasional treats'],
      ['experiences', 'Spend more on experiences I enjoy'],
      ['discuss', 'Agree on a budget together'],
    ]),

  question('lifestyle-04', 'lifestyle',
    'How do you feel about planning your week?', [
      ['structured', 'I like a clear schedule'],
      ['some', 'I plan the important things'],
      ['spontaneous', 'I prefer being spontaneous'],
      ['varies', 'It depends on the week'],
    ], { required: false }),

  question('interests-01', 'interests',
    'Which activities do you enjoy? Choose up to three.', [
      ['gaming', 'Gaming'],
      ['fitness', 'Sports and fitness'],
      ['music', 'Music'],
      ['films', 'Films and shows'],
      ['reading', 'Reading'],
      ['cooking', 'Cooking and food'],
      ['arts', 'Art and creativity'],
      ['travel', 'Travel and exploring'],
    ], { maxSelections: 3 }),

  question('interests-02', 'interests',
    'Which first date sounds most appealing?', [
      ['cafe', 'Coffee and conversation'],
      ['food', 'Trying a restaurant or food spot'],
      ['activity', 'Doing an activity together'],
      ['culture', 'Visiting a museum or exhibition'],
      ['outdoors', 'A walk or an outdoor outing'],
    ]),

  question('interests-03', 'interests',
    'How do you like to share hobbies with a partner?', [
      ['shared', 'Enjoy many of the same hobbies'],
      ['mix', 'Share some and keep some separate'],
      ['independent', 'Mostly enjoy our own interests'],
      ['explore', 'Discover new hobbies together'],
    ]),

  question('interests-04', 'interests',
    'How often do you enjoy trying something new?', [
      ['often', 'Very often'],
      ['sometimes', 'Sometimes'],
      ['rarely', 'Rarely'],
      ['depends', 'It depends on the activity'],
    ], { required: false }),

  question('values-01', 'values',
    'How much personal time do you prefer in a relationship?', [
      ['lots', 'Plenty of independent time'],
      ['balance', 'A balance of personal and shared time'],
      ['together', 'Most free time together'],
      ['discuss', 'Work out a balance together'],
    ]),

  question('values-02', 'values',
    'How do you currently feel about having children in the future?', [
      ['yes', 'I would like children'],
      ['no', 'I do not want children'],
      ['unsure', 'I am unsure'],
      ['discuss', 'I am open to discussing it'],
    ], { required: false, sensitive: true }),

  question('values-03', 'values',
    'How involved would you like family to be in your relationship?', [
      ['close', 'Closely involved'],
      ['some', 'Involved in some parts'],
      ['private', 'I prefer to keep it fairly private'],
      ['depends', 'It depends on the circumstances'],
    ]),

  question('values-04', 'values',
    'How do you prefer to make decisions that affect both partners?', [
      ['discuss', 'Talk through the options together'],
      ['expertise', 'Let whoever knows more take the lead'],
      ['turns', 'Take turns deciding'],
      ['situational', 'Choose an approach for each situation'],
    ]),
];

module.exports = {
  QUESTIONNAIRE_VERSION,
  CATEGORIES,
  QUESTIONS,
};