const profileFields = `p.user_id, p.display_name, p.age_years, p.bio, p.gender, p.pronouns,
  p.mbti_type, p.zodiac_sign, p.region_code, p.relationship_goal, p.interests`;

function browsingState(db) {
  return db.query('SELECT public.profile_browsing_state() AS state');
}

function listProfiles(db, viewerId, limit) {
  return db.query(
    `SELECT ${profileFields}, saved.target_user_id IS NOT NULL AS is_saved
     FROM public.discoverable_profiles p
     LEFT JOIN public.profile_browse_actions saved
       ON saved.viewer_id = $1 AND saved.target_user_id = p.user_id AND saved.action = 'saved'
     WHERE public.can_match_users($1, p.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.profile_browse_actions hidden
         WHERE hidden.viewer_id = $1 AND hidden.target_user_id = p.user_id AND hidden.action = 'hidden'
       )
     ORDER BY p.display_name, p.user_id
     LIMIT $2`,
    [viewerId, limit],
  );
}

function listCompatibleProfiles(db, snapshotId, position, options) {
  return db.query(
    `SELECT ${profileFields}, page.is_saved, page.snapshot_id, page.item_position,
            page.alignment, page.shared_count
     FROM public.list_compatible_profiles($1, $2, $3) AS page
     CROSS JOIN LATERAL (SELECT (page.profile).*) AS p
     ORDER BY page.item_position`,
    [snapshotId, position, options],
  );
}

const searchableProfile = `p.age_years BETWEEN 18 AND 120
  AND public.can_match_users($1, p.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.profile_browse_actions hidden
    WHERE hidden.viewer_id = $1 AND hidden.target_user_id = p.user_id AND hidden.action = 'hidden'
  )`;

function searchCandidates(db, viewerId, query, limit) {
  return db.query(
    `WITH search AS (
      SELECT tsvector_to_array(to_tsvector('english', $2)) AS words
    )
    SELECT p.user_id, p.bio, p.interests, p.relationship_goal,
      CASE WHEN cardinality(search.words) = 0 THEN 0 ELSE
        (SELECT sum(CASE WHEN word = ANY(document.tags) THEN 1.0 ELSE 0.8 END)
          FROM unnest(search.words) AS word
          WHERE word = ANY(document.tags) OR word = ANY(document.bio)) / cardinality(search.words)
      END AS keyword_fit
    FROM public.discoverable_profiles p CROSS JOIN search
    CROSS JOIN LATERAL (
      SELECT tsvector_to_array(to_tsvector('english', replace(replace(
        concat_ws(' ', array_to_string(p.interests, ' '), p.relationship_goal), '_', ' '), '-', ' '))) AS tags,
        tsvector_to_array(to_tsvector('english', coalesce(p.bio, ''))) AS bio
    ) AS document
    WHERE ${searchableProfile}
    ORDER BY keyword_fit DESC NULLS LAST, p.user_id
    LIMIT $3`,
    [viewerId, query, limit],
  );
}

function listSearchResults(db, viewerId, ids) {
  return db.query(
    `SELECT ${profileFields}, saved.target_user_id IS NOT NULL AS is_saved
    FROM unnest($2::uuid[]) WITH ORDINALITY AS result(user_id, position)
    JOIN public.discoverable_profiles p ON p.user_id = result.user_id
    LEFT JOIN public.profile_browse_actions saved ON saved.viewer_id = $1
      AND saved.target_user_id = p.user_id AND saved.action = 'saved'
    WHERE ${searchableProfile}
    ORDER BY result.position`,
    [viewerId, ids],
  );
}

function profileCompatibility(db, targetId) {
  return db.query('SELECT * FROM public.explain_profile_compatibility($1)', [targetId]);
}

function listActionProfiles(db, viewerId, action) {
  return db.query(
    `SELECT ${profileFields}
     FROM public.profile_browse_actions a
     JOIN public.discoverable_profiles p ON p.user_id = a.target_user_id
     WHERE a.viewer_id = $1 AND a.action = $2
     ORDER BY a.created_at DESC, p.user_id`,
    [viewerId, action],
  );
}

