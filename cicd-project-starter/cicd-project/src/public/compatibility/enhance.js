'use strict';
(() => {
  const el = (id) => document.getElementById(id);
  let assessment;
  let busy = false;
  async function load() {
    el('content').hidden = true;
    el('retry').hidden = true;
    el('notice').textContent = '';
    el('status').textContent = 'Loading your progress…';
    try {
      const response = await fetch('/api/compatibility/assessment');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load progress.');
      assessment = data.assessment;
      const complete = Boolean(assessment?.core_completed_at);
      el('status').textContent = complete
        ? 'Your core preferences are saved.'
        : 'Complete your core preferences to receive compatibility recommendations.';
      el('core').href = complete ? './?edit=1' : './';
      el('core').querySelector('strong').textContent = complete
        ? 'Edit my answers and partner preferences →'
        : 'Complete my core preferences →';
      el('delete').hidden = !assessment;
      el('content').hidden = false;
    } catch (error) {
      el('status').textContent = '';
      el('notice').textContent = error.message;
      el('retry').hidden = false;
    }
  }
  el('retry').addEventListener('click', load);
  el('delete').addEventListener('click', async () => {
    if (
      busy ||
      !assessment ||
      !window.confirm(
        'Delete all compatibility answers and partner preferences? This cannot be undone.',
      )
    )
      return;
    busy = true;
    el('delete').disabled = true;
    try {
      const response = await fetch('/api/compatibility/assessment', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: assessment.revision }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || 'Could not delete answers.');
      await load();
    } catch (error) {
      el('notice').textContent = error.message;
      el('retry').hidden = false;
    } finally {
      busy = false;
      el('delete').disabled = false;
    }
  });
  load();
})();
