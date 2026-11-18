const profileLists = {
  compatibility: {
    heading: 'Discover people',
    path: '/compatibility',
    empty: 'No eligible profiles match both people’s requirements.',
  },
  saved: {
    heading: 'Liked profiles',
    path: '/saved',
    empty: 'You have no liked profiles here.',
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
const tabList = document.querySelector('[role="tablist"]');
const tabs = [...tabList.querySelectorAll('[role="tab"]')];
const profileListsNav = document.querySelector('#profile-lists');
const searchStatus = document.querySelector('#search-status');
const reloadProfiles = document.querySelector('#reload-profiles');
const profileSearch = document.querySelector('#profile-search');
const profileQuery = document.querySelector('#profile-query');
const clearProfileQuery = document.querySelector('#clear-profile-query');
const profileStage = document.querySelector('#profiles');
const profileDetails = document.querySelector('#profile-details');
const profileAnnouncement = document.querySelector('#profile-announcement');
const topPicks = document.querySelector('#top-picks');
const profilePageStatus = document.querySelector('#profiles-page-status');
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
let nextCompatibilityPage = null;
let profilesLoaded = false;
let profileRows = [];
let profileIndex = 0;
let activeProfileList = 'compatibility';
let profileSearchQuery = '';
let compatibilityRead;

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

function profileInitial(profile) {
  return Array.from(profile.display_name.trim())[0]?.toLocaleUpperCase() || '?';
}

function profileLocation(profile) {
  const code = profile.region_code;
  return /^[A-Za-z]{2}$/.test(code ?? '') ? regionNames.of(code.toUpperCase()) : code;
}

function profileTone(profile) {
  const nameSum = Array.from(profile.display_name).reduce((sum, ch) => sum + ch.codePointAt(0), 0);
  return `profile-tone-${(nameSum % 4) + 1}`;
}

function updateLikeButton(button, profile, listName) {
  const liked = listName === 'saved' || profile.is_saved === true;
  button.hidden = listName === 'hidden';
  button.textContent = liked ? '♥ Liked' : '♡ Like';
  button.setAttribute('aria-label', `Like ${profile.display_name}`);
  button.setAttribute('aria-pressed', String(liked));
  button.dataset.saved = String(liked);
  button.disabled = changingProfileAction;
}

function renderProfile(profile, listName) {
  const card = document.querySelector('#profile-card').content.cloneNode(true);
  const cover = card.querySelector('.profile-cover');
  cover.classList.add(profileTone(profile));
  for (const mark of cover.querySelectorAll('.cover-initial, .profile-cover-avatar')) {
    mark.textContent = profileInitial(profile);
  }
  for (const arrow of cover.querySelectorAll('[data-step]')) {
    arrow.addEventListener('click', () => {
      if (arrow.getAttribute('aria-disabled') === 'false') moveProfile(Number(arrow.dataset.step));
    });
  }
  card.querySelector('h3').textContent = [profile.display_name, profile.age_years]
    .filter((value) => value != null)
    .join(', ');
  const location = card.querySelector('.profile-location');
  location.textContent = profileLocation(profile) || '';
  location.hidden = !location.textContent;
  const bio = card.querySelector('.card-bio');
  bio.textContent = profile.bio || '';
  card.querySelector('.profile-summary').hidden = !bio.textContent;
  const interests = profile.interests ?? [];
  setTags(card, interests);
  card.querySelector('.profile-interests').hidden = !interests.length;
  const storyButton = card.querySelector('.profile-stories');
  storyButton.setAttribute('aria-label', `View stories by ${profile.display_name}`);
  storyButton.addEventListener('click', () => {
    selectedProfile = profile;
    tabs[1].focus();
    activateTab(tabs[1]);
  });

  const saveButton = card.querySelector('.profile-save');
  updateLikeButton(saveButton, profile, listName);
  saveButton.addEventListener('click', () =>
    changeProfileAction(profile, 'saved', saveButton.getAttribute('aria-pressed') === 'false'),
  );

  const hideButton = card.querySelector('.profile-hide');
  hideButton.hidden = listName === 'saved';
  hideButton.disabled = changingProfileAction;
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
    confirmConnection(
      `Send a connection invitation to ${profile.display_name}?`,
      `${profile.display_name} can accept your invitation to start talking.`,
      'Send invitation',
      () => {
        void changeConnection('/requests', { targetId: profile.user_id }, (result) =>
          result.direction === 'sent'
            ? 'Invitation sent.'
            : 'You already have an invitation from this person.',
        );
        openConnections(false);
      },
    );
  });
  updateConnectButton(connectButton);

  card.querySelector('.swipe-hint').textContent = connectButton.hidden
    ? 'Swipe ↓ next · ↑ previous'
    : 'Swipe ↓ next · ↑ previous · → connect';
  bindProfileSwipe(cover, connectButton);
  return card;
}

