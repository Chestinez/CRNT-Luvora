'use strict';

(() => {
  const api = '/api/compatibility';
  const element = (id) => document.getElementById(id);

  let questions = [];
  let categories = {};
  let assessment;
  let answers = {};
  let index = 0;
  let busy = false;

  async function request(path, method = 'GET', body) {
    const response = await fetch(`${api}${path}`, {
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

  function showError(error) {
    element('notice').textContent = error.message;
    element('retry').hidden = false;
  }

  function setBusy(value) {
    busy = value;
    element('choices').disabled = value;
    element('back').disabled = value || index === 0;
    element('next').disabled = value;
  }

  function render(focus = false) {
    const question = questions[index];

    element('quiz').hidden = false;
    element('finished').hidden = true;
    element('category').textContent = categories[question.category].label;
    element('position').textContent =
      `Question ${index + 1} of ${questions.length}`;

    element('progress').max = questions.length;
    element('progress').value = questions.filter(
      (item) => answers[item.id]?.length > 0,
    ).length;

    element('question').textContent = question.text;
    element('instruction').textContent = question.maxSelections === 1
      ? 'Choose one answer.'
      : `Choose up to ${question.maxSelections} answers.`;

    element('options').replaceChildren();

    for (const option of question.options) {
      const label = document.createElement('label');
      label.className = 'option';

      const input = document.createElement('input');
      input.type = question.maxSelections === 1 ? 'radio' : 'checkbox';
      input.name = 'answer';
      input.value = option.value;
      input.checked = (answers[question.id] || []).includes(option.value);

      const text = document.createElement('span');
      text.textContent = option.label;

      label.append(input, text);
      element('options').append(label);
    }

    element('next').textContent =
      index === questions.length - 1 ? 'Finish and save' : 'Continue';

    element('save-status').textContent =
      'Your answer is saved when you select Continue or Back.';

    setBusy(false);

    if (focus) {
      element('question').focus();
    }
  }

  function showFinished() {
    element('quiz').hidden = true;
    element('finished').hidden = false;
  }

  async function load() {
    element('loading').hidden = false;
    element('quiz').hidden = true;
    element('finished').hidden = true;
    element('notice').textContent = '';
    element('retry').hidden = true;

    try {
      const [bank, saved] = await Promise.all([
        request('/questions'),
        request('/assessment'),
      ]);

      questions = bank.questions.filter((question) => question.required);
      categories = bank.categories;
      assessment = saved.assessment;

      if (!assessment) {
        try {
          const created = await request('/assessment', 'POST');
          assessment = created.assessment;
        } catch (error) {
          // Another tab may have created the assessment while loading.
          if (error.status !== 409) throw error;
          assessment = (await request('/assessment')).assessment;
        }
      }

      if (!assessment) {
        throw new Error('Could not load your assessment. Please reload.');
      }

      if (assessment.questionnaire_version !== bank.version) {
        throw new Error('Your saved questionnaire version is not supported.');
      }

      answers = { ...assessment.answers };

      if (assessment.core_completed_at) {
        showFinished();
        return;
      }

      const firstUnanswered = questions.findIndex(
        (question) => !answers[question.id]?.length,
      );

      index = firstUnanswered === -1 ? 0 : firstUnanswered;
      render();
    } catch (error) {
      showError(error);
    } finally {
      element('loading').hidden = true;
    }
  }

  async function saveAndMove(direction) {
    if (busy) return;

    element('notice').textContent = '';
    element('retry').hidden = true;

    const question = questions[index];
    const selected = Array.from(
      element('options').querySelectorAll('input:checked'),
      (input) => input.value,
    );

    if (direction > 0 && selected.length === 0) {
      element('notice').textContent = 'Choose an answer before continuing.';
      return;
    }

    if (selected.length > question.maxSelections) {
      element('notice').textContent =
        `Choose no more than ${question.maxSelections} answers.`;
      return;
    }

    const nextAnswers = { ...answers };

    if (selected.length) {
      nextAnswers[question.id] = selected;
    } else {
      delete nextAnswers[question.id];
    }

    const completing = direction > 0 && index === questions.length - 1;

    setBusy(true);
    element('save-status').textContent = 'Saving…';

    try {
      const saved = await request('/assessment', 'PUT', {
        revision: assessment.revision,
        action: completing ? 'complete' : 'draft',
        answers: nextAnswers,
        partnerPreferences: assessment.partner_preferences,
        skippedQuestionIds: assessment.skipped_question_ids,
      });

      assessment = saved.assessment;
      answers = { ...assessment.answers };

      if (completing) {
        showFinished();
      } else {
        index += direction;
        render(true);
      }
    } catch (error) {
      showError(error);
      element('save-status').textContent =
        'Not saved. Your current selection is still on this page.';
    } finally {
      setBusy(false);
    }
  }

  element('answer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveAndMove(1);
  });

  element('back').addEventListener('click', () => {
    if (index > 0) saveAndMove(-1);
  });

  element('retry').addEventListener('click', () => {
    if (window.confirm('Reload saved progress? Unsaved selections will be lost.')) {
      load();
    }
  });

  element('edit').addEventListener('click', () => {
    index = 0;
    render(true);
  });

  load();
})();