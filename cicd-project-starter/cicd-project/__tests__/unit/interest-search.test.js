jest.mock('@huggingface/transformers', () => ({ pipeline: jest.fn() }));

function setup() {
  jest.resetModules();
  return {
    pipeline: require('@huggingface/transformers').pipeline,
    rankInterestSearch: require('../../src/services/discovery/interest-search').rankInterestSearch,
  };
}

test('semantic search ranks public interests and descriptions without indexing display names', async () => {
  const { pipeline, rankInterestSearch } = setup();
  const examples = new Map([
    ['time on nature trails', [1, 0]],
    ['hiking', [0.8, 0.6]],
    ['I enjoy spending weekends outdoors.', [0.6, 0.8]],
    ['chess', [0, 1]],
    ['Maya', [-1, 0]],
  ]);
  const extractor = jest.fn(async (texts) => ({
    tolist: () => texts.map((text) => examples.get(text)),
  }));
  pipeline.mockResolvedValue(extractor);
  const candidates = [
    {
      user_id: 'a',
      display_name: 'Maya',
      interests: ['hiking'],
      bio: 'I enjoy spending weekends outdoors.',
    },
    { user_id: 'b', display_name: 'Kai', interests: ['chess'] },
  ].map((candidate) => ({ ...candidate, keyword_fit: 0 }));

  await expect(rankInterestSearch('time on nature trails', candidates)).resolves.toEqual({
    ids: ['a'],
    mode: 'semantic',
  });
  await expect(rankInterestSearch('Maya', [candidates[0]])).resolves.toEqual({
    ids: [],
    mode: 'semantic',
  });
  expect(extractor.mock.calls[1][0]).toEqual([
    'hiking',
    'I enjoy spending weekends outdoors.',
    'chess',
  ]);
});

test('an unavailable model falls back to relevant keywords and labels the mode', async () => {
  const { pipeline, rankInterestSearch } = setup();
  pipeline.mockRejectedValue(new Error('Model files unavailable'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(
      rankInterestSearch('coffee', [
        { user_id: 'unrelated', keyword_fit: 0 },
        { user_id: 'in-bio', keyword_fit: '0.8' },
        { user_id: 'in-tags', keyword_fit: '1' },
      ]),
    ).resolves.toEqual({ ids: ['in-tags', 'in-bio'], mode: 'keywords' });
  } finally {
    warn.mockRestore();
  }
});
