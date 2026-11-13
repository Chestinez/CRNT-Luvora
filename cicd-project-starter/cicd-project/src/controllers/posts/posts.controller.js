const createError = require('http-errors');
const { getViewerId, uuid } = require('../viewer');
const posts = require('../../services/posts/posts.service');

function postContent(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const caption = typeof body?.caption === 'string' ? body.caption.trim() : '';
  if (!title || title.length > 120 || !caption || caption.length > 10000) {
    throw createError(
      400,
      'Enter a title of 1–120 characters and a caption of 1–10,000 characters.',
    );
  }
  return { title, caption };
}

function postRevision(req) {
  if (!uuid.test(req.params.id)) throw createError(400, 'Invalid story ID.');
  const value = req.body?.revision;
  const revision = typeof value === 'string' || Number.isSafeInteger(value) ? String(value) : '';
  if (!/^[1-9][0-9]{0,18}$/.test(revision) || BigInt(revision) > 9223372036854775807n) {
    throw createError(400, 'A valid story revision is required.');
  }
  return revision;
}

async function listRelationships(req, res) {
  res.json(await posts.listRelationships(getViewerId(req)));
}

async function listOwn(req, res) {
  res.json(await posts.listOwn(getViewerId(req)));
}

async function createDraft(req, res) {
  const viewerId = getViewerId(req);
  const { relationshipId } = req.body ?? {};
  if (typeof relationshipId !== 'string' || !uuid.test(relationshipId)) {
    throw createError(400, 'Choose an active relationship.');
  }
  await posts.createDraft(viewerId, { ...postContent(req.body), relationshipId });
  res.status(201).end();
}

async function updateDraft(req, res) {
  res.json(
    await posts.updateDraft(getViewerId(req), req.params.id, {
      ...postContent(req.body),
      revision: postRevision(req),
    }),
  );
}

async function publishDraft(req, res) {
  res.json(await posts.publishDraft(getViewerId(req), req.params.id, postRevision(req)));
}

async function deleteOwn(req, res) {
  await posts.deleteOwn(getViewerId(req), req.params.id, postRevision(req));
  res.status(204).end();
}

async function listReviewable(req, res) {
  res.json(await posts.listReviewable(getViewerId(req)));
}

async function approveRevision(req, res) {
  await posts.approveRevision(getViewerId(req), req.params.id, postRevision(req));
  res.status(204).end();
}

module.exports = {
  listReviewable,
  approveRevision,
  listRelationships,
  listOwn,
  createDraft,
  updateDraft,
  publishDraft,
  deleteOwn,
};
