'use strict';

const createError = require('http-errors');
const pool = require('../../db/pool');
const { calculateCompatibility, reciprocalEligibility } = require('./compatibility.scoring');

function rankCandidates(rows) {
  return rows
    .flatMap(({ viewer, candidate }) => {
      if (!reciprocalEligibility(viewer, candidate)) return [];
      const compatibility = calculateCompatibility(viewer.assessment, candidate.assessment);
      if (compatibility.status !== 'ready') return [];
      // Explicit public field allowlist. Never serialize a database snapshot.
      const p = candidate.profile;
      return [
        {
          is_saved: candidate.is_saved === true,
          user_id: p.user_id,
          display_name: p.display_name,
          age_years: p.age_years,
          bio: p.bio,
          gender: p.gender,
          pronouns: p.pronouns,
          mbti_type: p.mbti_type,
          zodiac_sign: p.zodiac_sign,
          region_code: p.region_code,
          relationship_goal: p.relationship_goal,
          interests: p.interests,
          compatibility,
        },
      ];
    })
    .sort(
      (a, b) => b.compatibility.score - a.compatibility.score || a.user_id.localeCompare(b.user_id),
    )
    .slice(0, 30);
}

async function recommendations(userId) {
  if (!process.env.DATABASE_URL) throw createError(503, 'Database is not configured.');
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN READ ONLY');
    // This connection is backend-only. Never ship DATABASE_URL to a browser.
    await client.query('SET LOCAL ROLE service_role');
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const { rows } = await client.query('SELECT * FROM public.compatibility_candidate_snapshots()');
    const results = rankCandidates(rows);
    await client.query('COMMIT');
    return results;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

module.exports = { recommendations, rankCandidates };
