/* ─────────────────────────────────────────
   STROOP TASK — APPLICATION LOGIC
   Full experiment engine with precise RT collection,
   state management, CSV export.
   Premium redesign: Typeform-style demographics wizard,
   accordion consent, dual-mode UI.
───────────────────────────────────────── */

'use strict';

// ══════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════

const CONFIG = {
  PRE_FIXATION_MS: 500,
  FIXATION_DURATION_MS: 200,
  POST_FIXATION_MS: 100,
  FEEDBACK_DURATION_MS: 500,
  ITI_MS: 0,
  PRACTICE_TRIALS: 6,
  MAIN_TRIALS: 60,
  RESPONSE_TIMEOUT_MS: 2000,
};

// Hebrew color words and their corresponding ink colors
const COLORS = [
  { word: 'אדום',  color: '#e05252', colorName: 'אדום' },
  { word: 'כחול',  color: '#5272e0', colorName: 'כחול' },
  { word: 'ירוק',  color: '#52b46b', colorName: 'ירוק' },
  { word: 'צהוב',  color: '#c9b020', colorName: 'צהוב' },
];

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════

const STATE = {
  participantId: generateSessionId(),
  age: null,
  gender: null,
  gender_other: null,
  education_years: null,
  mother_tongue: null,
  has_add_lang: null,
  additional_languages_data: null,
  trials: [],
  currentBlock: null,
  trialQueue: [],
  currentTrialIndex: 0,
  totalInBlock: 0,
  stimulusOnset: 0,
  awaitingResponse: false,
  dataIntegrityOk: true,
  timeoutId: null,
};

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

function generateSessionId() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `SP-${ts}-${rnd}`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateTrials(n, isPractice) {
  const congruentPerColor   = Math.ceil(n / (COLORS.length * 2)) || 1;
  const incongruentPerColor = congruentPerColor;
  const list = [];

  COLORS.forEach(wordColor => {
    for (let i = 0; i < congruentPerColor; i++) {
      list.push({
        word: wordColor.word,
        inkColor: wordColor.color,
        inkColorName: wordColor.colorName,
        condition: 'congruent',
        isPractice,
      });
    }

    const others = COLORS.filter(c => c.colorName !== wordColor.colorName);
    for (let i = 0; i < incongruentPerColor; i++) {
      const ink = others[i % others.length];
      list.push({
        word: wordColor.word,
        inkColor: ink.color,
        inkColorName: ink.colorName,
        condition: 'incongruent',
        isPractice,
      });
    }
  });

  return shuffle(list).slice(0, n);
}

// ══════════════════════════════════════════
//  DOM HELPERS
// ══════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = '';
  });
  const target = document.getElementById(id);
  target.style.display = 'flex';
  void target.offsetWidth; // reflow for animation
  target.classList.add('active');

  // Show/hide story bar & step label only on demographics screen
  const storyBar  = document.getElementById('story-bar-container');
  const stepLabel = document.getElementById('step-label-bar');
  if (id === 'screen-demographics') {
    storyBar.style.display  = 'block';
    stepLabel.style.display = 'flex';
  } else {
    storyBar.style.display  = 'none';
    stepLabel.style.display = 'none';
  }
}

function setHidden(el, hidden) {
  el.classList.toggle('hidden', hidden);
}

function lockButtons() {
  const grid = document.getElementById('response-buttons');
  if (grid) grid.classList.add('locked');
}

function unlockButtons() {
  const grid = document.getElementById('response-buttons');
  if (grid) grid.classList.remove('locked');
}

function startCountdownBar() {
  const bar  = document.getElementById('countdown-bar');
  const wrap = document.getElementById('countdown-bar-wrap');
  if (!bar || !wrap) return;
  
  if (STATE.currentBlock !== 'practice') {
    setHidden(wrap, true);
    return;
  }
  
  bar.classList.remove('running');
  void bar.offsetWidth;
  bar.style.animationDuration = CONFIG.RESPONSE_TIMEOUT_MS + 'ms';
  setHidden(wrap, false);
  bar.classList.add('running');
}

function stopCountdownBar() {
  const bar  = document.getElementById('countdown-bar');
  const wrap = document.getElementById('countdown-bar-wrap');
  if (!bar || !wrap) return;
  bar.classList.remove('running');
  setHidden(wrap, true);
}

function clearTrialTimeout() {
  if (STATE.timeoutId !== null) {
    clearTimeout(STATE.timeoutId);
    STATE.timeoutId = null;
  }
}