function bindProfileSwipe(cover, connectButton) {
  let origin;
  cover.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
    origin = { id: event.pointerId, x: event.clientX, y: event.clientY };
    cover.setPointerCapture(event.pointerId);
  });
  cover.addEventListener('lostpointercapture', (event) => {
    if (origin?.id === event.pointerId) origin = null;
  });
  cover.addEventListener('pointerup', (event) => {
    if (origin?.id !== event.pointerId) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    origin = null;
    if (Math.abs(dy) >= 56 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      moveProfile(dy > 0 ? 1 : -1);
    } else if (dx >= 56 && dx > Math.abs(dy) * 1.2 && !connectButton.hidden) {
      connectButton.click();
    }
  });
}

function renderProfileDetails(profile, listName) {
  compatibilityRead?.abort();
  compatibilityRead = null;
  const facts = profileDetails.querySelector('#details-title + .profile-facts');
  const fit = profileDetails.querySelector('#profile-fit');
  const summary = fit.querySelector('#profile-match');
  const directions = fit.querySelector('#profile-fit-directions');
  const common = fit.querySelector('#profile-common');
  facts.replaceChildren();
  directions.replaceChildren();
  common.hidden = true;
  if (!profile) {
    profileDetails.hidden = true;
    return;
  }
  addFact(
    facts,
    'Looking for',
    profile.relationship_goal && readableLabel(profile.relationship_goal),
  );
  addFact(facts, 'Gender', profile.gender && readableLabel(profile.gender));
  addFact(facts, 'Pronouns', profile.pronouns);
  addFact(facts, 'MBTI', profile.mbti_type);
  addFact(facts, 'Zodiac', profile.zodiac_sign);

  fit.hidden = listName === 'hidden';
  profileDetails.hidden = !facts.childElementCount && fit.hidden;
  if (fit.hidden) return;
  summary.textContent = Number.isInteger(profile.alignment)
    ? profile.alignment + '% mutual alignment'
    : 'Checking compatibility…';
  void loadProfileCompatibility(profile, summary, directions, common);
}

