const createError = require('http-errors');
const {
  questions,
  dimensions,
} = require('../../public/personality/personality-data');

const validQuestionIds = new Set(questions.map((question) => question.id));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateAnswers(answers) {
  if (!isObject(answers)) {
    throw createError(400, 'Answers must be an object.');
  }

  for (const [id, value] of Object.entries(answers)) {
    if (!validQuestionIds.has(id)) {
      throw createError(400, `Unknown question ID: ${id}.`);
    }

    if (!Number.isInteger(value) || value < -2 || value > 2) {
      throw createError(400, `Question ${id} requires a value from -2 to 2.`);
    }
  }
}

function validateResolutions(resolutions) {
  if (!isObject(resolutions)) {
    throw createError(400, 'Preference selections must be an object.');
  }

  for (const [key, value] of Object.entries(resolutions)) {
    const dimension = dimensions.find((item) => item.key === key);

    if (
      !dimension ||
      ![dimension.positive, dimension.negative, 'X'].includes(value)
    ) {
      throw createError(400, 'Invalid preference selection.');
    }
  }
}

function calculateResult(answers, resolutions = {}) {
  validateAnswers(answers);
  validateResolutions(resolutions);

  if (Object.keys(answers).length !== questions.length) {
    throw createError(400, 'Answer all 100 statements before viewing your result.');
  }

  const breakdown = dimensions.map((dimension) => {
    const items = questions.filter(
      (question) => question.dimension === dimension.key,
    );

    const positiveItems = items.filter((question) => question.direction === 1);
    const negativeItems = items.filter((question) => question.direction === -1);

    const positiveAverage =
      positiveItems.reduce((sum, question) => sum + answers[question.id], 0) /
      positiveItems.length;

    const negativeAverage =
      negativeItems.reduce((sum, question) => sum + answers[question.id], 0) /
      negativeItems.length;

    const score = (positiveAverage - negativeAverage) / 2;
    const close = Math.abs(score) < 0.25;

    const tied = Math.abs(score) < 0.000001;

    let letter = score > 0 ? dimension.positive : dimension.negative;

    if (tied) {
      letter = resolutions[dimension.key] || 'X';
    } else if (close && resolutions[dimension.key]) {
      letter = resolutions[dimension.key];
    }

    return {
      key: dimension.key,
      score: Number(score.toFixed(4)),
      close,
      letter,
      positivePercent: Math.round(((score + 2) / 4) * 100),
    };
  });

  return {
    type: breakdown.map((item) => item.letter).join(''),
    breakdown,
  };
}

module.exports = {
  validateAnswers,
  validateResolutions,
  calculateResult,
};