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
const searchBlocked = document.querySelector('#search-blocked');
const editProfileSearch = document.querySelector('#edit-profile-search');
const reloadProfiles = document.querySelector('#reload-profiles');
const profileSearch = document.querySelector('#profile-search');
const profileQuery = document.querySelector('#profile-query');
const clearProfileQuery = document.querySelector('#clear-profile-query');
const profileStage = document.querySelector('#profiles');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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
const deckWheel = { last: 0, total: 0, used: false, scrolledDetails: false };

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
  button.querySelector('.action-icon').textContent = liked ? '♥' : '♡';
  button.querySelector('.action-label').textContent = liked ? 'Liked' : 'Like';
  button.setAttribute('aria-label', `Like ${profile.display_name}`);
  button.setAttribute('aria-pressed', String(liked));
  button.dataset.saved = String(liked);
  button.disabled = changingProfileAction;
}

function renderProfile(profile, listName) {
  const card = document.querySelector('#profile-card').content.cloneNode(true);
  const media = card.querySelector('.profile-media');
  media.classList.add(profileTone(profile));
  card.querySelector('.profile-monogram').textContent = profileInitial(profile);
  const name = [profile.display_name, profile.age_years]
    .filter((value) => value != null)
    .join(', ');
  for (const heading of card.querySelectorAll('h2')) heading.textContent = name;
  for (const location of card.querySelectorAll('.profile-location')) {
    location.textContent = profileLocation(profile) || '';
    location.hidden = !location.textContent;
  }
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
  const hideLabel = listName === 'hidden' ? 'Restore' : 'Hide';
  hideButton.querySelector('.action-label').textContent = hideLabel;
  hideButton.querySelector('.action-icon').textContent = listName === 'hidden' ? '↶' : '×';
  hideButton.setAttribute('aria-label', hideLabel + ' ' + profile.display_name);
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

  setupProfileDeck(card.querySelector('.focused-profile'), setupProfileGallery(card, profile));
  renderProfileDetails(card, profile, listName);
  return card;
}

function profilePhotos(profile) {
  // The gallery takes displayable URLs when the profile API supplies them.
  const attached = Array.isArray(profile.photos) ? profile.photos : [];
  const ordered = [
    profile.primary_photo_url || profile.photo_url,
    ...attached.filter((photo) => photo?.is_primary),
    ...attached,
  ];
  const urls = new Set();
  for (const photo of ordered) {
    const source = typeof photo === 'string' ? photo : photo?.url;
    if (typeof source !== 'string' || !source.trim()) continue;
    try {
      const url = new URL(source, document.baseURI);
      if (
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && url.origin === location.origin)) &&
        !url.username &&
        !url.password
      ) {
        urls.add(url.href);
      }
    } catch {
      // Leave malformed photo entries out of the gallery.
    }
  }
  return [...urls];
}