function addProfileAction(db, viewerId, targetId, action) {
  // Return the same success for the first write and an eligible duplicate.
  return db.query(
    `WITH eligible AS (
       SELECT user_id FROM public.discoverable_profiles WHERE user_id = $2 AND user_id <> $1
     ), inserted AS (
       INSERT INTO public.profile_browse_actions (viewer_id, target_user_id, action)
       SELECT $1, user_id, $3 FROM eligible
       ON CONFLICT (viewer_id, action, target_user_id) DO NOTHING
     )
     SELECT EXISTS (SELECT 1 FROM eligible) AS eligible`,
    [viewerId, targetId, action],
  );
}

function removeProfileAction(db, viewerId, targetId, action) {
  return db.query(
    `DELETE FROM public.profile_browse_actions
     WHERE viewer_id = $1 AND target_user_id = $2 AND action = $3`,
    [viewerId, targetId, action],
  );
}

function listCoupleStories(db, limit) {
  return db.query(
    `SELECT p.id, p.title, p.caption, p.published_at, p.author_id,
            coalesce(public.couple_story_author(p.id), 'Luvora member') AS author_name,
            ARRAY(
              SELECT topic_key FROM public.post_topics
              WHERE post_id = p.id ORDER BY topic_key
            ) AS topics
     FROM public.posts p
     WHERE p.post_type = 'relationship' AND p.relationship_id IS NOT NULL
       AND p.status = 'published' AND p.published_at IS NOT NULL
     ORDER BY p.published_at DESC, p.id
     LIMIT $1`,
    [limit],
  );
}

function listConnections(db, viewerId) {
  return db.query(
    `WITH active AS (
       SELECT r.id, r.stage, r.source_request_id AS request_id,
              public.connection_member_name(
                CASE WHEN r.user_low = $1 THEN r.user_high ELSE r.user_low END
              ) AS name
       FROM public.relationships r
       WHERE r.status = 'active' AND $1 IN (r.user_low, r.user_high)
     ), invitations AS (
       SELECT m.id, m.status, m.close_reason,
              CASE WHEN m.sender_id = $1 THEN 'sent' ELSE 'received' END AS direction,
              CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS member_id,
              coalesce(m.responded_at, m.created_at) AS activity_at
       FROM public.match_requests m
       WHERE $1 IN (m.sender_id, m.recipient_id) AND m.status <> 'accepted'
     ), displayable AS (
       SELECT * FROM invitations WHERE status = 'pending'
       UNION ALL
       (SELECT * FROM invitations WHERE status <> 'pending' ORDER BY activity_at DESC, id LIMIT 30)
     ), visible AS (
       SELECT i.*, public.connection_member_name(i.member_id) AS name,
              CASE WHEN i.status = 'pending' THEN public.can_match_users($1, i.member_id)
                   ELSE false END AS actionable
       FROM displayable i
     )
     SELECT public.profile_browsing_state() AS browsing,
            (SELECT to_jsonb(a) FROM active a) AS active,
            coalesce(
              (SELECT jsonb_agg(to_jsonb(v) ORDER BY (v.status = 'pending') DESC, v.activity_at DESC, v.id)
               FROM visible v), '[]'::jsonb
            ) AS requests`,
    [viewerId],
  );
}

function sendConnectionRequest(db, viewerId, targetId) {
  return db.query(
    `SELECT request.id, CASE WHEN request.sender_id = $1 THEN 'sent' ELSE 'received' END AS direction
     FROM public.send_match_request($2) AS request`,
    [viewerId, targetId],
  );
}

function respondToConnectionRequest(db, requestId, action) {
  if (action === 'accepted') {
    return db.query('SELECT public.accept_match_request($1)', [requestId]);
  }
  return db.query('SELECT public.close_match_request($1, $2)', [requestId, action]);
}

function endConnection(db, connectionId, requestId) {
  return db.query('SELECT public.end_talking_connection($1, $2)', [connectionId, requestId]);
}

module.exports = {
  browsingState,
  listProfiles,
  listCompatibleProfiles,
  searchCandidates,
  listSearchResults,
  profileCompatibility,
  listActionProfiles,
  addProfileAction,
  removeProfileAction,
  listCoupleStories,
  listConnections,
  sendConnectionRequest,
  respondToConnectionRequest,
  endConnection,
};
