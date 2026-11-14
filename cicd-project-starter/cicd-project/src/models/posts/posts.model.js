const fields =
  'id, relationship_id, title, caption, status, content_revision, updated_at, published_at';

function listRelationships(db, viewerId) {
  return db.query(
    `SELECT r.id, coalesce(public.connection_member_name(
              CASE WHEN r.user_low = $1 THEN r.user_high ELSE r.user_low END
            ), 'Partner') AS partner_name
     FROM public.relationships r
     WHERE r.status = 'active' AND r.stage = 'dating' AND $1 IN (r.user_low, r.user_high)
     ORDER BY r.created_at DESC, r.id`,
    [viewerId],
  );
}

function listOwn(db, viewerId) {
  return db.query(
    `SELECT ${fields} FROM public.posts
     WHERE author_id = $1 AND post_type = 'relationship'
     ORDER BY updated_at DESC, id LIMIT 50`,
    [viewerId],
  );
}

function createDraft(db, viewerId, { relationshipId, title, caption }) {
  // The existing SELECT policy can only see a new row in a subsequent statement.
  return db.query(
    `INSERT INTO public.posts (author_id, relationship_id, title, caption, post_type)
     SELECT $1, r.id, $3, $4, 'relationship'
     FROM public.relationships r
     WHERE r.id = $2 AND r.status = 'active' AND r.stage = 'dating'
       AND $1 IN (r.user_low, r.user_high)`,
    [viewerId, relationshipId, title, caption],
  );
}

function updateDraft(db, viewerId, postId, { revision, title, caption }) {
  return db.query(
    `UPDATE public.posts SET title = $4, caption = $5
     WHERE author_id = $1 AND id = $2 AND content_revision = $3
       AND post_type = 'relationship' AND status IN ('draft', 'published')
     RETURNING ${fields}`,
    [viewerId, postId, revision, title, caption],
  );
}

function publishDraft(db, viewerId, postId, revision) {
  return db.query(
    `UPDATE public.posts p SET status = 'published', published_at = now()
     WHERE p.author_id = $1 AND p.id = $2 AND p.content_revision = $3
       AND p.post_type = 'relationship' AND p.status = 'draft'
       AND btrim(p.title) <> '' AND btrim(p.caption) <> ''
       AND EXISTS (
         SELECT 1 FROM public.relationships r
         WHERE r.id = p.relationship_id AND r.status = 'active' AND r.stage = 'dating'
       )
     RETURNING ${fields}`,
    [viewerId, postId, revision],
  );
}

function deleteOwn(db, viewerId, postId, revision) {
  return db.query(
    `DELETE FROM public.posts
     WHERE author_id = $1 AND id = $2 AND content_revision = $3 AND post_type = 'relationship'`,
    [viewerId, postId, revision],
  );
}

function listReviewable(db, viewerId) {
  return db.query(
    `SELECT p.id, p.title, p.caption, p.content_revision
     FROM public.posts p
     JOIN public.relationships r ON r.id = p.relationship_id
     WHERE p.post_type = 'relationship' AND p.status = 'draft'
       AND r.status = 'active' AND r.stage = 'dating' AND $1 IN (r.user_low, r.user_high)
       AND btrim(p.title) <> '' AND btrim(p.caption) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.post_participant_approvals a
         WHERE a.post_id = p.id AND a.user_id = $1
           AND a.post_revision = p.content_revision AND a.approval_status = 'approved'
       )
     ORDER BY p.updated_at DESC, p.id LIMIT 50`,
    [viewerId],
  );
}

function approveRevision(db, viewerId, postId, revision) {
  return db.query(
    `INSERT INTO public.post_participant_approvals (post_id, user_id, post_revision, approval_status)
     SELECT p.id, $1, p.content_revision, 'approved'
     FROM public.posts p JOIN public.relationships r ON r.id = p.relationship_id
     WHERE p.id = $2 AND p.content_revision = $3
       AND p.status = 'draft' AND p.post_type = 'relationship' AND r.status = 'active' AND r.stage = 'dating'
       AND $1 IN (r.user_low, r.user_high) AND btrim(p.title) <> '' AND btrim(p.caption) <> ''
     ON CONFLICT (post_id, user_id, post_revision)
     DO UPDATE SET approval_status = 'approved'`,
    [viewerId, postId, revision],
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