function setupProfileGallery(card, profile) {
  const urls = profilePhotos(profile);
  const image = card.querySelector('.profile-photo');
  const progress = card.querySelector('.photo-progress');
  const announcement = card.querySelector('.photo-announcement');
  const loading = card.querySelector('.photo-loading');
  const previous = card.querySelector('.photo-arrow-previous');
  const next = card.querySelector('.photo-arrow-next');
  let index = 0;

  const segments = urls.map(() => document.createElement('i'));
  progress.replaceChildren(...segments);
  progress.hidden = urls.length < 2;
  previous.hidden = urls.length < 2;
  next.hidden = urls.length < 2;
  function showPhoto() {
    image.hidden = true;
    if (!urls.length) {
      announcement.textContent = 'No profile photos available.';
      return;
    }
    loading.hidden = false;
    loading.dataset.loading = 'true';
    const count = 'Photo ' + (index + 1) + ' of ' + urls.length;
    image.alt = count + ' of ' + profile.display_name;
    announcement.textContent = count;
    segments.forEach((segment, position) => {
      segment.classList.toggle('is-current', position === index);
    });
    previous.setAttribute('aria-disabled', String(index === 0));
    next.setAttribute('aria-disabled', String(index === urls.length - 1));
    image.src = urls[index];
    if (image.complete && image.naturalWidth > 0) finishPhoto();
  }
  function finishPhoto() {
    if (loading.hidden) return;
    loading.hidden = true;
    delete loading.dataset.loading;
    image.hidden = image.naturalWidth === 0;
    if (image.hidden) announcement.textContent += ' could not be loaded.';
  }
  function movePhoto(direction) {
    const target = index + direction;
    if (target < 0 || target >= urls.length) return;
    index = target;
    showPhoto();
  }
  image.addEventListener('load', finishPhoto);
  image.addEventListener('error', finishPhoto);
  previous.addEventListener('click', () => movePhoto(-1));
  next.addEventListener('click', () => movePhoto(1));
  const media = card.querySelector('.profile-media');
  media.addEventListener('keydown', (event) => {
    if (urls.length < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    movePhoto(event.key === 'ArrowRight' ? 1 : -1);
  });
  showPhoto();
  return movePhoto;
}

function setupProfileDeck(card, movePhoto) {
  const media = card.querySelector('.profile-media');
  const details = card.querySelector('.profile-details');
  const scroller = details.querySelector('.details-scroll');
  let showingDetails = false;
  let touchStart;

  function changeView(view, focusHeading = false) {
    const incoming = view === 'details' ? details : media;
    const outgoing = view === 'details' ? media : details;
    const restoreFocus = focusHeading || outgoing.contains(document.activeElement);
    showingDetails = view === 'details';
    card.dataset.view = view;
    outgoing.inert = true;
    incoming.inert = false;
    if (restoreFocus) incoming.querySelector('h2').focus({ preventScroll: true });
  }

  function atDetailEdge(direction) {
    return direction < 0
      ? scroller.scrollTop <= 1
      : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
  }

  function boundaryButton(direction) {
    return card.querySelector('[data-step="' + direction + '"]');
  }

  function changeDeck(direction) {
    if (showingDetails && !atDetailEdge(direction)) return false;
    if (showingDetails !== direction > 0) {
      changeView(direction > 0 ? 'details' : 'media');
      return true;
    }
    if (boundaryButton(direction).hidden) return false;
    moveProfile(direction);
    return true;
  }

  for (const button of card.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => changeView(button.dataset.view, true));
  }
  for (const direction of [-1, 1]) {
    boundaryButton(direction).addEventListener('click', () => moveProfile(direction));
  }

  card.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || confirmation.open || Math.abs(event.deltaY) <= Math.abs(event.deltaX))
        return;
      const now = performance.now();
      if (now - deckWheel.last > 170) {
        deckWheel.total = 0;
        deckWheel.used = false;
        deckWheel.scrolledDetails = false;
      }
      deckWheel.last = now;
      if (deckWheel.used) {
        event.preventDefault();
        return;
      }
      const direction = Math.sign(event.deltaY);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      if (showingDetails && !atDetailEdge(direction)) {
        deckWheel.scrolledDetails = true;
        if (!scroller.contains(event.target)) {
          event.preventDefault();
          scroller.scrollTop += delta;
        }
        return;
      }
      if (deckWheel.scrolledDetails) {
        event.preventDefault();
        return;
      }
      if (showingDetails === direction > 0 && boundaryButton(direction).hidden) return;
      deckWheel.total = Math.sign(deckWheel.total) === direction ? deckWheel.total + delta : delta;
      event.preventDefault();
      if (Math.abs(deckWheel.total) >= 36) deckWheel.used = changeDeck(direction);
    },
    { passive: false },
  );

  card.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1 || event.target.closest('button, a')) return;
      const point = event.touches[0];
      touchStart = { x: point.clientX, y: point.clientY, scroll: scroller.scrollTop };
    },
    { passive: true },
  );
  card.addEventListener('touchcancel', () => {
    touchStart = null;
  });
  card.addEventListener(
    'touchend',
    (event) => {
      const start = touchStart;
      touchStart = null;
      if (!start || event.touches.length || confirmation.open) return;
      const point = event.changedTouches[0];
      const dx = point.clientX - start.x;
      const dy = point.clientY - start.y;
      if (Math.abs(dy) >= 52 && Math.abs(dy) > 1.25 * Math.abs(dx)) {
        if (Math.abs(scroller.scrollTop - start.scroll) < 2) changeDeck(dy < 0 ? 1 : -1);
      } else if (!showingDetails && Math.abs(dx) >= 52 && Math.abs(dx) > 1.25 * Math.abs(dy)) {
        movePhoto(dx < 0 ? 1 : -1);
      }
    },
    { passive: true },
  );
}

