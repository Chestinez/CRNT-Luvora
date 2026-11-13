const feeds = {
  profiles: { url: '/api/discovery/profiles', empty: 'No profiles available.' },
  stories: { url: '/api/discovery/couple-stories', empty: 'No published stories yet.' },
};
const tabs = [...document.querySelectorAll('[role="tab"]')];
const authorFilter = document.querySelector('#story-author');
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
let stories = [];
let selectedProfile = null;

function readableLabel(value) {
  return value.replaceAll(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function setTags(card, values) {
  const tags = card.querySelector('.feed-tags');
  for (const value of values) {
    const tag = document.createElement('li');
    tag.textContent = readableLabel(value);
    tags.append(tag);
  }
  tags.hidden = !values.length;
}

function addFact(facts, name, value) {
  if (!value) return;
  const tile = document.createElement('div');
  const label = document.createElement('dt');
  const text = document.createElement('dd');
  label.textContent = name;
  text.textContent = value;
  tile.append(label, text);
  facts.append(tile);
}

function renderProfile(profile) {
  const card = document.querySelector('#profile-card').content.cloneNode(true);
  card.querySelector('.profile-cover span').textContent =
    Array.from(profile.display_name.trim())[0]?.toLocaleUpperCase() || '?';
  card.querySelector('h3').textContent = [profile.display_name, profile.age_years]
    .filter((value) => value != null)
    .join(', ');

  const bio = card.querySelector('.card-bio');
  bio.textContent = profile.bio || '';
  bio.hidden = !profile.bio;
  const facts = card.querySelector('.profile-facts');
  const code = profile.region_code;
  const location = /^[A-Za-z]{2}$/.test(code ?? '') ? regionNames.of(code.toUpperCase()) : code;
  addFact(facts, 'Location', location);
  addFact(
    facts,
    'Looking for',
    profile.relationship_goal && readableLabel(profile.relationship_goal),
  );
  addFact(facts, 'MBTI', profile.mbti_type);
  addFact(facts, 'Zodiac', profile.zodiac_sign);
  addFact(facts, 'Gender', profile.gender && readableLabel(profile.gender));
  addFact(facts, 'Pronouns', profile.pronouns);
  facts.hidden = !facts.childElementCount;
  setTags(card, profile.interests ?? []);
  const storyButton = card.querySelector('.profile-stories');
  storyButton.setAttribute('aria-label', `View stories by ${profile.display_name}`);
  storyButton.addEventListener('click', () => {
    selectedProfile = profile;
    tabs[1].focus();
    activateTab(tabs[1]);
  });
  return card;
}

function renderStory(story) {
  const card = document.querySelector('#story-card').content.cloneNode(true);
  card.querySelector('h3').textContent = story.title || 'Couple story';
  card.querySelector('.card-bio').textContent = story.caption;
  card.querySelector('.story-byline span').textContent = story.author_name;
  const time = card.querySelector('time');
  time.dateTime = story.published_at;
  time.textContent = dateFormat.format(new Date(story.published_at));
  setTags(card, story.topics ?? []);
  return card;
}

function renderStories() {
  const visible = stories.filter(
    ({ author_id }) => !authorFilter.value || author_id === authorFilter.value,
  );
  document.querySelector('#stories').replaceChildren(...visible.map(renderStory));
  const status = document.querySelector('#stories-status');
  status.hidden = visible.length > 0;
  status.textContent = authorFilter.value
    ? 'No published stories by this author.'
    : feeds.stories.empty;
}

function setStories(rows) {
  stories = rows;
  const selected = selectedProfile?.user_id ?? authorFilter.value;
  const authors = new Map(
    stories
      .filter(({ author_id }) => author_id)
      .map(({ author_id, author_name }) => [author_id, author_name]),
  );
  if (selectedProfile) authors.set(selectedProfile.user_id, selectedProfile.display_name);
  authorFilter.replaceChildren(new Option('All authors', ''));
  for (const [id, name] of authors) authorFilter.add(new Option(name, id));
  authorFilter.value = authors.has(selected) ? selected : '';
  document.querySelector('#story-filter').hidden = authors.size < 2 && !selectedProfile;
  renderStories();
}

async function loadFeed(name) {
  const feed = feeds[name];
  if (feed.loading) return;
  feed.loading = true;
  const status = document.querySelector(`#${name}-status`);
  const retry = document.querySelector(`[data-retry="${name}"]`);
  const list = document.querySelector(`#${name}`);
  const count = document.querySelector('#profiles-count');
  status.hidden = false;
  status.textContent = name === 'profiles' ? 'Loading profiles…' : 'Loading stories…';
  retry.hidden = true;
  list.replaceChildren();
  if (name === 'profiles') count.textContent = '';
  else document.querySelector('#story-filter').hidden = true;
  try {
    const response = await fetch(feed.url);
    if (response.status === 401) {
      status.textContent = 'Sign in to view this section.';
      return;
    }
    if (!response.ok) throw new Error('Feed request failed');
    const rows = await response.json();

    if (name === 'stories') {
      setStories(rows);
    } else {
      list.replaceChildren(...rows.map(renderProfile));
      status.hidden = rows.length > 0;
      status.textContent = feed.empty;
      count.textContent = rows.length === 1 ? '1 profile' : `${rows.length} profiles`;
    }
  } catch {
    status.textContent = 'Could not load this section.';
    retry.hidden = false;
  } finally {
    feed.loading = false;
  }
}

function activateTab(tab) {
  for (const current of tabs) {
    const active = current === tab;
    current.setAttribute('aria-selected', String(active));
    current.tabIndex = active ? 0 : -1;
    document.getElementById(current.getAttribute('aria-controls')).hidden = !active;
  }
  loadFeed(tab.id === 'stories-tab' ? 'stories' : 'profiles');
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    const nextIndex = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    tabs[nextIndex].focus();
    activateTab(tabs[nextIndex]);
  });
}

for (const button of document.querySelectorAll('[data-retry]')) {
  button.addEventListener('click', () => loadFeed(button.dataset.retry));
}
authorFilter.addEventListener('change', () => {
  if (authorFilter.value !== selectedProfile?.user_id) selectedProfile = null;
  renderStories();
});
activateTab(tabs[0]);
