const profileLists = {
  profiles: { heading: 'Discover people', path: '', empty: 'No profiles available.' },
  saved: {
    heading: 'Saved profiles',
    path: '/saved',
    empty: 'You have no visible saved profiles.',
  },
  hidden: {
    heading: 'Hidden profiles',
    path: '/hidden',
    empty: 'You have no visible hidden profiles.',
  },
};
const feeds = {
  profiles: { url: '/api/discovery/profiles' },
  stories: { url: '/api/discovery/couple-stories', empty: 'No published stories yet.' },
};
const tabs = [...document.querySelectorAll('[role="tab"]')];
const profileList = document.querySelector('#profile-list');
const profileFeedback = document.querySelector('#profile-feedback');
const profileActionStatus = document.querySelector('#profile-action-status');
const undoButton = document.querySelector('#undo-profile-hide');
const authorFilter = document.querySelector('#story-author');
const connectionsTab = document.querySelector('#connections-tab');
const connectionsStatus = document.querySelector('#connections-status');
const confirmation = document.querySelector('#connection-confirmation');
const connectionUrl = '/api/discovery/connections';
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
let stories = [];
let selectedProfile = null;
let lastHiddenProfile = null;
let changingProfileAction = false;
let connectionState = null;
let connectionRead;
let changingConnection = false;

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

function renderProfile(profile, listName) {
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
  const saveButton = card.querySelector('.profile-save');
  const hideButton = card.querySelector('.profile-hide');
  const isSaved = listName === 'saved' || profile.is_saved;
  saveButton.hidden = listName === 'hidden';
  saveButton.textContent = isSaved ? 'Unsave' : 'Save';
  saveButton.setAttribute('aria-label', `${saveButton.textContent} ${profile.display_name}`);
  saveButton.dataset.saved = String(Boolean(isSaved));
  saveButton.addEventListener('click', () => changeProfileAction(profile, 'saved', !isSaved));

  hideButton.hidden = listName === 'saved';
  hideButton.textContent = listName === 'hidden' ? 'Restore' : 'Hide';
  hideButton.setAttribute('aria-label', `${hideButton.textContent} ${profile.display_name}`);
  hideButton.addEventListener('click', () =>
    changeProfileAction(profile, 'hidden', listName !== 'hidden'),
  );
  const connectButton = card.querySelector('.profile-connect');
  connectButton.hidden = listName === 'hidden';
  connectButton.dataset.member = profile.user_id;
  connectButton.dataset.name = profile.display_name;
  connectButton.addEventListener('click', () => {
    if (pendingInvitation(profile.user_id)) {
      openConnections();
      return;
    }
    changeConnection('/requests', { targetId: profile.user_id }, (result) =>
      result.direction === 'sent'
        ? 'Invitation sent.'
        : 'You already have an invitation from this person.',
    );
    openConnections(false);
  });
  updateConnectButton(connectButton);
  return card;
}

function openConnections(refresh = true) {
  connectionsTab.focus();
  activateTab(connectionsTab, refresh);
}

function pendingInvitation(memberId) {
  return connectionState?.requests.find(
    (entry) => entry.member_id === memberId && entry.status === 'pending',
  );
}

function updateConnectButton(button) {
  const pending = pendingInvitation(button.dataset.member);
  button.textContent = pending
    ? pending.direction === 'sent'
      ? 'Request sent'
      : 'View invite'
    : 'Connect';
  button.dataset.pending = String(Boolean(pending));
  button.disabled = changingConnection;
  button.setAttribute('aria-label', `${button.textContent} · ${button.dataset.name}`);
}

function showBrowsingPause() {
  const paused = connectionState?.browsing === 'paused';
  document.querySelector('#profile-browser').hidden = paused;
  document.querySelector('#profiles-paused').hidden = !paused;
  if (!paused) return;
  feeds.profiles.request?.abort();
  document.querySelector('#profiles').replaceChildren();
  lastHiddenProfile = null;
  profileFeedback.hidden = true;
  document.querySelector('#profiles-paused-message').textContent =
    connectionState.active?.stage === 'dating'
      ? 'Single profiles are paused while you’re in a relationship. You can still browse Stories.'
      : 'Single profiles are paused while you’re talking. Your saved profiles will be here when browsing resumes.';
}

