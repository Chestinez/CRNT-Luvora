'use strict';

const {
  QUESTIONS,
} = require('../../src/data/compatibilityQuestions');

const {
  validateAssessment,
  validateRevision,
} = require('../../src/services/compatibility/compatibility.validation');

function draft(overrides = {}) {
  return {
    revision: 1,
    action: 'draft',
    answers: {},
    partnerPreferences: {},
    skippedQuestionIds: [],
    ...overrides,
  };
}

describe('compatibility assessment validation', () => {
  test('allows an empty draft', () => {
    const result = validateAssessment(draft());

    expect(result.coreComplete).toBe(false);
  });

  test('rejects an unknown question', () => {
    expect(() =>
      validateAssessment(draft({
        answers: { 'unknown-01': ['yes'] },
      })),
    ).toThrow('Unknown question');
  });

  test('rejects an invalid option', () => {
    expect(() =>
      validateAssessment(draft({
        answers: { 'goals-01': ['invalid'] },
      })),
    ).toThrow('invalid option');
  });

  test('rejects multiple answers for a single-choice question', () => {
    expect(() =>
      validateAssessment(draft({
        answers: { 'goals-01': ['serious', 'casual'] },
      })),
    ).toThrow('between 1 and 1');
  });

  test('allows three interests', () => {
    expect(() =>
      validateAssessment(draft({
        answers: {
          'interests-01': ['music', 'cooking', 'travel'],
        },
      })),
    ).not.toThrow();
  });

  test('rejects more than three interests', () => {
    expect(() =>
      validateAssessment(draft({
        answers: {
          'interests-01': ['music', 'cooking', 'travel', 'gaming'],
        },
      })),
    ).toThrow('between 1 and 3');
  });

  test('rejects duplicate selections', () => {
    expect(() =>
      validateAssessment(draft({
        answers: { 'interests-01': ['music', 'music'] },
      })),
    ).toThrow('duplicate options');
  });

  test('allows skipping the optional children question', () => {
    expect(() =>
      validateAssessment(draft({
        skippedQuestionIds: ['values-02'],
      })),
    ).not.toThrow();
  });

  test('rejects skipping a core question', () => {
    expect(() =>
      validateAssessment(draft({
        skippedQuestionIds: ['goals-01'],
      })),
    ).toThrow('core questions cannot be skipped');
  });

  test('rejects answering and skipping the same question', () => {
    expect(() =>
      validateAssessment(draft({
        answers: { 'values-02': ['unsure'] },
        skippedQuestionIds: ['values-02'],
      })),
    ).toThrow('both answered and skipped');
  });

  test('rejects incomplete completion', () => {
    expect(() =>
      validateAssessment(draft({ action: 'complete' })),
    ).toThrow('Answer all 15 core questions');
  });

  test('allows completion without the five optional answers', () => {
    const answers = Object.fromEntries(
      QUESTIONS
        .filter((question) => question.required)
        .map((question) => [
          question.id,
          [question.options[0].value],
        ]),
    );

    expect(
      validateAssessment(draft({ action: 'complete', answers }))
        .coreComplete,
    ).toBe(true);
  });

  test('allows multiple acceptable partner options', () => {
    expect(() =>
      validateAssessment(draft({
        partnerPreferences: {
          'goals-01': {
            accepted: ['serious', 'exploring'],
            importance: 3,
            dealbreaker: false,
          },
        },
      })),
    ).not.toThrow();
  });

  test('rejects unsupported importance', () => {
    expect(() =>
      validateAssessment(draft({
        partnerPreferences: {
          'goals-01': {
            accepted: ['serious'],
            importance: 2,
            dealbreaker: false,
          },
        },
      })),
    ).toThrow('importance must be');
  });

  test('rejects a zero-importance dealbreaker', () => {
    expect(() =>
      validateAssessment(draft({
        partnerPreferences: {
          'goals-01': {
            accepted: ['serious'],
            importance: 0,
            dealbreaker: true,
          },
        },
      })),
    ).toThrow('zero importance');
  });

  test('rejects a client-supplied user identity', () => {
    expect(() =>
      validateAssessment(draft({ userId: 'someone-else' })),
    ).toThrow('unknown field');
  });

  test.each([0, -1, 1.5, '1', null, undefined])(
    'rejects invalid revision %p',
    (revision) => {
      expect(() => validateRevision(revision)).toThrow();
    },
  );
});