const DOM = {
  fixation:         () => document.getElementById('fixation'),
  stimulus:         () => document.getElementById('stimulus'),
  feedback:         () => document.getElementById('feedback'),
  phaseLabel:       () => document.getElementById('trial-phase-label'),
  trialCounter:     () => document.getElementById('trial-counter'),
  progressBar:      () => document.getElementById('trial-progress-bar'),
  completionStats:  () => document.getElementById('completion-stats'),
  dataStatusBox:    () => document.getElementById('data-status-box'),
  dataStatusIcon:   () => document.getElementById('data-status-icon'),
  dataStatusMsg:    () => document.getElementById('data-status-msg'),
  sessionIdDisplay: () => document.getElementById('session-id-display'),
};

// ══════════════════════════════════════════
//  ACCORDION (Consent Screen)
// ══════════════════════════════════════════

function toggleAccordion(id) {
  const item = document.getElementById(id);
  if (!item) return;
  const isOpen = item.classList.contains('open');
  item.classList.toggle('open', !isOpen);
  const btn = item.querySelector('.accordion-toggle');
  if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
}

// ══════════════════════════════════════════
//  DEMOGRAPHICS WIZARD
// ══════════════════════════════════════════

/**
 * Wizard steps definition.
 * Each step renders via renderStep(step).
 */
const WIZARD_STEPS = [
  {
    id: 'age',
    label: 'מה גילך?',
    type: 'slider',
    min: 18,
    max: 120,
    defaultVal: 25,
    unit: '',
    hideRangeLabel: true,
  },
  {
    id: 'gender',
    label: 'מה המגדר שלך?',
    type: 'chips',
    cols: 3,
    options: [
      { value: 'זכר',  icon: '👨', label: 'זכר' },
      { value: 'נקבה', icon: '👩', label: 'נקבה' },
      { value: 'אחר',  icon: '⚧️', label: 'אחר' },
    ],
    hasOther: true,
    otherLabel: 'פרט/י מגדר:',
    otherValue: 'אחר',
  },
  {
    id: 'education',
    label: 'מה רמת ההשכלה שלך?',
    type: 'chips',
    cols: 1,
    options: [
      { value: 'השכלה יסודית / חלקית',              icon: '📚', label: 'השכלה יסודית / חלקית' },
      { value: 'השכלה תיכונית ללא תעודת בגרות',     icon: '🏫', label: 'תיכונית ללא בגרות' },
      { value: 'השכלה תיכונית עם תעודת בגרות מלאה', icon: '🎓', label: 'תיכונית עם בגרות מלאה' },
      { value: 'השכלה על-תיכונית',                  icon: '📖', label: 'השכלה על-תיכונית' },
      { value: 'תואר אקדמי ראשון',                  icon: '🎓', label: 'תואר ראשון (BA/BSc)' },
      { value: 'תואר אקדמי שני ומעלה',              icon: '🏅', label: 'תואר שני ומעלה (MA/PhD)' },
    ],
    hasOther: false,
  },
  {
    id: 'mother_tongue',
    label: 'מהי שפת האם שלך?',
    type: 'chips',
    cols: 2,
    options: [
      { value: 'עברית', icon: '<span class="watermark-code">HE</span>', label: 'עברית' },
      { value: 'ערבית', icon: '<span class="watermark-code">AR</span>', label: 'ערבית' },
      { value: 'רוסית', icon: '<span class="watermark-code">RU</span>', label: 'רוסית' },
      { value: 'אנגלית', icon: '<span class="watermark-code">EN</span>', label: 'אנגלית' },
      { value: 'אמהרית', icon: '<span class="watermark-code">AM</span>', label: 'אמהרית' },
      { value: 'צרפתית', icon: '<span class="watermark-code">FR</span>', label: 'צרפתית' },
      { value: 'ספרדית', icon: '<span class="watermark-code">ES</span>', label: 'ספרדית' },
      { value: 'אחר', icon: '<span class="watermark-code">++</span>', label: 'אחר' }
    ],
    hasOther: true,
    otherLabel: 'פרט/י שפה:',
    otherValue: 'אחר',
  },
  {
    id: 'add_lang',
    label: 'האם אתה דובר שפות נוספות?',
    type: 'chips',
    cols: 2,
    options: [
      { value: 'כן', icon: '✅', label: 'כן' },
      { value: 'לא', icon: '❌', label: 'לא' },
    ],
    hasOther: false,
    hasConditional: true,
  },
];

// Wizard runtime state
const WIZARD = {
  currentStep: 0,
  answers: {}, // { age, gender, gender_other, education, mother_tongue, add_lang }
  langBlockCounter: 0,
};

// Total steps count
const WIZARD_TOTAL = WIZARD_STEPS.length;

function startDemographicsWizard() {
  WIZARD.currentStep = 0;
  WIZARD.answers = {};
  WIZARD.langBlockCounter = 0;
  showScreen('screen-demographics');
  renderStep(0, 'none');
}

