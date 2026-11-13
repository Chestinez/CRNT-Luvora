const statusLine = document.querySelector('#status');
const workspace = document.querySelector('#workspace');
const composer = document.querySelector('#composer');
const heading = document.querySelector('#composer-heading');
const cancelEdit = document.querySelector('#cancel-edit');
const postList = document.querySelector('#post-list');
const empty = document.querySelector('#empty');
const relationshipField = document.querySelector('#relationship-field');
const relationshipSelect = composer.elements.relationshipId;

let editing = null;
let busy = false;

async function request(path, { method = 'GET', body } = {}) {
  const options = { method };
  if (method !== 'GET') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body ?? {});
  }
  const response = await fetch(`/api/posts${path}`, options);
  if (response.status === 204) return;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function resetComposer() {
  editing = null;
  composer.reset();
  heading.textContent = 'New draft';
  cancelEdit.hidden = true;
  relationshipField.hidden = false;
  relationshipSelect.disabled = false;
  composer.hidden = !relationshipSelect.options.length;
}

function showSignedOut() {
  workspace.hidden = true;
  postList.replaceChildren();
  document.querySelector('#review-list').replaceChildren();
  resetComposer();
  statusLine.textContent = 'Sign in to manage your couple stories.';
}

async function run(action) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('main button')];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    await action();
  } catch (error) {
    if (error.status === 401) {
      showSignedOut();
    } else {
      statusLine.textContent = error.message;
    }
  } finally {
    busy = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function makeButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function renderPost(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  const title = document.createElement('h3');
  title.textContent = post.title ?? 'Untitled';
  const caption = document.createElement('p');
  caption.textContent = post.caption;
  const state = document.createElement('p');
  state.className = 'post-state';
  state.textContent = post.status === 'published' ? 'Published' : 'Draft';
  const actions = document.createElement('div');
  actions.className = 'post-actions';
  const route = `/${post.id}`;
  const body = { revision: post.content_revision };

  actions.append(
    makeButton('Edit', () => {
      if (busy) return;
      editing = post;
      composer.hidden = false;
      relationshipField.hidden = true;
      relationshipSelect.disabled = true;
      heading.textContent = 'Edit post';
      composer.elements.title.value = post.title ?? '';
      composer.elements.caption.value = post.caption;
      cancelEdit.hidden = false;
      composer.elements.title.focus();
    }),
  );

  if (post.status === 'draft') {
    actions.append(
      makeButton('Publish', () =>
        run(async () => {
          await request(`${route}/publish`, { method: 'POST', body });
          if (editing?.id === post.id) resetComposer();
          await loadPosts('Post published.');
        }),
      ),
    );
  }

  actions.append(
    makeButton('Delete', () => {
      if (busy || !window.confirm('Permanently delete this post?')) return;
      run(async () => {
        await request(route, { method: 'DELETE', body });
        if (editing?.id === post.id) resetComposer();
        await loadPosts('Post deleted.');
      });
    }),
  );
  card.append(title, caption, state, actions);
  return card;
}

function renderReview(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  const title = document.createElement('h3');
  title.textContent = post.title;
  const caption = document.createElement('p');
  caption.textContent = post.caption;
  const approve = makeButton('Approve this version', () =>
    run(async () => {
      await request(`/${post.id}/approve`, {
        method: 'POST',
        body: { revision: post.content_revision },
      });
      await loadPosts('Story approved.');
    }),
  );
  card.append(title, caption, approve);
  return card;
}

async function loadPosts(message) {
  // Report a completed write even if the subsequent refresh fails.
  if (message) statusLine.textContent = message;
  try {
    const [posts, review] = await Promise.all([request('/'), request('/review')]);
    document.querySelector('#review-list').replaceChildren(...review.map(renderReview));
    document.querySelector('#review-empty').hidden = review.length > 0;
    postList.replaceChildren(...posts.map(renderPost));
    empty.hidden = posts.length > 0;
    if (!message) statusLine.textContent = 'Posts loaded.';
  } catch (error) {
    if (error.status === 401 || !message) throw error;
    statusLine.textContent = `${message} Could not refresh the list. Use Reload posts.`;
  }
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    const fields = new FormData(composer);
    const body = { title: fields.get('title'), caption: fields.get('caption') };
    const current = editing;
    if (current) {
      const post = await request(`/${current.id}`, {
        method: 'PATCH',
        body: { ...body, revision: current.content_revision },
      });
      resetComposer();
      await loadPosts(post.status === 'draft' ? 'Draft saved.' : 'Post saved.');
    } else {
      await request('/', {
        method: 'POST',
        body: { ...body, relationshipId: fields.get('relationshipId') },
      });
      resetComposer();
      await loadPosts('Draft saved.');
    }
  });
});

cancelEdit.addEventListener('click', resetComposer);
document.querySelector('#reload').addEventListener('click', () => run(() => loadPosts()));

run(async () => {
  const relationships = await request('/relationships');
  relationshipSelect.replaceChildren(
    ...relationships.map(({ id, partner_name }) => new Option(partner_name, id)),
  );
  resetComposer();
  workspace.hidden = false;
  await loadPosts();
  if (!relationships.length) {
    statusLine.textContent = 'You need an active relationship to start a couple story.';
  }
});
