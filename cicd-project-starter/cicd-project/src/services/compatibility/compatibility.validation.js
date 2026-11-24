'use strict';

const createError = require('http-errors');
const { QUESTIONS } = require('../../data/compatibilityQuestions');

const questionsById = new Map(QUESTIONS.map((question) => [question.id, question]));

function fail(message) {
  throw createError(400, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getQuestion(id) {
  const question = questionsById.get(id);

  if (!question) {
    fail(`Unknown question: ${id}`);
  }

  return question;
}

function validateSelections(question, selections, maximum) {
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > maximum) {
    fail(`${question.id}: choose between 1 and ${maximum} options.`);
  }

  const allowedValues = new Set(question.options.map((option) => option.value));

  if (selections.some((value) => typeof value !== 'string' || !allowedValues.has(value))) {
    fail(`${question.id}: an answer contains an invalid option.`);
  }

  if (new Set(selections).size !== selections.length) {
    fail(`${question.id}: duplicate options are not allowed.`);
  }
}

function validateAnswers(answers) {
  if (!isObject(answers)) {
    fail('Answers must be an object.');
  }

  for (const [id, selections] of Object.entries(answers)) {
    const question = getQuestion(id);

    validateSelections(question, selections, question.maxSelections);
  }
}

function validateSkippedQuestions(skippedQuestionIds, answers) {
  if (!Array.isArray(skippedQuestionIds)) {
    fail('Skipped question IDs must be an array.');
  }

  if (new Set(skippedQuestionIds).size !== skippedQuestionIds.length) {
    fail('Skipped question IDs must not contain duplicates.');
  }

  for (const id of skippedQuestionIds) {
    if (typeof id !== 'string') {
      fail('Each skipped question ID must be a string.');
    }

    const question = getQuestion(id);

    if (question.required) {
      fail(`${id}: core questions cannot be skipped.`);
    }

    if (Object.prototype.hasOwnProperty.call(answers, id)) {
      fail(`${id}: a question cannot be both answered and skipped.`);
    }
  }
}

function validatePartnerPreferences(preferences) {
  if (!isObject(preferences)) {
    fail('Partner preferences must be an object.');
  }

  for (const [id, preference] of Object.entries(preferences)) {
    const question = getQuestion(id);

    if (!isObject(preference)) {
      fail(`${id}: the partner preference must be an object.`);
    }

    const allowedFields = new Set(['accepted', 'importance', 'dealbreaker']);

    if (Object.keys(preference).some((key) => !allowedFields.has(key))) {
      fail(`${id}: the partner preference contains an unknown field.`);
    }

    // Acceptable partner options can include more choices than
    // the user's own answer. For example: morning OR night.
    validateSelections(question, preference.accepted, question.options.length);

    if (![0, 1, 3].includes(preference.importance)) {
      fail(`${id}: importance must be 0, 1 or 3.`);
    }

    if (typeof preference.dealbreaker !== 'boolean') {
      fail(`${id}: dealbreaker must be true or false.`);
    }

    if (preference.dealbreaker && preference.importance === 0) {
      fail(`${id}: a dealbreaker cannot have zero importance.`);
    }
  }
}

function validateRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    fail('A positive integer revision is required.');
  }
}

function validateAssessment(payload) {
  if (!isObject(payload)) {
    fail('An assessment object is required.');
  }

  const allowedFields = new Set([
    'revision',
    'action',
    'answers',
    'partnerPreferences',
    'skippedQuestionIds',
  ]);

  if (Object.keys(payload).some((key) => !allowedFields.has(key))) {
    fail('The assessment contains an unknown field.');
  }

  const { revision, action, answers, partnerPreferences, skippedQuestionIds } = payload;

  validateRevision(revision);

  if (!['draft', 'complete'].includes(action)) {
    fail('Action must be draft or complete.');
  }

  validateAnswers(answers);
  validatePartnerPreferences(partnerPreferences);
  validateSkippedQuestions(skippedQuestionIds, answers);

  const missingRequiredIds = QUESTIONS.filter((question) => question.required)
    .filter((question) => !Object.prototype.hasOwnProperty.call(answers, question.id))
    .map((question) => question.id);

  if (action === 'complete' && missingRequiredIds.length > 0) {
    fail('Answer all 15 core questions before completing the assessment.');
  }

  return {
    revision,
    action,
    answers,
    partnerPreferences,
    skippedQuestionIds,
    coreComplete: missingRequiredIds.length === 0,
  };
}

module.exports = {
  validateAssessment,
  validateRevision,
};