function updateStoryBar() {
  const step   = WIZARD.currentStep;
  const total  = WIZARD_TOTAL;
  const pct    = Math.round(((step) / total) * 100);

  const fill   = document.getElementById('story-bar-fill');
  const label  = document.getElementById('step-text-label');
  const backBtn = document.getElementById('step-back-btn');

  if (fill)  fill.style.width = pct + '%';
  if (label) label.textContent = `שאלה ${step + 1} מתוך ${total}`;
  if (backBtn) {
    backBtn.style.visibility = step > 0 ? 'visible' : 'hidden';
  }
}

function renderStep(stepIndex, direction) {
  const host = document.getElementById('wizard-slide-host');
  const step = WIZARD_STEPS[stepIndex];
  if (!step) return;

  // Build slide HTML
  let innerHTML = `
    <div class="q-slide ${direction === 'next' ? 'enter-next' : direction === 'prev' ? 'enter-prev' : ''}" id="current-q-slide">
      <div class="question-card">
        <span class="question-label">${step.label}</span>
        ${buildStepInput(step)}
      </div>
      <button class="btn btn-primary" id="wizard-next-btn" onclick="wizardNext()" ${isStepAnswered(step) ? '' : 'disabled'}>
        ${stepIndex < WIZARD_TOTAL - 1 ? 'המשך <span class="btn-arrow">←</span>' : 'סיום ← '}
      </button>
    </div>
  `;

  host.innerHTML = innerHTML;
  updateStoryBar();

  // Wire up real-time enable/disable of next button
  wireStepListeners(step);

  // If already answered, show conditional if needed
  if (step.hasConditional && WIZARD.answers.add_lang === 'כן') {
    showLangConditional();
  }
}

function buildStepInput(step) {
  switch (step.type) {

    case 'slider': {
      const saved = WIZARD.answers[step.id] !== undefined ? WIZARD.answers[step.id] : step.defaultVal;
      return `
        <div style="display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:0.88rem; color:var(--text-dim); font-weight:500;">${step.hideRangeLabel ? '' : step.min + ' – ' + step.max}</span>
            <span class="slider-value-display" id="slider-val-${step.id}">${saved}</span>
          </div>
          <input
            type="range"
            id="input-${step.id}"
            class="styled-slider"
            min="${step.min}"
            max="${step.max}"
            value="${saved}"
            oninput="
              document.getElementById('slider-val-${step.id}').textContent = this.value;
              WIZARD.answers['${step.id}'] = parseInt(this.value, 10);
              document.getElementById('wizard-next-btn').disabled = false;
            "
          >
        </div>
      `;
    }

    case 'chips': {
      const savedVal = WIZARD.answers[step.id];
      let html = `<div class="chip-grid cols-${step.cols}" id="chip-group-${step.id}">`;

      step.options.forEach(opt => {
        const checked = savedVal === opt.value ? 'checked' : '';
        html += `
          <label class="card-chip">
            <input type="radio" name="wizard-${step.id}" value="${opt.value}" ${checked}
              onchange="onChipChange('${step.id}', this.value, ${step.hasConditional ? 'true' : 'false'}, ${step.hasOther ? 'true' : 'false'}, '${(step.otherValue || '').replace(/'/g, "\\'")}')">
            <div class="card-chip-inner">
              <span class="chip-icon">${opt.icon}</span>
              <span class="chip-text">${opt.label}</span>
            </div>
          </label>
        `;
      });

      html += `</div>`;

      // "Other" text input (for gender)
      if (step.hasOther) {
        const otherSaved = WIZARD.answers[`${step.id}_other`] || '';
        const showOther  = savedVal === step.otherValue;
        html += `
          <div id="other-wrap-${step.id}" style="margin-top:14px; display:${showOther ? 'block' : 'none'};">
            <input
              type="text"
              id="other-input-${step.id}"
              placeholder="${step.otherLabel}"
              value="${otherSaved}"
              oninput="WIZARD.answers['${step.id}_other'] = this.value; checkNextBtn();"
              style="margin-top:4px;"
            >
          </div>
        `;
      }

      // Conditional language blocks
      if (step.hasConditional) {
        html += `
          <div id="lang-conditional-wrap" style="margin-top:16px; display:none;">
            <div id="languages-container" style="display:flex; flex-direction:column; gap:14px;"></div>
            <button type="button" class="add-lang-btn" style="margin-top:12px;" onclick="addLanguageBlock()">+ הוסף שפה נוספת</button>
          </div>
        `;
      }

      return html;
    }

    case 'text': {
      const saved = WIZARD.answers[step.id] || '';
      return `
        <input
          type="text"
          id="input-${step.id}"
          placeholder="${step.placeholder || ''}"
          value="${saved}"
          oninput="WIZARD.answers['${step.id}'] = this.value.trim(); checkNextBtn();"
          style="margin-top: 4px;"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
        >
      `;
    }

    default:
      return '';
  }
}

