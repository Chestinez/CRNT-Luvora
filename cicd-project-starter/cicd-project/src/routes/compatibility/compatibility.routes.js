'use strict';

const express = require('express');
const createError = require('http-errors');

const withViewer = require('../../db/with-viewer');
const { getViewerId } = require('../../controllers/viewer');
const {
  QUESTIONNAIRE_VERSION,
  CATEGORIES,
  QUESTIONS,
} = require('../../data/compatibilityQuestions');
const {
  validateAssessment,
  validateRevision,
} = require('../../services/compatibility/compatibility.validation');

const router = express.Router();

async function readAssessment(client, userId, lock = false) {
  const { rows } = await client.query(
    `SELECT *
     FROM public.compatibility_assessments
     WHERE user_id = $1
     ${lock ? 'FOR UPDATE' : ''}`,
    [userId],
  );

  return rows[0] || null;
}

function checkExistingAssessment(assessment, revision) {
  if (!assessment) {
    throw createError(404, 'Create an assessment first.');
  }

  if (assessment.questionnaire_version !== QUESTIONNAIRE_VERSION) {
    throw createError(409, 'This questionnaire version is not supported.');
  }

  if (assessment.revision !== revision) {
    throw createError(
      409,
      'Your answers changed in another tab. Reload before saving again.',
    );
  }
}

// All endpoints use the trusted identity supplied by authentication.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.locals.viewerId = getViewerId(req);
  next();
});

// Read the question bank.
router.get('/questions', (_req, res) => {
  res.json({
    version: QUESTIONNAIRE_VERSION,
    categories: CATEGORIES,
    questions: QUESTIONS,
  });
});

// Read the signed-in user's assessment.
// null means they have not started yet.
router.get('/assessment', async (_req, res) => {
  const userId = res.locals.viewerId;

  const assessment = await withViewer(userId, (client) =>
    readAssessment(client, userId),
  );

  res.json({ assessment });
});

// Create an empty assessment.
router.post('/assessment', async (_req, res) => {
  const userId = res.locals.viewerId;

  const assessment = await withViewer(userId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO public.compatibility_assessments
         (user_id, questionnaire_version)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [userId, QUESTIONNAIRE_VERSION],
    );

    if (!rows.length) {
      throw createError(
        409,
        'An assessment already exists. Reload to resume it.',
      );
    }

    return rows[0];
  });

  res.status(201).json({ assessment });
});

// Replace the saved answer set with a validated snapshot.
// The client must send all current answers, not just the latest answer.
router.put('/assessment', async (req, res) => {
  const userId = res.locals.viewerId;
  const input = validateAssessment(req.body);

  const assessment = await withViewer(userId, async (client) => {
    const existing = await readAssessment(client, userId, true);

    checkExistingAssessment(existing, input.revision);

    // Preserve completion when editing an already-complete assessment.
    // Removing a required answer makes it incomplete again.
    let completedAt = existing.core_completed_at;

    if (!input.coreComplete) {
      completedAt = null;
    } else if (input.action === 'complete' && !completedAt) {
      completedAt = new Date();
    }

    const { rows } = await client.query(
      `UPDATE public.compatibility_assessments
       SET answers = $2::jsonb,
           partner_preferences = $3::jsonb,
           skipped_question_ids = $4::jsonb,
           core_completed_at = $5
       WHERE user_id = $1
         AND revision = $6
       RETURNING *`,
      [
        userId,
        JSON.stringify(input.answers),
        JSON.stringify(input.partnerPreferences),
        JSON.stringify(input.skippedQuestionIds),
        completedAt,
        input.revision,
      ],
    );

    if (!rows.length) {
      throw createError(409, 'Your assessment changed. Reload first.');
    }

    // The database trigger increments revision and updates updated_at.
    return rows[0];
  });

  res.json({ assessment });
});

// Delete only the signed-in user's compatibility assessment.
router.delete('/assessment', async (req, res) => {
  const userId = res.locals.viewerId;
  const revision = req.body?.revision;

  validateRevision(revision);

  await withViewer(userId, async (client) => {
    const existing = await readAssessment(client, userId, true);

    checkExistingAssessment(existing, revision);

    await client.query(
      `DELETE FROM public.compatibility_assessments
       WHERE user_id = $1 AND revision = $2`,
      [userId, revision],
    );
  });

  res.status(204).end();
});

// Keep internal database errors out of browser responses.
router.use((error, _req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.status || 500;

  if (!error.expose) {
    console.error('Compatibility API failed:', error.code || status);
  }

  return res.status(status).json({
    error: error.expose
      ? error.message
      : 'Could not save your compatibility assessment. Please try again.',
  });
});

module.exports = router;