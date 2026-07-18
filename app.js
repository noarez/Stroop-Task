/* ─────────────────────────────────────────
   STROOP TASK — APPLICATION LOGIC
   Full experiment engine with precise RT collection,
   state management, CSV export.
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
  ITI_MS: 0,                  // inter-trial interval after feedback disappears
  PRACTICE_TRIALS: 6,
  MAIN_TRIALS: 60,
  RESPONSE_TIMEOUT_MS: 2000,    // auto-advance if no response within this window
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
  trials: [],          // all recorded trial objects
  currentBlock: null,  // 'practice' | 'main'
  trialQueue: [],      // ordered list of trial specs to run
  currentTrialIndex: 0,
  totalInBlock: 0,
  stimulusOnset: 0,    // performance.now() when stimulus appeared
  awaitingResponse: false,
  dataIntegrityOk: true,
  timeoutId: null,     // handle for the per-trial response timeout
};

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

function generateSessionId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `SP-${ts}-${rnd}`;
}

/** Fisher-Yates shuffle */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate a balanced trial list.
 * Half congruent, half incongruent.
 * @param {number} n  Total trial count (should be divisible by 4*2=8)
 * @param {boolean} isPractice
 */
function generateTrials(n, isPractice) {
  // Use Math.ceil so we always generate AT LEAST `n` trials even if n is not divisible by 8
  const congruentPerColor = Math.ceil(n / (COLORS.length * 2)) || 1;
  const incongruentPerColor = congruentPerColor;
  const list = [];

  COLORS.forEach(wordColor => {
    // Congruent: word and ink match
    for (let i = 0; i < congruentPerColor; i++) {
      list.push({
        word: wordColor.word,
        inkColor: wordColor.color,
        inkColorName: wordColor.colorName,
        condition: 'congruent',
        isPractice,
      });
    }

    // Incongruent: ink color is a different color
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

  // Shuffle and slice to exactly `n`
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
  // Trigger reflow for animation
  void target.offsetWidth;
  target.classList.add('active');
}

function setHidden(el, hidden) {
  el.classList.toggle('hidden', hidden);
}

/** Lock color buttons between trials (prevents stray clicks) */
function lockButtons() {
  const grid = document.getElementById('response-buttons');
  if (grid) grid.classList.add('locked');
}

/** Unlock color buttons when stimulus is shown */
function unlockButtons() {
  const grid = document.getElementById('response-buttons');
  if (grid) grid.classList.remove('locked');
}

/** Start the shrinking countdown bar and schedule the timeout */
function startCountdownBar() {
  const bar  = document.getElementById('countdown-bar');
  const wrap = document.getElementById('countdown-bar-wrap');
  if (!bar || !wrap) return;
  // Remove running class, force reflow to restart the CSS animation, then re-add
  bar.classList.remove('running');
  void bar.offsetWidth;
  bar.style.animationDuration = CONFIG.RESPONSE_TIMEOUT_MS + 'ms';
  setHidden(wrap, false);
  bar.classList.add('running');
}

/** Stop and hide the countdown bar */
function stopCountdownBar() {
  const bar  = document.getElementById('countdown-bar');
  const wrap = document.getElementById('countdown-bar-wrap');
  if (!bar || !wrap) return;
  bar.classList.remove('running');
  setHidden(wrap, true);
}

/** Cancel any running per-trial timeout */
function clearTrialTimeout() {
  if (STATE.timeoutId !== null) {
    clearTimeout(STATE.timeoutId);
    STATE.timeoutId = null;
  }
}

// ── Cached DOM refs ──
const DOM = {
  fixation:          () => document.getElementById('fixation'),
  stimulus:          () => document.getElementById('stimulus'),
  feedback:          () => document.getElementById('feedback'),
  phaseLabel:        () => document.getElementById('trial-phase-label'),
  trialCounter:      () => document.getElementById('trial-counter'),
  progressBar:       () => document.getElementById('trial-progress-bar'),
  completionStats:   () => document.getElementById('completion-stats'),
  dataStatusBox:     () => document.getElementById('data-status-box'),
  dataStatusIcon:    () => document.getElementById('data-status-icon'),
  dataStatusMsg:     () => document.getElementById('data-status-msg'),
  sessionIdDisplay:  () => document.getElementById('session-id-display'),
};

// ══════════════════════════════════════════
//  BLOCK RUNNERS
// ══════════════════════════════════════════

function toggleGenderOther() {
  const gender = document.querySelector('input[name="demo-gender"]:checked')?.value;
  const wrap = document.getElementById('demo-gender-other-wrap');
  const input = document.getElementById('demo-gender-other');
  if (gender === 'אחר') {
    wrap.style.display = 'flex';
    input.required = true;
  } else {
    wrap.style.display = 'none';
    input.required = false;
  }
}

function toggleAddLang() {
  const hasLang = document.querySelector('input[name="demo-has-add-lang"]:checked')?.value;
  const wrap = document.getElementById('demo-add-lang-wrap');
  const container = document.getElementById('languages-container');
  
  if (hasLang === 'כן') {
    wrap.style.display = 'flex';
    if (container.children.length === 0) {
      addLanguageBlock();
    }
    // Restore required attribute when visible
    container.querySelectorAll('input.lang-name, input[type="radio"]').forEach(el => el.required = true);
  } else {
    wrap.style.display = 'none';
    // Remove required attribute from hidden fields to allow form submission
    container.querySelectorAll('input.lang-name, input[type="radio"]').forEach(el => el.required = false);
  }
}

let langBlockCounter = 0;
function addLanguageBlock() {
  langBlockCounter++;
  const container = document.getElementById('languages-container');
  const div = document.createElement('div');
  div.className = 'lang-block';
  div.style.cssText = 'background: rgba(255,255,255,0.05); padding: 16px; border-radius: 8px; position: relative; display: flex; flex-direction: column;';
  
  div.innerHTML = `
    <h4 style="margin-top: 0; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      שפה #${langBlockCounter}
      ${langBlockCounter > 1 ? `<button type="button" style="background: transparent; border: none; color: #ff5252; cursor: pointer; font-weight: bold; padding: 4px;" onclick="this.closest('.lang-block').remove()">הסר ✕</button>` : ''}
    </h4>
    
    <div style="margin-bottom: 12px; display: flex; flex-direction: column;">
      <label style="font-weight: bold; margin-bottom: 4px;">מהי השפה?</label>
      <input type="text" class="lang-name" required style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card2); color: var(--text);">
    </div>

    <div style="margin-bottom: 24px; display: flex; flex-direction: column;">
      <label style="font-weight: bold; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span>באיזה גיל התחלת לדבר את השפה?</span>
        <span id="lang-age-val-${langBlockCounter}" style="color: var(--accent); font-size: 1.3rem; font-weight: 800; background: rgba(0,0,0,0.2); padding: 4px 16px; border-radius: 8px; border: 1px solid var(--border);">10</span>
      </label>
      <input type="range" class="lang-age styled-slider" min="0" max="100" value="10" oninput="document.getElementById('lang-age-val-${langBlockCounter}').textContent = this.value">
    </div>

    <div style="margin-bottom: 24px; display: flex; flex-direction: column;">
      <label style="font-weight: bold; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span>רמת שליטה (1-10):</span>
        <span id="lang-prof-val-${langBlockCounter}" style="color: var(--accent); font-size: 1.3rem; font-weight: 800; background: rgba(0,0,0,0.2); padding: 4px 16px; border-radius: 8px; border: 1px solid var(--border);">5</span>
      </label>
      <input type="range" class="lang-prof styled-slider" min="1" max="10" value="5" oninput="document.getElementById('lang-prof-val-${langBlockCounter}').textContent = this.value">
    </div>

    <div style="margin-bottom: 12px; display: flex; flex-direction: column;">
      <label style="font-weight: bold; margin-bottom: 4px;">באיזו תדירות אתה משתמש בשפה זו ביומיום?</label>
      <div class="freq-grid">
        <label class="btn-radio">
          <input type="radio" name="lang-freq-${langBlockCounter}" value="בכלל לא" required>
          <span>בכלל לא</span>
        </label>
        <label class="btn-radio">
          <input type="radio" name="lang-freq-${langBlockCounter}" value="לעתים רחוקות" required>
          <span>לעתים רחוקות</span>
        </label>
        <label class="btn-radio">
          <input type="radio" name="lang-freq-${langBlockCounter}" value="מדי כמה ימים" required>
          <span>מדי כמה ימים</span>
        </label>
        <label class="btn-radio">
          <input type="radio" name="lang-freq-${langBlockCounter}" value="כל יום" required>
          <span>כל יום</span>
        </label>
      </div>
    </div>
  `;
  container.appendChild(div);
}

function submitDemographics(event) {
  event.preventDefault();
  
  STATE.age = parseInt(document.getElementById('demo-age').value, 10);
  STATE.gender = document.querySelector('input[name="demo-gender"]:checked')?.value;
  STATE.gender_other = document.getElementById('demo-gender-other').value || null;
  STATE.education_years = document.getElementById('demo-education').value;
  STATE.mother_tongue = document.getElementById('demo-mother-tongue').value;
  STATE.has_add_lang = document.querySelector('input[name="demo-has-add-lang"]:checked')?.value;
  
  if (STATE.has_add_lang === 'כן') {
    const blocks = document.querySelectorAll('.lang-block');
    const langs = [];
    blocks.forEach(b => {
      const name = b.querySelector('.lang-name').value;
      const age = b.querySelector('.lang-age').value;
      const prof = b.querySelector('.lang-prof').value;
      const freqInput = b.querySelector(`input[type="radio"]:checked`);
      const freq = freqInput ? freqInput.value : '';
      if (name.trim()) langs.push(`${name} (Age:${age}, Prof:${prof}, Freq:${freq})`);
    });
    STATE.additional_languages_data = langs.join(' | ');
  } else {
    STATE.additional_languages_data = null;
  }
  
  showScreen('screen-onboarding');
}

function startPractice() {
  STATE.currentBlock = 'practice';
  STATE.trialQueue = generateTrials(CONFIG.PRACTICE_TRIALS, true);
  STATE.currentTrialIndex = 0;
  STATE.totalInBlock = STATE.trialQueue.length;
  DOM.phaseLabel().textContent = 'תרגול';
  showScreen('screen-trial');
  setTimeout(() => runNextTrial(), 300);
}

function startMain() {
  STATE.currentBlock = 'main';
  STATE.trialQueue = generateTrials(CONFIG.MAIN_TRIALS, false);
  STATE.currentTrialIndex = 0;
  STATE.totalInBlock = STATE.trialQueue.length;
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

  // Cancel any leftover timer from previous trial
  clearTrialTimeout();
  stopCountdownBar();

  // Update header
  const idx = STATE.currentTrialIndex + 1;
  const total = STATE.totalInBlock;
  DOM.trialCounter().textContent = `ניסיון ${idx} מתוך ${total}`;
  DOM.progressBar().style.width = `${((idx - 1) / total) * 100}%`;

  // Lock buttons during fixation
  lockButtons();
  setHidden(DOM.stimulus(), true);
  setHidden(DOM.feedback(), true);
  setHidden(DOM.fixation(), false);
  DOM.fixation().classList.add('hidden');

  // Pre-fixation delay
  setTimeout(() => {
    setHidden(DOM.fixation(), false);

    // Fixation duration
    setTimeout(() => {
      setHidden(DOM.fixation(), true);

      // Post-fixation clear screen
      setTimeout(() => {
        showStimulus();
      }, CONFIG.POST_FIXATION_MS);

    }, CONFIG.FIXATION_DURATION_MS);
  }, CONFIG.PRE_FIXATION_MS);
}

function showStimulus() {
  const trial = STATE.trialQueue[STATE.currentTrialIndex];
  const stimEl = DOM.stimulus();

  setHidden(DOM.fixation(), true);
  stimEl.textContent = trial.word;
  stimEl.style.color = trial.inkColor;
  setHidden(stimEl, false);

  // Unlock buttons, record high-precision onset, start countdown
  unlockButtons();
  STATE.stimulusOnset = performance.now();
  STATE.awaitingResponse = true;

  startCountdownBar();
  STATE.timeoutId = setTimeout(() => handleTimeout(), CONFIG.RESPONSE_TIMEOUT_MS);
}

/**
 * Handle a mouse-click response.
 * @param {string} respondedColorName  - The Hebrew color name of the clicked button
 */
function handleResponse(respondedColorName) {
  if (!STATE.awaitingResponse) return;
  STATE.awaitingResponse = false;
  lockButtons();

  // Cancel the timeout — user responded in time
  clearTrialTimeout();
  stopCountdownBar();

  const rt = performance.now() - STATE.stimulusOnset;
  const trial = STATE.trialQueue[STATE.currentTrialIndex];
  const isCorrect = respondedColorName === trial.inkColorName;

  // Build trial data record
  const record = {
    participant_id:       STATE.participantId,
    age:                  STATE.age,
    gender:               STATE.gender,
    gender_other:         STATE.gender_other,
    education_years:      STATE.education_years,
    mother_tongue:        STATE.mother_tongue,
    has_add_lang:         STATE.has_add_lang,
    additional_languages_data: STATE.additional_languages_data,
    is_practice:          trial.isPractice,
    trial_number:         STATE.trials.length + 1,
    block_trial_number:   STATE.currentTrialIndex + 1,
    condition:            trial.condition,
    displayed_word:       trial.word,
    ink_color:            trial.inkColorName,
    user_input:           respondedColorName,
    input_method:         'mouse',
    accuracy:             isCorrect,
    rt_ms:                Math.round(rt * 100) / 100,
    timestamp_iso:        new Date().toISOString(),
  };

  STATE.trials.push(record);
  validateDataIntegrity(record);

  // Hide stimulus
  setHidden(DOM.stimulus(), true);

  showFeedback(isCorrect);
}

function showFeedback(correct) {
  const fbEl = DOM.feedback();
  fbEl.textContent = correct ? 'נכון' : 'טעות';
  fbEl.className = 'feedback ' + (correct ? 'correct' : 'incorrect');
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

/** Called when the participant does not respond within RESPONSE_TIMEOUT_MS */
function handleTimeout() {
  if (!STATE.awaitingResponse) return;   // already handled (race-condition guard)
  STATE.awaitingResponse = false;
  STATE.timeoutId = null;
  lockButtons();
  stopCountdownBar();

  const trial = STATE.trialQueue[STATE.currentTrialIndex];

  // Record timeout trial — rt_ms is null (missing), user_input = 'timeout'
  const record = {
    participant_id:       STATE.participantId,
    age:                  STATE.age,
    gender:               STATE.gender,
    gender_other:         STATE.gender_other,
    education_years:      STATE.education_years,
    mother_tongue:        STATE.mother_tongue,
    has_add_lang:         STATE.has_add_lang,
    additional_languages_data: STATE.additional_languages_data,
    is_practice:          trial.isPractice,
    trial_number:         STATE.trials.length + 1,
    block_trial_number:   STATE.currentTrialIndex + 1,
    condition:            trial.condition,
    displayed_word:       trial.word,
    ink_color:            trial.inkColorName,
    user_input:           'timeout',
    input_method:         'timeout',
    accuracy:             false,
    rt_ms:                null,
    timestamp_iso:        new Date().toISOString(),
  };

  STATE.trials.push(record);

  // Hide stimulus
  setHidden(DOM.stimulus(), true);

  // Show timeout feedback
  const fbEl = DOM.feedback();
  fbEl.textContent = 'הזמן עבר';
  fbEl.className = 'feedback timeout';
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
  // Flag suspicious RT or missing values
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

  // Show saving indicator immediately
  DOM.dataStatusIcon().textContent = '⏳';
  DOM.dataStatusMsg().textContent = 'שומר נתונים...';

  // Submit data to server
  submitData();
}

// ══════════════════════════════════════════
//  DATA SUBMISSION (server-side persistence)
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
    // Store locally as fallback
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
  // Set session ID display
  const sidEl = document.getElementById('session-id-display');
  if (sidEl) sidEl.textContent = STATE.participantId;

  // Wire up color-button click handlers
  document.querySelectorAll('#response-buttons .color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      handleResponse(btn.dataset.color);
    });
  });

  showScreen('screen-intro');
  console.log(`[STROOP] Session started. ID: ${STATE.participantId}`);
})();
