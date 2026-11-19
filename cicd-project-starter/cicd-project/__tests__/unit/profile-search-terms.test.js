jest.mock('../../src/services/discovery/discovery.service', () => ({
  searchProfiles: jest.fn(),
}));

const { containsBlockedSearchTerm } = require('../../src/services/discovery/search-terms');
const { searchProfiles } = require('../../src/controllers/discovery/discovery.controller');
const discovery = require('../../src/services/discovery/discovery.service');

test.each([
  'anyone who likes f*ck',
  'F**KING!',
  'f . u . c . k',
  'sH1t!',
  'ｆｕｃｋ',
  'f\u200Buck',
  'fúck',
  'B!TCH',
  'p*rn',
  'photo-walks and NSFW content',
])('blocks %s', (query) => {
  expect(containsBlockedSearchTerm(query)).toBe(true);
});

test.each([
  'cocktail making',
  'assignment buddies',
  'visiting Scunthorpe',
  'shitake mushrooms',
  'board games and coffee',
  'C# and C++ projects',
  '中文和咖啡',
])('allows %s', (query) => {
  expect(containsBlockedSearchTerm(query)).toBe(false);
});

test('a blocked query returns an actionable error before searching profiles', async () => {
  const req = {
    user: { id: '00000000-0000-4000-8000-000000000001' },
    is: () => true,
    body: { query: 'f*ck' },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await searchProfiles(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'blocked_search_term' }));
  expect(discovery.searchProfiles).not.toHaveBeenCalled();
});