function onChipChange(stepId, value, hasConditional, hasOther, otherValue) {
  WIZARD.answers[stepId] = value;

  // Toggle "other" text input
  if (hasOther) {
    const wrap = document.getElementById(`other-wrap-${stepId}`);
    if (wrap) wrap.style.display = value === otherValue ? 'block' : 'none';
    if (value !== otherValue) WIZARD.answers[`${stepId}_other`] = null;
  }

  // Toggle language conditional
  if (hasConditional) {
    if (value === 'כן') {
      showLangConditional();
    } else {
      hideLangConditional();
    }
  }

  checkNextBtn();
}

function showLangConditional() {
  const wrap = document.getElementById('lang-conditional-wrap');
  if (!wrap) return;
  wrap.style.display = 'block';
  const container = document.getElementById('languages-container');
  if (container && container.children.length === 0) {
    addLanguageBlock();
  }
}

function hideLangConditional() {
  const wrap = document.getElementById('lang-conditional-wrap');
  if (wrap) wrap.style.display = 'none';
}

function isStepAnswered(step) {
  if (!step) return false;
  const val = WIZARD.answers[step.id];
  if (step.type === 'slider') return true; // slider always has a default
  if (step.type === 'text')   return val && val.length > 0;
  if (step.type === 'chips') {
    if (!val) return false;
    if (step.hasOther && val === step.otherValue) {
      const other = WIZARD.answers[`${step.id}_other`];
      return other && other.length > 0;
    }
    return true;
  }
  return false;
}

function checkNextBtn() {
  const step = WIZARD_STEPS[WIZARD.currentStep];
  const btn  = document.getElementById('wizard-next-btn');
  if (btn) btn.disabled = !isStepAnswered(step);
}

function wireStepListeners(step) {
  // For slider: ensure default is stored
  if (step.type === 'slider') {
    const el = document.getElementById(`input-${step.id}`);
    if (el && WIZARD.answers[step.id] === undefined) {
      WIZARD.answers[step.id] = parseInt(el.value, 10);
    }
    // Next button starts enabled for sliders
    const btn = document.getElementById('wizard-next-btn');
    if (btn) btn.disabled = false;
  }
  // For text: check if pre-filled
  if (step.type === 'text') {
    checkNextBtn();
    // Auto-focus
    const el = document.getElementById(`input-${step.id}`);
    if (el) setTimeout(() => el.focus(), 200);
  }
}

function wizardNext() {
  const step = WIZARD_STEPS[WIZARD.currentStep];
  if (!isStepAnswered(step)) return;

  // Collect language data if on add_lang step
  if (step.id === 'add_lang' && WIZARD.answers.add_lang === 'כן') {
    collectLanguageData();
  }

  if (WIZARD.currentStep < WIZARD_TOTAL - 1) {
    WIZARD.currentStep++;
    renderStep(WIZARD.currentStep, 'next');
  } else {
    finalizeDemographics();
  }
}

function wizardBack() {
  if (WIZARD.currentStep > 0) {
    WIZARD.currentStep--;
    renderStep(WIZARD.currentStep, 'prev');
  }
}

function collectLanguageData() {
  const blocks = document.querySelectorAll('.lang-block');
  const langs  = [];
  blocks.forEach(b => {
    const name      = b.querySelector('.lang-name')?.value || '';
    const ageInput  = b.querySelector('input[type="radio"].lang-age:checked');
    const age       = ageInput ? ageInput.value : '';
    const prof      = b.querySelector('.lang-prof')?.value || '';
    const freqInput = b.querySelector('input[type="radio"][name^="lang-freq"]:checked');
    const freq      = freqInput ? freqInput.value : '';
    if (name.trim()) langs.push(`${name} (Age:${age}, Prof:${prof}, Freq:${freq})`);
  });
  WIZARD.answers.languages_data = langs.join(' | ') || null;
}

function finalizeDemographics() {
  // Map wizard answers to STATE
  STATE.age                      = WIZARD.answers.age  || 25;
  STATE.gender                   = WIZARD.answers.gender || null;
  STATE.gender_other             = WIZARD.answers.gender_other || null;
  STATE.education_years          = WIZARD.answers.education || null;
  STATE.mother_tongue            = WIZARD.answers.mother_tongue || null;
  STATE.has_add_lang             = WIZARD.answers.add_lang || 'לא';
  STATE.additional_languages_data = WIZARD.answers.languages_data || null;

  showScreen('screen-onboarding');
}

