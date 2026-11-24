const { QUESTIONS } = require('../../src/data/compatibilityQuestions');
const {
  calculateCompatibility,
  reciprocalEligibility,
} = require('../../src/services/compatibility/compatibility.scoring');
const {
  rankCandidates,
} = require('../../src/services/compatibility/compatibility.recommendations');
function completed() {
  return {
    questionnaire_version: 'compatibility-v1',
    core_completed_at: '2026-11-17',
    revision: 1,
    answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, [q.options[0].value]])),
    partner_preferences: {},
    skipped_question_ids: [],
  };
}
function member(id = 'a') {
  return {
    profile: {
      user_id: id,
      display_name: 'Member',
      age_years: 25,
      gender: 'woman',
      region_code: 'SG',
      relationship_goal: 'serious',
    },
    preferences: {},
    assessment: completed(),
  };
}
test('same complete answers score 100 with five category breakdowns', () => {
  const result = calculateCompatibility(completed(), completed());
  expect(result.score).toBe(100);
  expect(result.shared).toBe(15);
  expect(result.breakdown).toHaveLength(5);
});
test('incomplete or corrupt assessments never receive percentages', () => {
  expect(calculateCompatibility(null, completed()).score).toBeNull();
  const a = completed();
  delete a.answers['goals-01'];
  expect(calculateCompatibility(a, completed()).score).toBeNull();
  a.answers['goals-01'] = ['invalid'];
  expect(calculateCompatibility(a, completed()).score).toBeNull();
});
test('ordered answers receive partial credit and scores are symmetric', () => {
  const a = completed();
  const b = completed();
  b.answers['goals-02'] = ['steady'];
  const ab = calculateCompatibility(a, b);
  expect(ab.score).toBe(95);
  expect(calculateCompatibility(b, a)).toEqual(ab);
});
test('multi-select uses overlap instead of option count', () => {
  const a = completed();
  const b = completed();
  a.answers['interests-01'] = ['music', 'travel'];
  b.answers['interests-01'] = ['music', 'cooking'];
  expect(calculateCompatibility(a, b).score).toBe(98);
});
test('explicit partner preference supports complementary answers', () => {
  const a = completed();
  const b = completed();
  b.answers['goals-01'] = ['exploring'];
  const baseline = calculateCompatibility(a, b).score;
  a.partner_preferences['goals-01'] = {
    accepted: ['exploring'],
    importance: 3,
    dealbreaker: false,
  };
  expect(calculateCompatibility(a, b).score).toBeGreaterThan(baseline);
});
test('dealbreakers exclude in either direction', () => {
  const a = completed();
  const b = completed();
  a.partner_preferences['goals-01'] = { accepted: ['casual'], importance: 3, dealbreaker: true };
  expect(calculateCompatibility(a, b).status).toBe('excluded');
  expect(calculateCompatibility(b, a).status).toBe('excluded');
});
test('ignoring every question returns no fabricated score', () => {
  const a = completed();
  for (const q of QUESTIONS)
    a.partner_preferences[q.id] = {
      accepted: [q.options[0].value],
      importance: 0,
      dealbreaker: false,
    };
  expect(calculateCompatibility(a, a).score).toBeNull();
});
test('reciprocal age, gender, region and goal filters are enforced', () => {
  const a = member();
  const b = member('b');
  expect(reciprocalEligibility(a, b)).toBe(true);
  for (const preference of [
    { min_age: 30 },
    { preferred_genders: ['man'] },
    { hard_region: true, preferred_regions: ['MY'] },
    { hard_goal: true, preferred_relationship_goals: ['casual'] },
  ]) {
    b.preferences = preference;
    expect(reciprocalEligibility(a, b)).toBe(false);
    expect(reciprocalEligibility(b, a)).toBe(false);
  }
});
test('distance limits cannot be silently satisfied without coordinates', () => {
  const a = member();
  const b = member('b');
  b.preferences.max_distance_km = 10;
  expect(reciprocalEligibility(a, b)).toBe(false);
});
test('ranked output excludes private raw answers and preferences', () => {
  const viewer = member();
  const candidate = member('b');
  candidate.profile.private_secret = 'private';
  const rows = rankCandidates([{ viewer, candidate }]);
  expect(rows).toHaveLength(1);
  expect(rows[0].compatibility.score).toBe(100);
  expect(JSON.stringify(rows)).not.toMatch(
    /partner_preferences|private_secret|"answers"|"preferences"/,
  );
});
test('excluded and incomplete candidates are absent from recommendations', () => {
  const viewer = member();
  const candidate = member('b');
  candidate.assessment.core_completed_at = null;
  expect(rankCandidates([{ viewer, candidate }])).toEqual([]);
});
