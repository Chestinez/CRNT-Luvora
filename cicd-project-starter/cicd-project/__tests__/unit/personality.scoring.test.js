const {
  questions,
  dimensions,
} = require('../../src/public/personality/personality-data');

const {
  calculateResult,
} = require('../../src/services/personality/personality.scoring');

function answersFor(type) {
  return Object.fromEntries(
    questions.map((question) => {
      const dimensionIndex = dimensions.findIndex(
        (dimension) => dimension.key === question.dimension,
      );

      const dimension = dimensions[dimensionIndex];

      const preferredDirection =
        type[dimensionIndex] === dimension.positive ? 1 : -1;

      return [
        question.id,
        2 * question.direction * preferredDirection,
      ];
    }),
  );
}

test('contains 100 uniquely identified questions', () => {
  expect(questions).toHaveLength(100);
  expect(new Set(questions.map((question) => question.id)).size).toBe(100);

  for (const dimension of dimensions) {
    expect(
      questions.filter((question) => question.dimension === dimension.key),
    ).toHaveLength(25);
  }
});

test.each([
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
  'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP',
  'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
])('scores consistently for %s', (type) => {
  expect(calculateResult(answersFor(type)).type).toBe(type);
});

test('all neutral answers remain balanced', () => {
  const answers = Object.fromEntries(
    questions.map((question) => [question.id, 0]),
  );

  expect(calculateResult(answers).type).toBe('XXXX');
});

test('uniform agreement remains balanced despite unequal item counts', () => {
  const answers = Object.fromEntries(
    questions.map((question) => [question.id, 2]),
  );

  expect(calculateResult(answers).type).toBe('XXXX');
});

test('close preferences can be selected explicitly', () => {
  const answers = Object.fromEntries(
    questions.map((question) => [question.id, 0]),
  );

  const result = calculateResult(answers, {
    EI: 'I',
    SN: 'N',
    TF: 'F',
    JP: 'J',
  });

  expect(result.type).toBe('INFJ');
  expect(result.breakdown.every((item) => item.close)).toBe(true);
});

test('rejects incomplete answers', () => {
  expect(() => calculateResult({})).toThrow('Answer all 100');
});

test('rejects out-of-range answer values', () => {
  const answers = answersFor('INFJ');
  answers['1'] = 3;

  expect(() => calculateResult(answers)).toThrow('value from -2 to 2');
});

test('rejects unknown question IDs', () => {
  const answers = answersFor('INFJ');
  answers['101'] = 0;

  expect(() => calculateResult(answers)).toThrow('Unknown question');
});

test('rejects invalid preference selections', () => {
  expect(() =>
    calculateResult(answersFor('INFJ'), { EI: 'N' }),
  ).toThrow('Invalid preference');
});