function connectionButton(label, action, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'feed-control connection-primary' : 'feed-control';
  button.textContent = label;
  button.disabled = changingConnection;
  button.addEventListener('click', action);
  return button;
}

function confirmConnection(title, detail, label, action) {
  if (changingConnection || confirmation.open) return;
  confirmation.querySelector('h3').textContent = title;
  confirmation.querySelector('p').textContent = detail;
  confirmation.querySelector('[value="confirm"]').textContent = label;
  confirmation.returnValue = '';
  confirmation.addEventListener(
    'close',
    () => {
      if (confirmation.returnValue === 'confirm') action();
    },
    { once: true },
  );
  confirmation.showModal();
}

function connectionRow(name, status, ...buttons) {
  const row = document.createElement('article');
  row.className = 'feed-card connection-row';
  const description = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = name || 'Luvora member';
  const detail = document.createElement('p');
  detail.className = 'feed-status';
  detail.textContent = status;
  description.append(title, detail);
  row.append(description);
  if (buttons.length) {
    const actions = document.createElement('div');
    actions.className = 'profile-card-actions';
    actions.append(...buttons);
    row.append(actions);
  }
  return row;
}

function invitationRow(entry) {
  const base = `/requests/${entry.id}`;
  const closed = {
    connection_started: 'Invitation closed because one of you connected with someone else.',
    unavailable: 'Invitation is no longer available.',
    rejected: 'Declined.',
    cancelled: 'Withdrawn.',
    expired: 'Expired.',
  };
  if (entry.status !== 'pending') {
    return connectionRow(entry.name, closed[entry.close_reason || entry.status]);
  }
  if (entry.direction === 'sent') {
    return connectionRow(
      entry.name,
      entry.actionable ? 'Waiting for a response.' : 'This invitation is currently unavailable.',
      connectionButton('Withdraw', () =>
        changeConnection(`${base}/withdraw`, {}, 'Invitation withdrawn.'),
      ),
    );
  }

  const decline = connectionButton('Decline', () =>
    changeConnection(`${base}/decline`, {}, 'Invitation declined.'),
  );
  if (!entry.actionable)
    return connectionRow(entry.name, 'This invitation is currently unavailable.', decline);
  return connectionRow(
    entry.name,
    'Invited you to talk.',
    decline,
    connectionButton(
      'Accept',
      () =>
        confirmConnection(
          `Start talking with ${entry.name || 'this member'}?`,
          'You’ll be getting to know each other. Single-profile browsing will pause for both of you, and your other pending invitations will close.',
          'Start talking',
          () => changeConnection(`${base}/accept`, {}, 'You’re now talking.'),
        ),
      true,
    ),
  );
}

function renderConnections() {
  showBrowsingPause();
  document.querySelectorAll('.profile-connect[data-member]').forEach(updateConnectButton);
  const { active, requests, browsing } = connectionState;
  const current = document.querySelector('#connection-active');
  const invitations = document.querySelector('#connection-invitations');
  current.hidden = !active;
  invitations.hidden = browsing === 'unavailable';
  document.querySelector('#refresh-connections').disabled = changingConnection;

  current.replaceChildren();
  if (active?.stage === 'dating') current.append(connectionRow(active.name, 'In a relationship'));
  if (active?.stage === 'talking') {
    current.append(
      connectionRow(
        active.name,
        'Talking · Getting to know each other',
        connectionButton('End connection', () =>
          confirmConnection(
            'End this connection?',
            'Single-profile browsing will resume for both of you. Closed invitations stay closed.',
            'End connection',
            () =>
              changeConnection(
                `/${active.id}/end`,
                { requestId: active.request_id },
                'Connection ended. You can browse profiles again.',
              ),
          ),
        ),
      ),
    );
  }

  for (const direction of ['received', 'sent', 'closed']) {
    const entries = requests.filter((entry) =>
      direction === 'closed'
        ? entry.status !== 'pending'
        : entry.status === 'pending' && entry.direction === direction,
    );
    const section = document.querySelector(`#connection-${direction}`);
    if (direction === 'closed')
      document.querySelector('#connection-history').hidden = !entries.length;
    section.replaceChildren(...entries.map(invitationRow));
    if (!entries.length && direction !== 'closed') {
      const empty = document.createElement('p');
      empty.className = 'feed-status';
      empty.textContent =
        direction === 'received' ? 'No incoming invitations.' : 'No pending sent invitations.';
      section.append(empty);
    }
  }
}

