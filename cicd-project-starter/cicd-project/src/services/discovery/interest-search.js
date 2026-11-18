const model = 'Xenova/all-MiniLM-L6-v2';
const revision = '751bff37182d3f1213fa05d7196b954e230abad9';
const resultLimit = 24;
const vectorCache = new Map();
let extractor;
let retryAfter = 0;
let pending = Promise.resolve();

function publicSearchText(profile) {
  const descriptors = [...(profile.interests ?? []).slice(0, 12), profile.relationship_goal]
    .filter(Boolean)
    .map((descriptor) => descriptor.replaceAll(/[_-]+/g, ' '));
  const combined = descriptors.length > 1 ? descriptors.join(', ') : '';
  return [...descriptors, combined, profile.bio?.trim().slice(0, 800)].filter(Boolean);
}

async function embed(pipe, texts) {
  const result = await pipe(texts, { pooling: 'mean', normalize: true });
  return result.tolist();
}

async function profileVectors(pipe, documents) {
  const vectors = new Map();
  const missing = [];
  for (const text of new Set(documents.flat())) {
    const vector = vectorCache.get(text);
    if (vector) {
      vectorCache.delete(text);
      vectorCache.set(text, vector);
      vectors.set(text, vector);
    } else {
      missing.push(text);
    }
  }

  for (let i = 0; i < missing.length; i += 12) {
    const batch = missing.slice(i, i + 12);
    const embeddings = await embed(pipe, batch);
    for (const [index, text] of batch.entries()) {
      vectors.set(text, embeddings[index]);
      vectorCache.set(text, embeddings[index]);
    }
  }
  while (vectorCache.size > 1024) vectorCache.delete(vectorCache.keys().next().value);
  return vectors;
}

function cosine(a, b) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function topMatches(rows) {
  return rows
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, resultLimit)
    .map(({ id }) => id);
}

async function rank(query, candidates) {
  if (!candidates.length) return { ids: [], mode: 'semantic' };
  if (Date.now() >= retryAfter) {
    try {
      if (!extractor) {
        const { pipeline } = require('@huggingface/transformers');
        extractor = await pipeline('feature-extraction', model, {
          revision,
          dtype: 'q8',
          session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
        });
      }
      const documents = candidates.map(publicSearchText);
      const [queryVector] = await embed(extractor, [query]);
      const vectors = await profileVectors(extractor, documents);
      const scores = candidates.flatMap(({ user_id, keyword_fit }, i) => {
        const semantic = Math.max(
          0,
          ...documents[i].map((text) => cosine(queryVector, vectors.get(text))),
        );
        const keyword = Number(keyword_fit);
        if (semantic < 0.38 && keyword < 0.25) return [];
        return [{ id: user_id, score: 0.78 * semantic + 0.22 * keyword, keyword }];
      });
      const best = Math.max(0, ...scores.map(({ score }) => score));
      const relevant = scores.filter(
        ({ score, keyword }) => score >= best - 0.16 || keyword >= 0.5,
      );
      return { ids: topMatches(relevant), mode: 'semantic' };
    } catch (error) {
      retryAfter = Date.now() + 60_000;
      await extractor?.dispose().catch(() => {});
      extractor = null;
      console.warn(
        'Luvora interest search is using keywords while the local model is unavailable.',
        error.name,
      );
    }
  }
  return {
    ids: topMatches(
      candidates
        .filter(({ keyword_fit }) => Number(keyword_fit) >= 0.25)
        .map(({ user_id, keyword_fit }) => ({ id: user_id, score: Number(keyword_fit) })),
    ),
    mode: 'keywords',
  };
}

function rankInterestSearch(query, candidates) {
  // A single model serves searches sequentially and shares cached public profile vectors.
  const result = pending.then(() => rank(query, candidates));
  pending = result.catch(() => {});
  return result;
}

module.exports = { rankInterestSearch };
