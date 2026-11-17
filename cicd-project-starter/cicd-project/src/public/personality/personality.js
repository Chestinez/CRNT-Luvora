const {
  version,
  displayQuestions,
  dimensions,
  choices,
  characters,
} = window.LuvoraPersonality;

const PAGE_SIZE = 5;
const API_URL = '/api/personality/assessment';

const state = {
  assessment: null,
  answers: {},
  resolutions: {},
  page: 0,
  screen: 'invitation',
  busy: false,
  dirty: false,
};

const screens = ['invitation', 'quiz', 'review', 'result'];

function element(selector) {
  return document.querySelector(selector);
}

function showNotice(message = '', error = false) {
  const notice = element('#notice');
  notice.textContent = message;
  notice.classList.toggle('error', error);
}

function showScreen(name) {
  state.screen = name;

  for (const screen of screens) {
    element(`#${screen}`).hidden = screen !== name;
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function adoptAssessment(assessment) {
  state.assessment = assessment;
  state.answers = { ...(assessment?.answers || {}) };
  state.resolutions = { ...(assessment?.resolutions || {}) };
  state.dirty = false;
}

async function request(method, body) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(API_URL, options);

  if (response.status === 204) {
    return null;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'The request failed. Please try again.');
  }

  return data.assessment;
}

async function perform(action) {
  if (state.busy) return;

  state.busy = true;
  showNotice('');

  const controls = Array.from(
    document.querySelectorAll('button, input, select'),
  );

  const previousDisabled = controls.map((control) => control.disabled);

  controls.forEach((control) => {
    control.disabled = true;
  });

  try {
    await action();
  } catch (error) {
    showNotice(error.message, true);
    element('#notice').scrollIntoView({ block: 'nearest' });
  } finally {
    controls.forEach((control, index) => {
      control.disabled = previousDisabled[index];
    });

    state.busy = false;
  }
}

function firstUnansweredPage() {
  const index = displayQuestions.findIndex(
    (question) => state.answers[question.id] === undefined,
  );

  return index < 0 ? 0 : Math.floor(index / PAGE_SIZE);
}

function updateProgress() {
  const count = Object.keys(state.answers).length;
  const progress = element('#progress');

  element('#answer-count').textContent = `${count} of 100 answered`;
  element('#page-count').textContent =
    `Page ${state.page + 1} of ${displayQuestions.length / PAGE_SIZE}`;

  progress.value = count;
  progress.textContent = `${count} of 100 answered`;
}

function renderQuiz() {
  const container = element('#questions');
  container.replaceChildren();

  const start = state.page * PAGE_SIZE;
  const questions = displayQuestions.slice(start, start + PAGE_SIZE);

  for (const [index, question] of questions.entries()) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'question';

    const legend = document.createElement('legend');
    legend.textContent = `${start + index + 1}. ${question.text}`;
    fieldset.append(legend);

    const scale = document.createElement('div');
    scale.className = 'answer-scale';

    for (const choice of choices) {
      const label = document.createElement('label');
      label.className = 'answer-option';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `question-${question.id}`;
      input.value = String(choice.value);
      input.required = true;
      input.checked = state.answers[question.id] === choice.value;

      const caption = document.createElement('span');
      caption.textContent = choice.label;

      input.addEventListener('change', () => {
        state.answers[question.id] = choice.value;

        // Changing an answer invalidates previous close-preference selections.
        state.resolutions = {};
        state.dirty = true;
        updateProgress();
      });

      label.append(input, caption);
      scale.append(label);
    }

    fieldset.append(scale);
    container.append(fieldset);
  }

  element('#next').textContent =
    state.page === 19 ? 'Review answers' : 'Continue';

  updateProgress();
  showScreen('quiz');
}

async function saveAssessment(action) {
  const assessment = await request('PUT', {
    revision: state.assessment.revision,
    action,
    answers: state.answers,
    resolutions: state.resolutions,
  });

  adoptAssessment(assessment);
}

async function saveDraftIfNeeded() {
  if (state.dirty) {
    await saveAssessment('draft');
  }
}

function renderInvitation() {
  const assessment = state.assessment;
  const count = Object.keys(state.answers).length;

  element('#start').textContent = assessment
    ? `Resume quiz · ${count}/100 answered`
    : 'Take the personality quiz';

  element('#view-result').hidden = !assessment?.result;
  showScreen('invitation');
}

function renderReview() {
  const container = element('#review-list');
  container.replaceChildren();

  for (const [index, question] of displayQuestions.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-item';

    const statement = document.createElement('span');
    statement.textContent = `${index + 1}. ${question.text}`;

    const answer = document.createElement('small');
    answer.textContent =
      choices.find((choice) => choice.value === state.answers[question.id])
        ?.label || 'Unanswered';

    button.append(statement, answer);

    button.addEventListener('click', () => {
      state.page = Math.floor(index / PAGE_SIZE);
      renderQuiz();
    });

    container.append(button);
  }

  showScreen('review');
}