async function loadConnections({ quiet = false } = {}) {
  connectionRead?.abort();
  const request = new AbortController();
  connectionRead = request;
  try {
    const response = await fetch(connectionUrl, { signal: request.signal });
    if (response.status === 401) {
      if (!quiet) connectionsStatus.textContent = 'Sign in to view your connections.';
      return false;
    }
    if (!response.ok) throw new Error('Connection request failed');
    const next = await response.json();
    if (request.signal.aborted) return false;
    const previous = connectionState?.browsing;
    const changed = JSON.stringify(connectionState) !== JSON.stringify(next);
    connectionState = next;
    if (changed || !quiet) renderConnections();
    if (!quiet || connectionsStatus.dataset.loading === 'true') {
      connectionsStatus.textContent =
        next.browsing === 'unavailable' ? 'Connections are unavailable for this account.' : '';
      delete connectionsStatus.dataset.loading;
    }
    if (
      previous === 'paused' &&
      next.browsing !== 'paused' &&
      tabs[0].getAttribute('aria-selected') === 'true'
    ) {
      loadFeed('profiles');
    }
    return true;
  } catch {
    if (!quiet && !request.signal.aborted)
      connectionsStatus.textContent = 'Could not load connections. Use Refresh to try again.';
    return false;
  } finally {
    if (connectionRead === request) connectionRead = null;
  }
}