async function loadProfileCompatibility(profile, summary, directions, common) {
  const request = new AbortController();
  compatibilityRead = request;
  try {
    const response = await fetch(
      feeds.profiles.url + '/' + encodeURIComponent(profile.user_id) + '/compatibility',
      { signal: request.signal },
    );
    if (!response.ok) throw new Error('Compatibility details unavailable');
    const result = await response.json();
    if (request.signal.aborted) return;
    summary.textContent = Number.isInteger(result.alignment)
      ? result.alignment + '% mutual alignment'
      : 'Limited preference data';
    addFact(
      directions,
      'They fit your preferences',
      result.fits_your_preferences ? readableLabel(result.fits_your_preferences) : 'Limited data',
    );
    addFact(
      directions,
      'You fit their preferences',
      result.fits_their_preferences ? readableLabel(result.fits_their_preferences) : 'Limited data',
    );
    const shared = result.shared_interests?.map(readableLabel) ?? [];
    const commonGround = [];
    if (shared.length) commonGround.push('Shared interests: ' + shared.join(', '));
    if (result.shared_goal) commonGround.push('Same relationship goal');
    common.textContent = commonGround.join(' · ');
    common.hidden = !commonGround.length;
  } catch {
    if (request.signal.aborted) return;
    if (!Number.isInteger(profile.alignment))
      summary.textContent = 'Compatibility details unavailable.';
    if (Number.isInteger(profile.shared_count) && profile.shared_count > 0) {
      common.textContent =
        profile.shared_count +
        (profile.shared_count === 1 ? ' shared interest' : ' shared interests');
      common.hidden = false;
    }
  } finally {
    if (compatibilityRead === request) compatibilityRead = null;
  }
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
  profileListsNav.hidden = paused || tabs[0].getAttribute('aria-selected') !== 'true';
  if (!paused) return;
  feeds.profiles.request?.abort();
  feeds.profiles.request = null;
  profilesLoaded = false;
  profileRows = [];
  nextCompatibilityPage = null;
  reloadProfiles.hidden = true;
  showProfileAt(0);
  profilePageStatus.textContent = '';
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
      void loadProfiles();
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
    if (tabs[0].getAttribute('aria-selected') === 'true') void loadProfiles();
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
  const actionButtons = '.profile-save, .profile-hide, #undo-profile-hide';
  const originalFocus = document.activeElement;
  const restoreFocus = originalFocus.matches(actionButtons);
  document.querySelectorAll(actionButtons).forEach((button) => {
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
    if (response.status === 403) {
      showProfileFeedback((await response.json()).error);
      await loadConnections({ quiet: true });
      return;
    }
    if (response.status === 404) {
      showProfileFeedback('This profile is no longer available.');
      await loadProfiles();
      return;
    }
    if (!response.ok) throw new Error('Profile action failed');

    const shown = profileRows[profileIndex];
    const listName = activeProfileList;
    const row = profileRows.find(({ user_id }) => user_id === profile.user_id);
    if (action === 'hidden') {
      if (enable) {
        lastHiddenProfile = profile;
        showProfileFeedback(`Hidden ${profile.display_name} from recommendations.`);
      } else {
        if (lastHiddenProfile?.user_id === profile.user_id) lastHiddenProfile = null;
        showProfileFeedback(`Restored ${profile.display_name} to recommendations.`);
      }
    } else {
      showProfileFeedback(
        enable ? `Liked ${profile.display_name}.` : `Unliked ${profile.display_name}.`,
      );
    }

    const removesRow =
      (action === 'saved' && listName === 'saved' && !enable) ||
      (action === 'hidden' && listName === (enable ? 'compatibility' : 'hidden'));
    const addsRow =
      (action === 'saved' && listName === 'saved' && enable) ||
      (action === 'hidden' && listName === (enable ? 'hidden' : 'compatibility'));
    if (addsRow || feeds.profiles.request) {
      await loadProfiles({ selectId: shown?.user_id });
    } else if (removesRow && row) {
      profileRows = profileRows.filter(({ user_id }) => user_id !== profile.user_id);
      const visible = profileRows;
      const retained = visible.findIndex(({ user_id }) => user_id === shown?.user_id);
      showProfileAt(retained < 0 ? profileIndex : retained);
      if (!visible.length && nextCompatibilityPage) {
        await loadProfiles({ append: true });
      } else if (!visible.length) {
        const status = document.querySelector('#profiles-status');
        status.hidden = false;
        status.textContent = profileSearchQuery
          ? 'No profiles match this search.'
          : profileLists[listName].empty;
      }
    } else if (action === 'saved' && row) {
      row.is_saved = enable;
      if (shown === row)
        updateLikeButton(profileStage.querySelector('.profile-save'), row, listName);
    }
  } catch {
    showProfileFeedback('Could not update this profile. Try again.');
  } finally {
    changingProfileAction = false;
    document.querySelectorAll(actionButtons).forEach((button) => {
      button.disabled = false;
    });
    if (
      restoreFocus &&
      document.activeElement === document.body &&
      tabs[0].getAttribute('aria-selected') === 'true' &&
      connectionState?.browsing !== 'paused'
    ) {
      const stillShown = profileRows[profileIndex]?.user_id === profile.user_id;
      const like = stillShown && action === 'saved' && profileStage.querySelector('.profile-save');
      const target =
        like ||
        (!undoButton.hidden && undoButton) ||
        profileStage.querySelector('h3') ||
        profileListsNav.querySelector('[aria-pressed="true"]');
      target.focus();
    }
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

function syncTopPicks(profile) {
  const picks =
    activeProfileList === 'compatibility' && !profileSearchQuery ? profileRows.slice(0, 4) : [];
  topPicks.hidden = !picks.length;
  const list = topPicks.querySelector('#top-pick-list');
  const key = JSON.stringify(picks.map((pick) => pick.user_id));
  if (list.dataset.picks !== key) {
    list.dataset.picks = key;
    list.replaceChildren(
      ...picks.map((pick, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `feed-control top-pick ${profileTone(pick)}`;
        button.dataset.member = pick.user_id;

        const avatar = document.createElement('span');
        avatar.className = 'top-pick-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = profileInitial(pick);

        const copy = document.createElement('span');
        copy.className = 'top-pick-copy';
        const name = document.createElement('strong');
        name.textContent = [pick.display_name, pick.age_years]
          .filter((value) => value != null)
          .join(', ');
        const location = document.createElement('small');
        location.textContent = profileLocation(pick) || '';
        copy.append(name, location);
        button.append(avatar, copy);
        button.addEventListener('click', () => {
          showProfileAt(index);
          profileStage.querySelector('h3')?.focus();
        });
        return button;
      }),
    );
  }
  for (const button of list.children) {
    if (button.dataset.member === profile?.user_id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

function syncProfileNavigation() {
  const loading = Boolean(feeds.profiles.request);
  const previous = profileStage.querySelector('.profile-arrow-previous');
  const next = profileStage.querySelector('.profile-arrow-next');
  if (!previous || !next) return;
  const disablePrevious = loading || profileIndex <= 0;
  const disableNext = loading || (profileIndex >= profileRows.length - 1 && !nextCompatibilityPage);
  previous.setAttribute('aria-disabled', String(disablePrevious));
  previous.tabIndex = disablePrevious ? -1 : 0;
  next.setAttribute('aria-disabled', String(disableNext));
  next.tabIndex = disableNext ? -1 : 0;
  const count = profileStage.querySelector('.profile-position');
  count.textContent = nextCompatibilityPage
    ? 'Profile ' + (profileIndex + 1)
    : profileIndex + 1 + ' of ' + profileRows.length;
}

function showProfileAt(index = profileIndex) {
  const focusedStep = document.activeElement?.dataset.step;
  profileIndex = Math.max(0, Math.min(index, profileRows.length - 1));
  const profile = profileRows[profileIndex];
  profileStage.replaceChildren(...(profile ? [renderProfile(profile, activeProfileList)] : []));
  renderProfileDetails(profile, activeProfileList);
  syncProfileNavigation();
  syncTopPicks(profile);
  if (focusedStep) {
    profileStage.querySelector('[data-step="' + focusedStep + '"]')?.focus({ preventScroll: true });
  }
  profileAnnouncement.textContent = profile
    ? 'Showing ' + profile.display_name + ', profile ' + (profileIndex + 1) + '.'
    : '';
}

function moveProfile(direction) {
  if (feeds.profiles.request || confirmation.open) return;
  const target = profileIndex + direction;
  if (target < 0) return;
  if (target < profileRows.length) {
    showProfileAt(target);
    return;
  }
  if (nextCompatibilityPage) void loadProfiles({ append: true, selectIndex: target });
}

async function loadProfiles({ append = false, selectIndex = 0, selectId = null } = {}) {
  if (connectionState?.browsing === 'paused') return;
  const feed = feeds.profiles;
  feed.request?.abort();
  const request = new AbortController();
  feed.request = request;
  const listName = activeProfileList;
  const profileView = profileLists[listName];
  const isCompatibility = listName === 'compatibility';
  const isSearch = isCompatibility && Boolean(profileSearchQuery);
  const url = feed.url + (isSearch ? '/search' : profileView.path);
  const status = document.querySelector('#profiles-status');
  const retry = document.querySelector('[data-retry="profiles"]');

  profileSearch.hidden = !isCompatibility;
  document.querySelector('#profiles-heading').textContent = isSearch
    ? 'Search results'
    : profileView.heading;
  profilePageStatus.textContent = append ? 'Loading more profiles.' : '';
  reloadProfiles.hidden = true;
  retry.hidden = true;
  if (!append) {
    profilesLoaded = false;
    profileRows = [];
    nextCompatibilityPage = null;
    searchStatus.hidden = true;
    status.hidden = false;
    status.textContent = isSearch ? 'Searching public profiles…' : 'Loading profiles.';
    showProfileAt(0);
  } else {
    status.hidden = true;
    syncProfileNavigation();
  }

  try {
    const endpoint = append ? url + '?' + new URLSearchParams(nextCompatibilityPage) : url;
    const options = { signal: request.signal };
    if (isSearch) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ query: profileSearchQuery });
    }
    const response = await fetch(endpoint, options);
    if (request.signal.aborted) return;
    if (response.status === 410) {
      status.hidden = true;
      nextCompatibilityPage = null;
      profilePageStatus.textContent = 'This browse list expired. Reload to continue.';
      reloadProfiles.hidden = false;
      return;
    }
    if ([400, 401, 403].includes(response.status)) {
      const message =
        response.status === 401 ? 'Sign in to view profiles.' : (await response.json()).error;
      if (request.signal.aborted) return;
      profilesLoaded = false;
      profileRows = [];
      nextCompatibilityPage = null;
      showProfileAt(0);
      status.hidden = false;
      status.textContent = message;
      profilePageStatus.textContent = '';
      if (response.status === 403 && !changingConnection && !connectionRead) {
        void loadConnections({ quiet: true });
      }
      return;
    }
    if (!response.ok) throw new Error('Profile request failed');
    const result = await response.json();
    if (request.signal.aborted) return;
    profileRows.push(...(isCompatibility ? result.profiles : result));
    nextCompatibilityPage = isCompatibility && !isSearch ? result.next : null;
    // Re-enable the controls before restoring focus to the arrow on the next card.
    feed.request = null;
    profilesLoaded = true;
    const retained = profileRows.findIndex((profile) => profile.user_id === selectId);
    showProfileAt(retained < 0 ? selectIndex : retained);
    status.hidden = Boolean(profileRows.length);
    status.textContent = isSearch
      ? 'No profiles match this interest or description.'
      : profileView.empty;
    if (isSearch && result.mode === 'keywords') {
      searchStatus.hidden = false;
      searchStatus.textContent =
        'Semantic search is temporarily unavailable. Showing keyword results.';
    }
    profilePageStatus.textContent =
      append && selectIndex >= profileRows.length && profileRows.length
        ? 'You reached the end of this list.'
        : '';
  } catch {
    if (request.signal.aborted) return;
    if (append) {
      profilePageStatus.textContent = 'Could not load more profiles.';
    } else {
      status.textContent = isSearch ? 'Could not complete the search.' : 'Could not load profiles.';
    }
    retry.hidden = false;
  } finally {
    if (feed.request === request) {
      feed.request = null;
      syncProfileNavigation();
    }
  }
}

async function loadStories() {
  const feed = feeds.stories;
  feed.request?.abort();
  const request = new AbortController();
  feed.request = request;
  const status = document.querySelector('#stories-status');
  const retry = document.querySelector('[data-retry="stories"]');
  status.hidden = false;
  status.textContent = 'Loading stories.';
  retry.hidden = true;
  document.querySelector('#stories').replaceChildren();
  document.querySelector('#story-filter').hidden = true;

  try {
    const response = await fetch(feed.url, { signal: request.signal });
    if (response.status === 401) {
      status.textContent = 'Sign in to view this section.';
      return;
    }
    if (!response.ok) throw new Error('Story request failed');
    const rows = await response.json();
    if (!request.signal.aborted) setStories(rows);
  } catch {
    if (request.signal.aborted) return;
    status.textContent = 'Could not load this section.';
    retry.hidden = false;
  } finally {
    if (feed.request === request) feed.request = null;
  }
}

function activateTab(tab, refresh = true) {
  profileListsNav.hidden = tab !== tabs[0] || connectionState?.browsing === 'paused';
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
    if (tab === tabs[1]) void loadStories();
    else if (!profilesLoaded && !feeds.profiles.request) void loadProfiles();
  }
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    const vertical = tabList.getAttribute('aria-orientation') === 'vertical';
    const nextIndex = {
      [vertical ? 'ArrowUp' : 'ArrowLeft']: (index - 1 + tabs.length) % tabs.length,
      [vertical ? 'ArrowDown' : 'ArrowRight']: (index + 1) % tabs.length,
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
  button.addEventListener('click', () => {
    if (button.dataset.retry === 'stories') {
      void loadStories();
    } else if (nextCompatibilityPage) {
      void loadProfiles({ append: true, selectIndex: profileRows.length });
    } else {
      void loadProfiles();
    }
  });
}

const compactNavigation = window.matchMedia('(max-width: 52rem)');
function updateTabOrientation() {
  tabList.setAttribute('aria-orientation', compactNavigation.matches ? 'horizontal' : 'vertical');
}
updateTabOrientation();
compactNavigation.addEventListener('change', updateTabOrientation);

for (const button of profileListsNav.querySelectorAll('[data-list]')) {
  button.addEventListener('click', () => {
    const listName = button.dataset.list;
    if (listName === activeProfileList && !profileSearchQuery && profilesLoaded) return;
    activeProfileList = listName;
    for (const item of profileListsNav.querySelectorAll('[data-list]')) {
      item.setAttribute('aria-pressed', String(item === button));
    }
    profileQuery.value = '';
    profileSearchQuery = '';
    clearProfileQuery.hidden = true;
    profileFeedback.hidden = !lastHiddenProfile;
    void loadProfiles();
  });
}

profileQuery.addEventListener('input', () => {
  clearProfileQuery.hidden = !profileQuery.value && !profileSearchQuery;
});

function applyProfileSearch() {
  profileSearchQuery = profileQuery.value.trim();
  clearProfileQuery.hidden = !profileSearchQuery;
  profileFeedback.hidden = !lastHiddenProfile;
  void loadProfiles();
}

profileSearch.addEventListener('submit', (event) => {
  event.preventDefault();
  applyProfileSearch();
});
clearProfileQuery.addEventListener('click', () => {
  profileQuery.value = '';
  profileQuery.focus();
  applyProfileSearch();
});
reloadProfiles.addEventListener('click', () => {
  profileQuery.focus();
  void loadProfiles({ selectId: profileRows[profileIndex]?.user_id });
});
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