function renderProfileDetails(card, profile, listName) {
  const details = card.querySelector('.profile-details');
  const facts = details.querySelector('.profile-basics .profile-facts');
  addFact(
    facts,
    'Looking for',
    profile.relationship_goal && readableLabel(profile.relationship_goal),
  );
  addFact(facts, 'Gender', profile.gender && readableLabel(profile.gender));
  addFact(facts, 'Pronouns', profile.pronouns);
  addFact(facts, 'MBTI', profile.mbti_type);
  addFact(facts, 'Zodiac', profile.zodiac_sign);
  details.querySelector('.profile-basics').hidden = !facts.childElementCount;

  const fit = details.querySelector('#profile-fit');
  if (listName === 'hidden') return;
  fit.hidden = false;
  const summary = fit.querySelector('#profile-match');
  const directions = fit.querySelector('#profile-fit-directions');
  const common = fit.querySelector('#profile-common');
  setLoading(summary, 'Loading compatibility.');
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
    summary.textContent = Number.isInteger(profile.alignment)
      ? profile.alignment + '% mutual alignment'
      : 'Compatibility details unavailable.';
    if (Number.isInteger(profile.shared_count) && profile.shared_count > 0) {
      common.textContent =
        profile.shared_count +
        (profile.shared_count === 1 ? ' shared interest' : ' shared interests');
      common.hidden = false;
    }
  } finally {
    delete summary.dataset.loading;
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
  const label = pending
    ? pending.direction === 'sent'
      ? 'Request sent'
      : 'View invite'
    : 'Connect';
  button.querySelector('.action-label').textContent = label;
  button.dataset.pending = String(Boolean(pending));
  button.disabled = changingConnection;
  button.setAttribute('aria-label', label + ' ' + button.dataset.name);
}