async function changeConnection(path, body, message) {
  if (changingConnection) return;
  changingConnection = true;
  connectionRead?.abort();
  document.querySelectorAll('#connections-panel button, .profile-connect').forEach((button) => {
    button.disabled = true;
  });
  connectionsStatus.textContent = 'Updating connections…';
  let resultMessage;
  try {
    const response = await fetch(connectionUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = response.status === 204 ? {} : await response.json();
    resultMessage = response.ok
      ? typeof message === 'function'
        ? message(result)
        : message
      : result.error;
  } catch {
    resultMessage = 'Could not confirm the change. Check your invitations before retrying.';
  }
  changingConnection = false;
  const refreshed = await loadConnections();
  connectionsStatus.textContent = resultMessage || 'Could not update connections. Try again.';
  if (!refreshed) {
    connectionsStatus.textContent += ' Use Refresh to check the latest state.';
    document.querySelector('#refresh-connections').disabled = false;
    if (connectionState) renderConnections();
    if (tabs[0].getAttribute('aria-selected') === 'true') loadFeed('profiles');
  }
  if (
    document.activeElement === document.body &&
    !document.querySelector('#connections-panel').hidden
  ) {
    document.querySelector('#connections-panel').focus();
  }
}

function showProfileFeedback(message) {
  profileFeedback.hidden = false;
  profileActionStatus.textContent = message;
  undoButton.hidden = !lastHiddenProfile;
}

async function changeProfileAction(profile, action, enable) {
  if (changingProfileAction) return;
  changingProfileAction = true;
  const buttons = [...document.querySelectorAll('.profile-save, .profile-hide'), undoButton];
  const originalFocus = document.activeElement;
  const restoreFocus = buttons.includes(originalFocus);
  buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const response = await fetch(`${feeds.profiles.url}/${profile.user_id}/${action}`, {
      method: enable ? 'PUT' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (response.status === 401) {
      showProfileFeedback('Sign in to manage profiles.');
      return;
    }
    if (response.status === 404) {
      showProfileFeedback('This profile is no longer available.');
    } else if (response.status === 403) {
      showProfileFeedback((await response.json()).error);
      await loadConnections({ quiet: true });
    } else {
      if (!response.ok) throw new Error('Profile action failed');
      if (action === 'hidden' && enable) {
        lastHiddenProfile = profile;
        showProfileFeedback(`Hidden ${profile.display_name} from For You.`);
      } else if (action === 'hidden') {
        if (lastHiddenProfile?.user_id === profile.user_id) lastHiddenProfile = null;
        showProfileFeedback(`Restored ${profile.display_name} to For You.`);
      } else {
        showProfileFeedback(
          enable
            ? `Saved ${profile.display_name}.`
            : `Removed ${profile.display_name} from saved profiles.`,
        );
      }
    }

    await loadFeed('profiles');
    if (
      restoreFocus &&
      [document.body, originalFocus].includes(document.activeElement) &&
      tabs[0].getAttribute('aria-selected') === 'true'
    ) {
      undoButton.disabled = false;
      (action === 'hidden' && enable && !undoButton.hidden ? undoButton : profileList).focus();
    }
  } catch {
    showProfileFeedback('Could not update this profile. Try again.');
  } finally {
    changingProfileAction = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
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
  if (name === 'profiles' && connectionState?.browsing === 'paused') return;
  const feed = feeds[name];
  feed.request?.abort();
  const request = new AbortController();
  feed.request = request;
  const listName = profileList.value;
  const profileView = profileLists[listName];
  const status = document.querySelector(`#${name}-status`);
  const retry = document.querySelector(`[data-retry="${name}"]`);
  const list = document.querySelector(`#${name}`);
  const count = document.querySelector('#profiles-count');
  status.hidden = false;
  status.textContent = name === 'profiles' ? 'Loading profiles…' : 'Loading stories…';
  retry.hidden = true;
  list.replaceChildren();
  if (name === 'profiles') {
    count.textContent = '';
    document.querySelector('#profiles-heading').textContent = profileView.heading;
  } else document.querySelector('#story-filter').hidden = true;
  try {
    const url = name === 'profiles' ? feed.url + profileView.path : feed.url;
    const response = await fetch(url, { signal: request.signal });
    if (request.signal.aborted) return;
    if (response.status === 401) {
      status.textContent = 'Sign in to view this section.';
      return;
    }
    if (name === 'profiles' && response.status === 403) {
      status.textContent = (await response.json()).error;
      if (!changingConnection && !connectionRead) void loadConnections({ quiet: true });
      return;
    }
    if (!response.ok) throw new Error('Feed request failed');
    const rows = await response.json();
    if (request.signal.aborted) return;

    if (name === 'stories') {
      setStories(rows);
    } else {
      list.replaceChildren(...rows.map((profile) => renderProfile(profile, listName)));
      status.hidden = rows.length > 0;
      status.textContent = profileView.empty;
      count.textContent = rows.length === 1 ? '1 profile' : `${rows.length} profiles`;
    }
  } catch {
    if (request.signal.aborted) return;
    status.textContent = 'Could not load this section.';
    retry.hidden = false;
  } finally {
    if (feed.request === request) feed.request = null;
  }
}

function activateTab(tab, refresh = true) {
  for (const current of tabs) {
    const active = current === tab;
    current.setAttribute('aria-selected', String(active));
    current.tabIndex = active ? 0 : -1;
    document.getElementById(current.getAttribute('aria-controls')).hidden = !active;
  }
  if (tab === connectionsTab) {
    if (refresh && !changingConnection) void loadConnections();
  } else {
    if (tab === tabs[0] && !changingConnection) void loadConnections({ quiet: true });
    void loadFeed(tab === tabs[1] ? 'stories' : 'profiles');
  }
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
profileList.addEventListener('change', () => loadFeed('profiles'));
undoButton.addEventListener('click', () => {
  if (lastHiddenProfile) changeProfileAction(lastHiddenProfile, 'hidden', false);
});
authorFilter.addEventListener('change', () => {
  if (authorFilter.value !== selectedProfile?.user_id) selectedProfile = null;
  renderStories();
});
document.querySelector('#manage-connection').addEventListener('click', () => openConnections());
document.querySelector('#refresh-connections').addEventListener('click', () => loadConnections());
function refreshVisibleConnections() {
  if (!document.hidden && !changingConnection && !confirmation.open && !connectionRead) {
    void loadConnections({ quiet: true });
  }
}
document.addEventListener('visibilitychange', refreshVisibleConnections);
window.addEventListener('focus', refreshVisibleConnections);
window.setInterval(refreshVisibleConnections, 10000);
activateTab(tabs[0]);
