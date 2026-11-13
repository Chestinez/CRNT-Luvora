const createError = require('http-errors');
const withViewer = require('../../db/with-viewer');
const model = require('../../models/posts/posts.model');

function listRelationships(viewerId) {
  return withViewer(viewerId, async (db) => (await model.listRelationships(db, viewerId)).rows);
}

function listOwn(viewerId) {
  return withViewer(viewerId, async (db) => (await model.listOwn(db, viewerId)).rows);
}

async function createDraft(viewerId, content) {
  const result = await withViewer(viewerId, (db) => model.createDraft(db, viewerId, content));
  if (!result.rowCount) throw createError(404, 'Choose one of your active relationships.');
}

function requirePost(result) {
  if (!result.rowCount) {
    throw createError(404, 'Story is unavailable or has changed. Reload your stories.');
  }
  return result.rows[0];
}

async function updateDraft(viewerId, postId, content) {
  return requirePost(
    await withViewer(viewerId, (db) => model.updateDraft(db, viewerId, postId, content)),
  );
}

async function publishDraft(viewerId, postId, revision) {
  try {
    return requirePost(
      await withViewer(viewerId, (db) => model.publishDraft(db, viewerId, postId, revision)),
    );
  } catch (error) {
    if (
      error.code === 'P0001' &&
      error.message === 'Both participants must approve the current post revision'
    ) {
      throw createError(409, 'Both participants must approve this revision before publishing.');
    }
    throw error;
  }
}

async function deleteOwn(viewerId, postId, revision) {
  requirePost(await withViewer(viewerId, (db) => model.deleteOwn(db, viewerId, postId, revision)));
}

function listReviewable(viewerId) {
  return withViewer(viewerId, async (db) => (await model.listReviewable(db, viewerId)).rows);
}

async function approveRevision(viewerId, postId, revision) {
  requirePost(
    await withViewer(viewerId, (db) => model.approveRevision(db, viewerId, postId, revision)),
  );
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