function renderBreakdown(result) {
  const container = element('#breakdown');
  container.replaceChildren();

  for (const item of result.breakdown) {
    const dimension = dimensions.find((entry) => entry.key === item.key);

    const row = document.createElement('div');

    const heading = document.createElement('div');
    heading.className = 'dimension-heading';

    const name = document.createElement('strong');
    name.textContent = dimension.name;

    const preference = document.createElement('span');
    if (item.letter === 'X') {
      preference.textContent = 'Equal score · choose below';
    } else if (item.close) {
      preference.textContent = `${item.letter} · slight preference`;
    } else {
      preference.textContent = `${item.letter} preference`;
    }

    heading.append(name, preference);

    const bar = document.createElement('div');
    bar.className = 'dimension-bar';
    bar.setAttribute('aria-hidden', 'true');

    const fill = document.createElement('span');
    fill.style.width = `${item.positivePercent}%`;
    bar.append(fill);

    const labels = document.createElement('div');
    labels.className = 'dimension-labels';

    const positive = document.createElement('span');
    positive.textContent =
      `${dimension.positive} · ${dimension.positiveLabel}`;

    const negative = document.createElement('span');
    negative.textContent =
      `${dimension.negative} · ${dimension.negativeLabel}`;

    labels.append(positive, negative);
    row.append(heading, bar, labels);
    container.append(row);
  }
}

function renderResolutions(result) {
  const container = element('#resolutions');
  container.replaceChildren();

  for (const item of result.breakdown.filter((entry) => entry.close)) {
    const dimension = dimensions.find((entry) => entry.key === item.key);
    const wrapper = document.createElement('div');
    wrapper.className = 'resolution';

    const label = document.createElement('label');
    label.htmlFor = `resolve-${item.key}`;
    label.textContent =
      `${dimension.name} is close. Which preference fits you better?`;

    const select = document.createElement('select');
    select.id = label.htmlFor;

    const options = [
      ['X', 'Both fit equally / keep balanced'],
      [
        dimension.positive,
        `${dimension.positive} · ${dimension.positiveLabel}`,
      ],
      [
        dimension.negative,
        `${dimension.negative} · ${dimension.negativeLabel}`,
      ],
    ];

    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }

    select.value = state.resolutions[item.key] || 'X';

    select.addEventListener('change', () => {
      const previous = state.resolutions[item.key];

      void perform(async () => {
        state.resolutions[item.key] = select.value;
        state.dirty = true;

        try {
          await saveAssessment('complete');
          renderResult();
        } catch (error) {
          if (previous === undefined) {
            delete state.resolutions[item.key];
          } else {
            state.resolutions[item.key] = previous;
          }

          select.value = previous || 'X';
          throw error;
        }
      });
    });

    wrapper.append(label, select);
    container.append(wrapper);
  }
}

function renderMascot(type, character) {
  const image = element('#mascot-image');
  const symbol = element('#mascot-symbol');

  image.hidden = true;
  symbol.hidden = false;
  symbol.textContent = character?.symbol || '◇';

  image.onload = () => {
    image.hidden = false;
    symbol.hidden = true;
  };

  image.onerror = () => {
    image.hidden = true;
    symbol.hidden = false;
  };

  if (character) {
    image.alt = `${character.name} mascot`;
    image.src = `/personality/mascots/${type}.png`;
  } else {
    image.removeAttribute('src');
  }
}

function renderResult() {
  const result = state.assessment.result;
  const character = characters[result.type];

  element('#result-type').textContent = result.type;
  element('#result-name').textContent =
    character?.name || 'Your preferences are balanced';

  element('#result-description').textContent =
    character?.description ||
    'Some preferences are closely balanced. Explore the descriptions below and choose what feels most like you.';

  renderMascot(result.type, character);
  renderBreakdown(result);
  renderResolutions(result);

  element('#publish').hidden =
    state.assessment.published || result.type.includes('X');

  element('#published-status').textContent = state.assessment.published
    ? 'Your personality type is on your profile.'
    : 'Your answers are saved. Your type has not been added to your profile.';

  showScreen('result');
}

element('#start').addEventListener('click', () => {
  void perform(async () => {
    if (!state.assessment) {
      adoptAssessment(await request('POST'));
    }

    state.page = firstUnansweredPage();
    renderQuiz();
  });
});

element('#view-result').addEventListener('click', renderResult);

element('#quiz-form').addEventListener('submit', (event) => {
  event.preventDefault();

  void perform(async () => {
    await saveDraftIfNeeded();

    if (state.page < 19) {
      state.page += 1;
      renderQuiz();
    } else {
      renderReview();
    }
  });
});

element('#back').addEventListener('click', () => {
  void perform(async () => {
    await saveDraftIfNeeded();

    if (state.page === 0) {
      renderInvitation();
    } else {
      state.page -= 1;
      renderQuiz();
    }
  });
});

element('#save-exit').addEventListener('click', () => {
  void perform(async () => {
    await saveDraftIfNeeded();
    renderInvitation();
    showNotice('Your progress is saved.');
  });
});

element('#review-back').addEventListener('click', () => {
  state.page = 19;
  renderQuiz();
});

element('#finish').addEventListener('click', () => {
  void perform(async () => {
    await saveAssessment('complete');
    renderResult();
  });
});

element('#publish').addEventListener('click', () => {
  void perform(async () => {
    await saveAssessment('publish');
    renderResult();
    showNotice('Your personality type has been added to your profile.');
  });
});

element('#edit').addEventListener('click', renderReview);

element('#delete').addEventListener('click', () => {
  const confirmed = window.confirm(
    'Delete all quiz answers and remove the personality type published by this assessment?',
  );

  if (!confirmed) return;

  void perform(async () => {
    await request('DELETE', {
      revision: state.assessment.revision,
    });

    adoptAssessment(null);
    state.page = 0;
    renderInvitation();
    showNotice('Your assessment has been deleted.');
  });
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

void perform(async () => {
  const assessment = await request('GET');

  if (assessment && assessment.questionnaire_version !== version) {
    throw new Error('This questionnaire version is no longer supported.');
  }

  adoptAssessment(assessment);

  if (assessment?.result) {
    renderResult();
  } else {
    renderInvitation();
  }
});