// ══════════════════════════════════════════
//  LANGUAGE BLOCKS (inside wizard step 5)
// ══════════════════════════════════════════

function addLanguageBlock() {
  WIZARD.langBlockCounter++;
  const n = WIZARD.langBlockCounter;
  const container = document.getElementById('languages-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'lang-block';

  const langOptions = [
    { value: 'עברית', icon: '<span class="watermark-code">HE</span>', label: 'עברית' },
    { value: 'ערבית', icon: '<span class="watermark-code">AR</span>', label: 'ערבית' },
    { value: 'רוסית', icon: '<span class="watermark-code">RU</span>', label: 'רוסית' },
    { value: 'אנגלית', icon: '<span class="watermark-code">EN</span>', label: 'אנגלית' },
    { value: 'אמהרית', icon: '<span class="watermark-code">AM</span>', label: 'אמהרית' },
    { value: 'צרפתית', icon: '<span class="watermark-code">FR</span>', label: 'צרפתית' },
    { value: 'ספרדית', icon: '<span class="watermark-code">ES</span>', label: 'ספרדית' },
    { value: 'אחר', icon: '<span class="watermark-code">++</span>', label: 'אחר' }
  ];

  let chipsHtml = `<div class="chip-grid cols-2" id="chip-group-lang-${n}">`;
  langOptions.forEach(opt => {
    chipsHtml += `
      <label class="card-chip">
        <input type="radio" name="lang-name-radio-${n}" value="${opt.value}" 
          onchange="
            document.querySelectorAll('#chip-group-lang-${n} .card-chip').forEach(l => l.classList.remove('active'));
            this.closest('.card-chip').classList.add('active');
            const otherWrap = document.getElementById('other-wrap-lang-${n}');
            const otherInput = document.getElementById('other-input-lang-${n}');
            const hiddenNameInput = document.getElementById('lang-name-hidden-${n}');
            if (this.value === 'אחר') {
              otherWrap.style.display = 'block';
              hiddenNameInput.value = otherInput.value;
            } else {
              otherWrap.style.display = 'none';
              hiddenNameInput.value = this.value;
            }
          ">
        <div class="card-chip-inner">
          ${opt.icon}
          <span class="chip-text">${opt.label}</span>
        </div>
      </label>
    `;
  });
  chipsHtml += `</div>
    <div id="other-wrap-lang-${n}" class="other-wrap" style="display:none; margin-top:12px;">
      <label class="question-label" style="font-size:0.95rem; margin-bottom:8px;">פרט/י שפה:</label>
      <input type="text" class="styled-input" id="other-input-lang-${n}" placeholder="הקלד/י כאן..."
        oninput="document.getElementById('lang-name-hidden-${n}').value = this.value">
    </div>
    <input type="hidden" class="lang-name" id="lang-name-hidden-${n}" value="">
  `;

  div.innerHTML = `
    <h4>
      שפה #${n}
      ${n > 1 ? `<button type="button" class="lang-remove-btn" onclick="this.closest('.lang-block').remove()">הסר ✕</button>` : ''}
    </h4>

    <div style="display:flex; flex-direction:column; gap:6px;">
      <label style="font-weight:600; font-size:0.9rem; color:var(--text-dim);">מהי השפה?</label>
      ${chipsHtml}
    </div>

    <div style="display:flex; flex-direction:column; gap:8px;">
      <label style="font-weight:600; font-size:0.9rem; color:var(--text-dim);">באיזה גיל התחלת לדבר בשפה?</label>
      <div class="age-pill-grid">
        <label class="pill-radio">
          <input type="radio" class="lang-age" name="lang-age-${n}" value="0–6">
          <span dir="ltr">0–6</span>
        </label>
        <label class="pill-radio">
          <input type="radio" class="lang-age" name="lang-age-${n}" value="6–12">
          <span dir="ltr">6–12</span>
        </label>
        <label class="pill-radio">
          <input type="radio" class="lang-age" name="lang-age-${n}" value="12–18">
          <span dir="ltr">12–18</span>
        </label>
        <label class="pill-radio">
          <input type="radio" class="lang-age" name="lang-age-${n}" value="18–30">
          <span dir="ltr">18–30</span>
        </label>
        <label class="pill-radio">
          <input type="radio" class="lang-age" name="lang-age-${n}" value="30+">
          <span dir="ltr">30+</span>
        </label>
      </div>
    </div>

    <div style="display:flex; flex-direction:column; gap:4px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <label style="font-weight:600; font-size:0.9rem; color:var(--text-dim);">רמת שליטה (1–10)</label>
        <span id="lang-prof-val-${n}" class="slider-value-display" style="font-size:1rem; padding:3px 12px;">5</span>
      </div>
      <input type="range" class="lang-prof styled-slider" min="1" max="10" value="5"
        oninput="document.getElementById('lang-prof-val-${n}').textContent = this.value">
    </div>

    <div style="display:flex; flex-direction:column; gap:8px;">
      <label style="font-weight:600; font-size:0.9rem; color:var(--text-dim);">תדירות שימוש יומיומי</label>
      <div class="freq-grid-2x2">
        <label class="freq-chip">
          <input type="radio" name="lang-freq-${n}" value="בכלל לא">
          <span><i class="dot dot-gray"></i> בכלל לא</span>
        </label>
        <label class="freq-chip">
          <input type="radio" name="lang-freq-${n}" value="לעתים רחוקות">
          <span><i class="dot dot-yellow"></i> לעתים רחוקות</span>
        </label>
        <label class="freq-chip">
          <input type="radio" name="lang-freq-${n}" value="מדי כמה ימים">
          <span><i class="dot dot-blue"></i> מדי כמה ימים</span>
        </label>
        <label class="freq-chip">
          <input type="radio" name="lang-freq-${n}" value="כל יום">
          <span><i class="dot dot-green"></i> כל יום</span>
        </label>
      </div>
    </div>
  `;

  container.appendChild(div);
}

// ══════════════════════════════════════════
//  STROOP TASK — BLOCK RUNNERS
// ══════════════════════════════════════════

function startPractice() {
  STATE.currentBlock    = 'practice';
  STATE.trialQueue      = generateTrials(CONFIG.PRACTICE_TRIALS, true);
  STATE.currentTrialIndex = 0;
  STATE.totalInBlock    = STATE.trialQueue.length;
  DOM.phaseLabel().textContent = 'תרגול';
  showScreen('screen-trial');
  setTimeout(() => runNextTrial(), 300);
}

function startMain() {
  STATE.currentBlock    = 'main';
  STATE.trialQueue      = generateTrials(CONFIG.MAIN_TRIALS, false);
  STATE.currentTrialIndex = 0;
  STATE.totalInBlock    = STATE.trialQueue.length;
  DOM.phaseLabel().textContent = 'מטלה';
  showScreen('screen-trial');
  setTimeout(() => runNextTrial(), 300);
}

// ══════════════════════════════════════════
//  TRIAL ENGINE
// ══════════════════════════════════════════

function runNextTrial() {
  if (STATE.currentTrialIndex >= STATE.trialQueue.length) {
    endBlock();
    return;
  }

  clearTrialTimeout();
  stopCountdownBar();

  const idx   = STATE.currentTrialIndex + 1;
  const total = STATE.totalInBlock;
  DOM.trialCounter().textContent  = `ניסיון ${idx} מתוך ${total}`;
  DOM.progressBar().style.width   = `${((idx - 1) / total) * 100}%`;

  lockButtons();
  setHidden(DOM.stimulus(), true);
  setHidden(DOM.feedback(), true);
  setHidden(DOM.fixation(), false);
  DOM.fixation().classList.add('hidden');

  setTimeout(() => {
    setHidden(DOM.fixation(), false);

    setTimeout(() => {
      setHidden(DOM.fixation(), true);

      setTimeout(() => {
        showStimulus();
      }, CONFIG.POST_FIXATION_MS);

    }, CONFIG.FIXATION_DURATION_MS);
  }, CONFIG.PRE_FIXATION_MS);
}

function showStimulus() {
  const trial  = STATE.trialQueue[STATE.currentTrialIndex];
  const stimEl = DOM.stimulus();

  setHidden(DOM.fixation(), true);
  stimEl.textContent  = trial.word;
  stimEl.style.color  = trial.inkColor;
  setHidden(stimEl, false);

  unlockButtons();
  STATE.stimulusOnset    = performance.now();
  STATE.awaitingResponse = true;

  startCountdownBar();
  STATE.timeoutId = setTimeout(() => handleTimeout(), CONFIG.RESPONSE_TIMEOUT_MS);
}

function handleResponse(respondedColorName) {
  if (!STATE.awaitingResponse) return;
  STATE.awaitingResponse = false;
  lockButtons();

  clearTrialTimeout();
  stopCountdownBar();

  const rt    = performance.now() - STATE.stimulusOnset;
  const trial = STATE.trialQueue[STATE.currentTrialIndex];
  const isCorrect = respondedColorName === trial.inkColorName;

  const record = {
    participant_id:            STATE.participantId,
    age:                       STATE.age,
    gender:                    STATE.gender,
    gender_other:              STATE.gender_other,
    education_years:           STATE.education_years,
    mother_tongue:             STATE.mother_tongue,
    has_add_lang:              STATE.has_add_lang,
    additional_languages_data: STATE.additional_languages_data,
    is_task:                   !trial.isPractice,
    trial_number:              STATE.trials.length + 1,
    block_trial_number:        STATE.currentTrialIndex + 1,
    condition:                 trial.condition,
    displayed_word:            trial.word,
    ink_color:                 trial.inkColorName,
    user_input:                respondedColorName,
    input_method:              'mouse',
    accuracy:                  isCorrect,
    rt_ms:                     Math.round(rt * 100) / 100,
    timestamp_iso:             new Date().toISOString(),
  };

  STATE.trials.push(record);
  validateDataIntegrity(record);

  setHidden(DOM.stimulus(), true);
  showFeedback(isCorrect);
}

function showFeedback(correct) {
  const fbEl = DOM.feedback();
  fbEl.textContent = correct ? 'נכון ✓' : 'טעות ✗';
  fbEl.className   = 'feedback ' + (correct ? 'correct' : 'incorrect');
  setHidden(fbEl, false);

  setTimeout(() => {
    setHidden(fbEl, true);
    STATE.currentTrialIndex++;
    setTimeout(() => runNextTrial(), CONFIG.ITI_MS);
  }, CONFIG.FEEDBACK_DURATION_MS);
}

// ══════════════════════════════════════════
//  RESPONSE TIMEOUT
// ══════════════════════════════════════════

function handleTimeout() {
  if (!STATE.awaitingResponse) return;
  STATE.awaitingResponse = false;
  STATE.timeoutId = null;
  lockButtons();
  stopCountdownBar();

  const trial = STATE.trialQueue[STATE.currentTrialIndex];

  const record = {
    participant_id:            STATE.participantId,
    age:                       STATE.age,
    gender:                    STATE.gender,
    gender_other:              STATE.gender_other,
    education_years:           STATE.education_years,
    mother_tongue:             STATE.mother_tongue,
    has_add_lang:              STATE.has_add_lang,
    additional_languages_data: STATE.additional_languages_data,
    is_task:                   !trial.isPractice,
    trial_number:              STATE.trials.length + 1,
    block_trial_number:        STATE.currentTrialIndex + 1,
    condition:                 trial.condition,
    displayed_word:            trial.word,
    ink_color:                 trial.inkColorName,
    user_input:                'timeout',
    input_method:              'timeout',
    accuracy:                  false,
    rt_ms:                     null,
    timestamp_iso:             new Date().toISOString(),
  };

  STATE.trials.push(record);

  setHidden(DOM.stimulus(), true);

  const fbEl = DOM.feedback();
  fbEl.textContent = 'הזמן עבר';
  fbEl.className   = 'feedback timeout';
  setHidden(fbEl, false);

  setTimeout(() => {
    setHidden(fbEl, true);
    STATE.currentTrialIndex++;
    setTimeout(() => runNextTrial(), CONFIG.ITI_MS);
  }, CONFIG.FEEDBACK_DURATION_MS);
}

// ══════════════════════════════════════════
//  BLOCK END
// ══════════════════════════════════════════

function endBlock() {
  if (STATE.currentBlock === 'practice') {
    showScreen('screen-transition');
  } else {
    showCompletionScreen();
  }
}

// ══════════════════════════════════════════
//  DATA INTEGRITY
// ══════════════════════════════════════════

function validateDataIntegrity(record) {
  if (
    record.rt_ms < 0 ||
    record.rt_ms > 10000 ||
    !record.participant_id ||
    record.user_input === null
  ) {
    STATE.dataIntegrityOk = false;
    console.warn('[DATA] Integrity issue on record:', record);
  }
}

// ══════════════════════════════════════════
//  COMPLETION SCREEN
// ══════════════════════════════════════════

function showCompletionScreen() {
  showScreen('screen-complete');
  DOM.sessionIdDisplay().textContent = STATE.participantId;

  DOM.dataStatusIcon().textContent = '⏳';
  DOM.dataStatusMsg().textContent  = 'שומר נתונים...';

  calculatePersonalInsight();
  submitData();
}

function calculatePersonalInsight() {
  // Only look at actual task trials (not practice) that were correct
  const validTrials = STATE.trials.filter(t => t.is_task && t.accuracy && t.rt_ms != null);
  
  if (validTrials.length < 10) return; // Not enough data to be meaningful

  let congSum = 0, congCount = 0;
  let incongSum = 0, incongCount = 0;

  validTrials.forEach(t => {
    if (t.condition === 'congruent') {
      congSum += t.rt_ms;
      congCount++;
    } else if (t.condition === 'incongruent') {
      incongSum += t.rt_ms;
      incongCount++;
    }
  });

  if (congCount === 0 || incongCount === 0) return;

  const congAvg = Math.round(congSum / congCount);
  const incongAvg = Math.round(incongSum / incongCount);
  const diff = incongAvg - congAvg;

  // Max value for CSS bar scaling (usually around 1500ms is a safe max for average RT)
  const maxRt = Math.max(congAvg, incongAvg, 1200); 
  const congPct = Math.min((congAvg / maxRt) * 100, 100);
  const incongPct = Math.min((incongAvg / maxRt) * 100, 100);

  // Update UI
  document.getElementById('time-congruent').textContent = congAvg + 'ms';
  document.getElementById('time-incongruent').textContent = incongAvg + 'ms';

  const summary = document.getElementById('insight-summary');
  if (diff > 0) {
    summary.innerHTML = `זמן ה״הילוך הידני״ שלך: לקח למוח שלך <strong>${diff} מילישניות</strong> לכבות את הטייס האוטומטי ולהתגבר על הבלבול!`;
  } else if (diff < 0) {
    summary.innerHTML = `מדהים! הטייס האוטומטי שלך עובד הפוך - היית מהיר/ה יותר ב-<strong>${Math.abs(diff)} מילישניות</strong>!`;
  } else {
    summary.innerHTML = `וואו, המהירות שלך הייתה זהה לחלוטין בשני המצבים!`;
  }

  // Assign Focus Profile
  const profileContainer = document.getElementById('insight-profile');
  const pIcon = document.getElementById('profile-icon');
  const pTitle = document.getElementById('profile-title');
  const pDesc = document.getElementById('profile-desc');

  if (diff > 0) {
    profileContainer.classList.add('show');
    if (diff < 150) {
      pIcon.textContent = '🎯';
      pTitle.textContent = 'פרופיל: פקח/ית טיסה';
      pDesc.textContent = 'יש לך יכולת נדירה להתעלם מהסחות דעת ולהתרכז במידע החשוב באמת!';
    } else if (diff <= 300) {
      pIcon.textContent = '⚖️';
      pTitle.textContent = 'פרופיל: נהג/ת מיומן/ת';
      pDesc.textContent = 'יש לך איזון בריא בין קריאה אוטומטית לשליטה מודעת ותשומת לב לפרטים.';
    } else {
      pIcon.textContent = '📚';
      pTitle.textContent = 'פרופיל: תולעת ספרים';
      pDesc.textContent = 'המוח שלך כל כך מאומן וממוקד בקריאת מילים, שקשה לו מאוד להתעלם מהן!';
    }
  }

  const container = document.getElementById('insight-container');
  container.classList.remove('hidden');

  // Trigger animations shortly after showing
  setTimeout(() => {
    document.getElementById('bar-congruent').style.width = congPct + '%';
    document.getElementById('bar-incongruent').style.width = incongPct + '%';
  }, 100);
}

// ══════════════════════════════════════════
//  DATA SUBMISSION
// ══════════════════════════════════════════

async function submitData() {
  const statusIcon = DOM.dataStatusIcon();
  const statusMsg  = DOM.dataStatusMsg();
  const statusBox  = DOM.dataStatusBox();

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trials: STATE.trials }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.ok) {
      statusIcon.textContent = '💾';
      statusMsg.textContent  = `הנתונים נשמרו בהצלחה — ${json.saved} ניסיונות`;
    } else {
      throw new Error(json.error || 'Unknown server error');
    }
  } catch (err) {
    console.error('[SUBMIT]', err);
    statusIcon.textContent = '⚠️';
    statusMsg.innerHTML    = `<strong>שגיאה בשמירת הנתונים.</strong> אנא צור קשר עם החוקר.`;
    statusBox.style.borderColor = 'rgba(224,82,82,0.4)';
    statusBox.style.background  = 'rgba(224,82,82,0.08)';
    try {
      sessionStorage.setItem(
        `stroop_fallback_${STATE.participantId}`,
        JSON.stringify(STATE.trials)
      );
      statusMsg.innerHTML += ' <small>(גיבוי: נשמר מקומית בדפדפן)</small>';
    } catch (_) {}
  }
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════

(function init() {
  const sidEl = document.getElementById('session-id-display');
  if (sidEl) sidEl.textContent = STATE.participantId;

  // Wire color-button click handlers
  document.querySelectorAll('#response-buttons .color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      handleResponse(btn.dataset.color);
    });
  });

  showScreen('screen-intro');
  console.log(`[STROOP] Session started. ID: ${STATE.participantId}`);
})();
