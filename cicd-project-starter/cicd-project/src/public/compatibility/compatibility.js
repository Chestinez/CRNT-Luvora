'use strict';
(() => {
  const el = (id) => document.getElementById(id);
  const editing = new URLSearchParams(window.location.search).get('edit') === '1';
  let questions = [];
  let categories = {};
  let assessment;
  let index = 0;
  let busy = false;
  let dirty = false;
  let conflicted = false;
  let timer;

  async function request(path, method = 'GET', body) {
    const response = await fetch(`/api/compatibility${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'The request failed.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function setBusy(value) {
    busy = value;
    el('choices').disabled = value || conflicted;
    el('preferences').disabled = value || conflicted;
    el('back').disabled = value || conflicted || index === 0;
    el('next').disabled = value || conflicted;
  }
  function option(container, option, name, checked, multiple) {
    const label = document.createElement('label');
    label.className = 'option';
    const input = document.createElement('input');
    input.type = multiple ? 'checkbox' : 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = option.label;
    label.append(input, text);
    container.append(label);
  }
  function progress() {
    el('progress').max = questions.length;
    el('progress').value = questions.filter((q) => assessment.answers[q.id]?.length).length;
  }
  function render(focus = false) {
    const q = questions[index];
    const preference = assessment.partner_preferences[q.id];
    el('quiz').hidden = false;
    el('category').textContent = categories[q.category].label;
    el('position').textContent = `Question ${index + 1} of ${questions.length}`;
    el('question').textContent = q.text;
    el('instruction').textContent =
      q.maxSelections === 1 ? 'Choose one answer.' : `Choose up to ${q.maxSelections} answers.`;
    el('options').replaceChildren();
    el('partner-options').replaceChildren();
    for (const item of q.options) {
      option(
        el('options'),
        item,
        'answer',
        (assessment.answers[q.id] || []).includes(item.value),
        q.maxSelections > 1,
      );
      option(
        el('partner-options'),
        item,
        'partner',
        (preference?.accepted || []).includes(item.value),
        true,
      );
    }
    el('use-preference').checked = Boolean(preference);
    el('preference-fields').hidden = !preference;
    el('importance').value = String(preference?.importance ?? 1);
    el('dealbreaker').checked = preference?.dealbreaker ?? false;
    el('next').textContent = index === questions.length - 1 ? 'Finish and save' : 'Continue';
    el('save-status').textContent = 'Answers save automatically.';
    progress();
    setBusy(false);
    if (focus) el('question').focus();
  }
  function readForm() {
    const q = questions[index];
    const selected = [...el('options').querySelectorAll('input:checked')].map(
      (input) => input.value,
    );
    if (selected.length > q.maxSelections)
      throw new Error(`Choose no more than ${q.maxSelections} answers.`);
    const answers = { ...assessment.answers };
    const preferences = { ...assessment.partner_preferences };
    if (selected.length) answers[q.id] = selected;
    else delete answers[q.id];
    if (el('use-preference').checked) {
      const accepted = [...el('partner-options').querySelectorAll('input:checked')].map(
        (input) => input.value,
      );
      if (!accepted.length)
        throw new Error(
          'Choose at least one acceptable partner answer, or turn off this preference.',
        );
      const importance = Number(el('importance').value);
      const dealbreaker = el('dealbreaker').checked;
      if (dealbreaker && importance === 0)
        throw new Error('A dealbreaker needs at least some importance.');
      preferences[q.id] = { accepted, importance, dealbreaker };
    } else delete preferences[q.id];
    return { answers, preferences, selected };
  }
  async function save(direction = 0) {
    clearTimeout(timer);
    if (busy || conflicted) return;
    el('notice').textContent = '';
    el('retry').hidden = true;
    try {
      const form = readForm();
      if (direction > 0 && !form.selected.length)
        throw new Error('Choose an answer before continuing.');
      const complete = direction > 0 && index === questions.length - 1;
      setBusy(true);
      el('save-status').textContent = 'Saving…';
      const result = await request('/assessment', 'PUT', {
        revision: assessment.revision,
        action: complete ? 'complete' : 'draft',
        answers: form.answers,
        partnerPreferences: form.preferences,
        skippedQuestionIds: [],
      });
      assessment = result.assessment;
      dirty = false;
      progress();
      el('save-status').textContent = 'Saved.';
      if (complete) {
        setBusy(false);
        window.location.assign('./enhance.html');
      } else if (direction) {
        index += direction;
        render(true);
      }
    } catch (error) {
      el('notice').textContent = error.message;
      el('save-status').textContent = 'Not saved. Your selection is still on this page.';
      conflicted = error.status === 409;
      el('retry').hidden = !error.status && !conflicted;
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    clearTimeout(timer);
    conflicted = false;
    dirty = false;
    el('loading').hidden = false;
    el('quiz').hidden = true;
    el('notice').textContent = '';
    el('retry').hidden = true;
    try {
      const [bank, saved] = await Promise.all([request('/questions'), request('/assessment')]);
      questions = bank.questions;
      categories = bank.categories;
      assessment = saved.assessment;
      if (!assessment) {
        try {
          assessment = (await request('/assessment', 'POST')).assessment;
        } catch (error) {
          if (error.status !== 409) throw error;
          assessment = (await request('/assessment')).assessment;
        }
      }
      if (!assessment || assessment.questionnaire_version !== bank.version)
        throw new Error('Could not load a supported assessment.');
      if (assessment.core_completed_at && !editing) {
        window.location.replace('./enhance.html');
        return;
      }
      const next = questions.findIndex((q) => !assessment.answers[q.id]?.length);
      index = editing || next < 0 ? 0 : next;
      render();
    } catch (error) {
      el('notice').textContent = error.message;
      el('retry').hidden = false;
    } finally {
      el('loading').hidden = true;
    }
  }
  el('answer-form').addEventListener('change', () => {
    dirty = true;
    el('preference-fields').hidden = !el('use-preference').checked;
    el('save-status').textContent = 'Unsaved changes…';
    clearTimeout(timer);
    timer = setTimeout(() => save(), 600);
  });
  el('answer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    save(1);
  });
  el('back').addEventListener('click', () => {
    if (index > 0) save(-1);
  });
  el('retry').addEventListener('click', () => {
    if (!dirty || window.confirm('Reload saved answers? Unsaved selections will be lost.')) load();
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty || busy) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  load();
})();
