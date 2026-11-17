const express = require('express');
const createError = require('http-errors');
const withViewer = require('../../db/with-viewer');
const { getViewerId } = require('../../controllers/viewer');
const { version } = require('../../public/personality/personality-data');
const {
  validateAnswers,
  validateResolutions,
  calculateResult,
} = require('../../services/personality/personality.scoring');

const router = express.Router();

function checkRevision(revision) {
  if (!Number.isInteger(revision) || revision < 1) {
    throw createError(400, 'A valid assessment revision is required.');
  }
}

async function lockProfile(client, userId) {
  const { rows } = await client.query(
    'SELECT user_id FROM public.profiles WHERE user_id = $1 FOR UPDATE',
    [userId],
  );

  if (!rows.length) {
    throw createError(404, 'Complete account creation before taking the quiz.');
  }
}

async function getAssessment(client, userId) {
  const { rows } = await client.query(
    'SELECT * FROM public.personality_assessments WHERE user_id = $1',
    [userId],
  );

  return rows[0] || null;
}

async function clearPublishedType(client, userId) {
  await client.query(
    `UPDATE public.profiles
     SET mbti_type = NULL, updated_at = now()
     WHERE user_id = $1`,
    [userId],
  );
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/assessment', async (req, res) => {
  const userId = getViewerId(req);

  const assessment = await withViewer(userId, (client) =>
    getAssessment(client, userId),
  );

  res.json({ assessment });
});

router.post('/assessment', async (req, res) => {
  const userId = getViewerId(req);

  const assessment = await withViewer(userId, async (client) => {
    await lockProfile(client, userId);

    const existing = await getAssessment(client, userId);

    if (existing) {
      throw createError(409, 'An assessment already exists. Reload to resume it.');
    }

    const { rows } = await client.query(
      `INSERT INTO public.personality_assessments
         (user_id, questionnaire_version)
       VALUES ($1, $2)
       RETURNING *`,
      [userId, version],
    );

    return rows[0];
  });

  res.status(201).json({ assessment });
});

router.put('/assessment', async (req, res) => {
  const userId = getViewerId(req);
  const {
    revision,
    action,
    answers,
    resolutions = {},
  } = req.body || {};

  checkRevision(revision);

  if (!['draft', 'complete', 'publish'].includes(action)) {
    throw createError(400, 'Choose draft, complete or publish.');
  }

  validateAnswers(answers);
  validateResolutions(resolutions);

  const assessment = await withViewer(userId, async (client) => {
    await lockProfile(client, userId);

    const existing = await getAssessment(client, userId);

    if (!existing) {
      throw createError(404, 'Create an assessment first.');
    }

    if (existing.revision !== revision) {
      throw createError(409, 'Your assessment changed in another tab. Reload first.');
    }

    if (existing.questionnaire_version !== version) {
      throw createError(409, 'This questionnaire version is no longer supported.');
    }

    let result = null;

    if (action !== 'draft') {
      result = calculateResult(answers, resolutions);
    }

    const published = action === 'publish';

    if (published && result.type.includes('X')) {
      throw createError(
        400,
        'Choose a preference for each close result before adding a type to your profile.',
      );
    }

    if (published) {
      await client.query(
        `UPDATE public.profiles
         SET mbti_type = $2, updated_at = now()
         WHERE user_id = $1`,
        [userId, result.type],
      );
    } else if (existing.published) {
      await clearPublishedType(client, userId);
    }

    const { rows } = await client.query(
      `UPDATE public.personality_assessments
       SET answers = $2::jsonb,
           resolutions = $3::jsonb,
           result = $4::jsonb,
           published = $5,
           revision = revision + 1,
           updated_at = now()
       WHERE user_id = $1
       RETURNING *`,
      [
        userId,
        JSON.stringify(answers),
        JSON.stringify(resolutions),
        result === null ? null : JSON.stringify(result),
        published,
      ],
    );

    return rows[0];
  });

  res.json({ assessment });
});

router.delete('/assessment', async (req, res) => {
  const userId = getViewerId(req);
  const { revision } = req.body || {};

  checkRevision(revision);

  await withViewer(userId, async (client) => {
    await lockProfile(client, userId);

    const existing = await getAssessment(client, userId);

    if (!existing) {
      throw createError(404, 'No assessment exists.');
    }

    if (existing.revision !== revision) {
      throw createError(409, 'Your assessment changed in another tab. Reload first.');
    }

    if (existing.published) {
      await clearPublishedType(client, userId);
    }

    await client.query(
      'DELETE FROM public.personality_assessments WHERE user_id = $1',
      [userId],
    );
  });

  res.status(204).end();
});

// Keep database errors out of API responses.
router.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.status || 500;

  if (!error.expose) {
    console.error('Personality API failed:', error.code || status);
  }

  return res.status(status).json({
    error: error.expose
      ? error.message
      : 'Could not save your personality assessment. Please try again.',
  });
});

module.exports = router;