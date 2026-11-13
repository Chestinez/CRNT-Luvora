function listProfiles(db, viewerId, limit) {
  return db.query(
    `SELECT user_id, display_name, age_years, bio, gender, pronouns,
            mbti_type, zodiac_sign, region_code, relationship_goal, interests
     FROM public.discoverable_profiles
     WHERE user_id <> $1
     ORDER BY display_name, user_id
     LIMIT $2`,
    [viewerId, limit],
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

module.exports = { listProfiles, listCoupleStories };
