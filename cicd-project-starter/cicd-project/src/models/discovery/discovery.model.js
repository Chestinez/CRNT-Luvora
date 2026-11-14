const profileFields = `p.user_id, p.display_name, p.age_years, p.bio, p.gender, p.pronouns,
  p.mbti_type, p.zodiac_sign, p.region_code, p.relationship_goal, p.interests`;

function listProfiles(db, viewerId, limit) {
  return db.query(
    `SELECT ${profileFields}, saved.target_user_id IS NOT NULL AS is_saved
     FROM public.discoverable_profiles p
     LEFT JOIN public.profile_browse_actions saved
       ON saved.viewer_id = $1 AND saved.target_user_id = p.user_id AND saved.action = 'saved'
     WHERE p.user_id <> $1
       AND NOT EXISTS (
         SELECT 1 FROM public.profile_browse_actions hidden
         WHERE hidden.viewer_id = $1 AND hidden.target_user_id = p.user_id AND hidden.action = 'hidden'
       )
     ORDER BY p.display_name, p.user_id
     LIMIT $2`,
    [viewerId, limit],
  );
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
    `SELECT p.id, p.title, p.caption, p.published_at, author.user_id AS author_id,
            coalesce(author.display_name, 'Luvora member') AS author_name,
            ARRAY(
              SELECT topic_key FROM public.post_topics
              WHERE post_id = p.id ORDER BY topic_key
            ) AS topics
     FROM public.posts p
     LEFT JOIN public.discoverable_profiles author ON author.user_id = p.author_id
     WHERE p.post_type = 'relationship' AND p.relationship_id IS NOT NULL
       AND p.status = 'published' AND p.published_at IS NOT NULL
     ORDER BY p.published_at DESC, p.id
     LIMIT $1`,
    [limit],
  );
}

module.exports = {
  listProfiles,
  listActionProfiles,
  addProfileAction,
  removeProfileAction,
  listCoupleStories,
};
