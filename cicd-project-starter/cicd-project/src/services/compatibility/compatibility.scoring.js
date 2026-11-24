'use strict';

const {
  QUESTIONS,
  CATEGORIES,
  QUESTIONNAIRE_VERSION,
} = require('../../data/compatibilityQuestions');
const { validateAssessment } = require('./compatibility.validation');

// Product heuristics, not psychometric or relationship-success probabilities.
const ordered = {
  'goals-02': ['slow', 'steady', 'fast'],
  'communication-02': ['frequent', 'daily', 'fewdays'],
  'lifestyle-03': ['budget', 'occasional', 'experiences'],
  'lifestyle-04': ['structured', 'some', 'spontaneous'],
  'interests-04': ['often', 'sometimes', 'rarely'],
  'values-01': ['lots', 'balance', 'together'],
  'values-03': ['close', 'some', 'private'],
};
const flexible = new Set(['flexible', 'mix', 'varies', 'depends', 'discuss', 'situational']);

function validCompleted(assessment) {
  if (!assessment?.core_completed_at || assessment.questionnaire_version !== QUESTIONNAIRE_VERSION)
    return false;
  try {
    validateAssessment({
      revision: assessment.revision,
      action: 'complete',
      answers: assessment.answers,
      partnerPreferences: assessment.partner_preferences,
      skippedQuestionIds: assessment.skipped_question_ids,
    });
    return true;
  } catch {
    return false;
  }
}

function similarity(question, first, second) {
  if (question.maxSelections > 1) {
    const union = new Set([...first, ...second]);
    return first.filter((value) => second.includes(value)).length / union.size;
  }
  const [a] = first;
  const [b] = second;
  if (a === b) return 1;
  if (flexible.has(a) || flexible.has(b)) return 0.75;
  const scale = ordered[question.id];
  if (scale?.includes(a) && scale.includes(b)) {
    return 1 - Math.abs(scale.indexOf(a) - scale.indexOf(b)) / (scale.length - 1);
  }
  return 0;
}

function calculateCompatibility(first, second) {
  const unavailable = { score: null, status: 'incomplete', breakdown: [], shared: 0 };
  if (!validCompleted(first) || !validCompleted(second)) return unavailable;
  const totals = Object.fromEntries(
    Object.keys(CATEGORIES).map((key) => [key, { sum: 0, weight: 0, count: 0 }]),
  );
  let shared = 0;
  for (const question of QUESTIONS) {
    const a = first.answers[question.id];
    const b = second.answers[question.id];
    const pa = first.partner_preferences[question.id];
    const pb = second.partner_preferences[question.id];
    // Unknown answers cannot satisfy a hard requirement. Do not reveal which one.
    if (
      [
        { preference: pa, answer: b },
        { preference: pb, answer: a },
      ].some(
        ({ preference, answer }) =>
          preference?.dealbreaker &&
          (!answer?.length || !answer.every((value) => preference.accepted.includes(value))),
      )
    )
      return { ...unavailable, status: 'excluded' };
    if (!a?.length || !b?.length) continue;
    const baseline = similarity(question, a, b);
    const total = totals[question.category];
    for (const [preference, answer] of [
      [pa, b],
      [pb, a],
    ]) {
      const weight = preference?.importance ?? 1;
      const score = preference
        ? answer.filter((value) => preference.accepted.includes(value)).length / answer.length
        : baseline;
      total.sum += weight * score;
      total.weight += weight;
    }
    if ((pa?.importance ?? 1) + (pb?.importance ?? 1) > 0) {
      total.count += 1;
      shared += 1;
    }
  }
  const breakdown = Object.entries(CATEGORIES).map(([key, category]) => ({
    category: key,
    label: category.label,
    weight: category.weight,
    score: totals[key].weight ? Math.round((100 * totals[key].sum) / totals[key].weight) : null,
    shared: totals[key].count,
  }));
  // Require evidence across every category; importance=0 can remove evidence.
  if (shared < 10 || breakdown.some((item) => item.shared < 2)) return { ...unavailable, shared };
  const score = Math.round(
    Object.entries(CATEGORIES).reduce(
      (sum, [key, category]) =>
        sum + (category.weight * 100 * totals[key].sum) / totals[key].weight,
      0,
    ),
  );
  return { score, status: 'ready', breakdown, shared };
}

function accepts(profile, preferences, other) {
  if (!profile || !other || !Number.isFinite(other.age_years) || other.age_years < 18) return false;
  const p = preferences || {};
  if (p.preferred_genders?.length && !p.preferred_genders.includes(other.gender)) return false;
  if (
    p.hard_age !== false &&
    (other.age_years < (p.min_age ?? 18) || other.age_years > (p.max_age ?? 120))
  )
    return false;
  if (p.hard_region && !p.preferred_regions?.includes(other.region_code)) return false;
  if (p.hard_goal && !p.preferred_relationship_goals?.includes(other.relationship_goal))
    return false;
  // No coordinates exist in the current schema. Never pretend to satisfy distance.
  if (p.max_distance_km != null) return false;
  return true;
}

function reciprocalEligibility(first, second) {
  return (
    accepts(first.profile, first.preferences, second.profile) &&
    accepts(second.profile, second.preferences, first.profile)
  );
}

module.exports = { calculateCompatibility, reciprocalEligibility };