function showBrowsingPause() {
  const paused = connectionState?.browsing === 'paused';
  document.querySelector('#profile-browser').hidden = paused;
  document.querySelector('#profiles-paused').hidden = !paused;
  syncBrowseSidebar();
  if (!paused) return;
  feeds.profiles.request?.abort();
  feeds.profiles.request = null;
  profilesLoaded = false;
  profileRows = [];
  nextCompatibilityPage = null;
  reloadProfiles.hidden = true;
  showProfileAt(0);
  profilePageStatus.textContent = '';
  delete profilePageStatus.dataset.loading;
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
  if (!quiet) setLoading(connectionsStatus, 'Loading connections.');
  try {
    const response = await fetch(connectionUrl, { signal: request.signal });
    if (response.status === 401) {
      if (!quiet || connectionsStatus.dataset.loading === 'true')
        connectionsStatus.textContent = 'Sign in to view your connections.';
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
    if ((!quiet || connectionsStatus.dataset.loading === 'true') && !request.signal.aborted)
      connectionsStatus.textContent = 'Could not load connections. Use Refresh to try again.';
    return false;
  } finally {
    if (connectionRead === request) {
      connectionRead = null;
      delete connectionsStatus.dataset.loading;
    }
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
  delete profileActionStatus.dataset.loading;
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
  profileFeedback.hidden = false;
  undoButton.hidden = true;
  setLoading(profileActionStatus, 'Updating profile.');

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
        profileStage.querySelector('h2') ||
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
          if (index !== profileIndex) showProfileAt(index, { slide: true });
          profileStage.querySelector('h2')?.focus({ preventScroll: true });
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

function setLoading(status, message) {
  status.dataset.loading = 'true';
  status.textContent = message;
}

function syncBrowseSidebar() {
  const profilesActive = tabs[0].getAttribute('aria-selected') === 'true';
  const browsing = connectionState?.browsing;
  const available = profilesActive && browsing !== 'paused' && browsing !== 'unavailable';
  profileListsNav.hidden = !available;
  profileSearch.hidden = !available || activeProfileList !== 'compatibility';
  topPicks.hidden = !available || !topPicks.querySelector('.top-pick');
}

function syncProfileNavigation() {
  const loading = Boolean(feeds.profiles.request);
  const previous = profileStage.querySelector('[data-step="-1"]');
  const next = profileStage.querySelector('[data-step="1"]');
  if (!previous || !next) return;
  previous.hidden = profileIndex <= 0;
  next.hidden = profileIndex >= profileRows.length - 1 && !nextCompatibilityPage;
  previous.disabled = loading;
  next.disabled = loading;
}

function slideProfiles(outgoing, incoming, direction) {
  outgoing.inert = true;
  outgoing.classList.add('profile-leaving');
  // The departing card stays visible while the incoming card owns its live labels.
  for (const element of outgoing.querySelectorAll('[id]')) element.removeAttribute('id');
  profileStage.append(outgoing);
  const options = { duration: 460, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' };
  incoming.animate(
    [{ transform: `translateY(${direction * 100}%)` }, { transform: 'translateY(0)' }],
    options,
  );
  const leaving = outgoing.animate(
    [{ transform: 'translateY(0)' }, { transform: `translateY(${-direction * 100}%)` }],
    options,
  );
  const remove = () => outgoing.remove();
  void leaving.finished.then(remove, remove);
}

function showProfileAt(index = profileIndex, { slide = false } = {}) {
  const restoreFocus = profileStage.contains(document.activeElement);
  const outgoing = profileStage.firstElementChild;
  const previousIndex = profileIndex;
  compatibilityRead?.abort();
  compatibilityRead = null;
  profileIndex = Math.max(0, Math.min(index, profileRows.length - 1));
  const profile = profileRows[profileIndex];
  profileStage.replaceChildren(...(profile ? [renderProfile(profile, activeProfileList)] : []));
  const incoming = profileStage.firstElementChild;
  const direction = Math.sign(profileIndex - previousIndex);
  if (slide && direction && outgoing && incoming && !reducedMotion.matches) {
    slideProfiles(outgoing, incoming, direction);
  }
  syncProfileNavigation();
  syncTopPicks(profile);
  syncBrowseSidebar();
  if (restoreFocus) {
    const target =
      profileStage.querySelector('h2') || profileListsNav.querySelector('[aria-pressed="true"]');
    target?.focus({ preventScroll: true });
  }
  profileAnnouncement.textContent = profile
    ? 'Showing ' + profile.display_name + ', profile ' + (profileIndex + 1) + '.'
    : '';
}

function moveProfile(direction) {
  if (feeds.profiles.request || confirmation.open || profileStage.querySelector('.profile-leaving'))
    return;
  const target = profileIndex + direction;
  if (target < 0) return;
  if (target < profileRows.length) {
    showProfileAt(target, { slide: true });
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

  document.querySelector('#profiles-heading').textContent = isSearch
    ? 'Search results'
    : profileView.heading;
  profilePageStatus.textContent = '';
  delete profilePageStatus.dataset.loading;
  if (append) setLoading(profilePageStatus, 'Loading more profiles.');
  reloadProfiles.hidden = true;
  retry.hidden = true;
  if (!append) {
    profilesLoaded = false;
    profileRows = [];
    nextCompatibilityPage = null;
    searchStatus.hidden = true;
    searchBlocked.hidden = true;
    profileQuery.removeAttribute('aria-invalid');
    profileQuery.removeAttribute('aria-describedby');
    status.hidden = false;
    setLoading(status, isSearch ? 'Searching public profiles.' : 'Loading profiles.');
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
      const error = response.status === 401 ? null : await response.json();
      if (request.signal.aborted) return;
      if (isSearch && response.status === 400 && error?.code === 'blocked_search_term') {
        profilesLoaded = true;
        status.hidden = true;
        searchBlocked.hidden = false;
        profileQuery.setAttribute('aria-invalid', 'true');
        profileQuery.setAttribute('aria-describedby', 'search-blocked-help');
        if (profileSearch.contains(document.activeElement)) {
          editProfileSearch.focus({ preventScroll: true });
        }
        return;
      }
      profilesLoaded = false;
      profileRows = [];
      nextCompatibilityPage = null;
      showProfileAt(0);
      status.hidden = false;
      status.textContent =
        response.status === 401
          ? 'Sign in to view profiles.'
          : error?.error || 'Could not load profiles.';
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
    // Re-enable profile navigation before showing the new card.
    feed.request = null;
    delete profilePageStatus.dataset.loading;
    delete status.dataset.loading;
    profilesLoaded = true;
    const retained = profileRows.findIndex((profile) => profile.user_id === selectId);
    showProfileAt(retained < 0 ? selectIndex : retained, { slide: append });
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
      delete profilePageStatus.dataset.loading;
      delete status.dataset.loading;
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
  setLoading(status, 'Loading stories.');
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
    if (feed.request === request) {
      feed.request = null;
      delete status.dataset.loading;
    }
  }
}

function activateTab(tab, refresh = true) {
  for (const current of tabs) {
    const active = current === tab;
    current.setAttribute('aria-selected', String(active));
    current.tabIndex = active ? 0 : -1;
    document.getElementById(current.getAttribute('aria-controls')).hidden = !active;
  }
  syncBrowseSidebar();
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
editProfileSearch.addEventListener('click', () => {
  profileQuery.focus();
  profileQuery.select();
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
