/* ─────────────────────────────────────────
   STROOP TASK — EXPRESS SERVER
   - Serves static files
   - POST /api/submit              : appends participant data to data/results.csv
   - GET  /admin                   : password-protected admin dashboard
   - GET  /admin/download          : serves the full CSV to the researcher
   - GET  /admin/download-psytoolkit : ZIP in PsyToolkit-compatible format
───────────────────────────────────────── */

'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const AdmZip = require('adm-zip');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Admin secret key ──────────────────────────────────────────────────────────
// Change this before deploying, or set ADMIN_KEY as an environment variable!
const ADMIN_KEY = process.env.ADMIN_KEY || 'stroop_admin_2024';

// ── Paths ─────────────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const CSV_FILE  = path.join(DATA_DIR, 'results.csv');

// ── CSV column order (must match app.js) ─────────────────────────────────────
const CSV_HEADERS = [
  'participant_id',
  'age',
  'gender',
  'gender_other',
  'education_years',
  'mother_tongue',
  'has_add_lang',
  'additional_languages_data',
  'is_task',
  'trial_number',
  'block_trial_number',
  'condition',
  'displayed_word',
  'ink_color',
  'user_input',
  'input_method',
  'accuracy',
  'rt_ms',
  'timestamp_iso',
];

// ── Ensure data directory and CSV header row exist ────────────────────────────
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CSV_FILE)) {
  // UTF-8 BOM so Excel opens Hebrew text correctly
  fs.writeFileSync(CSV_FILE, '\uFEFF' + CSV_HEADERS.join(',') + '\r\n', 'utf8');
  console.log('[CSV] Created new results file:', CSV_FILE);
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));   // serves index.html, app.js, style.css

// ── Helper: escape a CSV cell ─────────────────────────────────────────────────
function csvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/submit
//  Body: { trials: [ { participant_id, is_practice, ... }, ... ] }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/submit', (req, res) => {
  try {
    const { trials } = req.body;

    if (!Array.isArray(trials) || trials.length === 0) {
      return res.status(400).json({ ok: false, error: 'No trial data provided.' });
    }

    // Build CSV rows
    const rows = trials.map(t =>
      CSV_HEADERS.map(h => csvCell(t[h])).join(',')
    ).join('\r\n');

    fs.appendFileSync(CSV_FILE, rows + '\r\n', 'utf8');

    console.log(`[SUBMIT] +${trials.length} trials from ${trials[0]?.participant_id}`);
    res.json({ ok: true, saved: trials.length });
  } catch (err) {
    console.error('[SUBMIT ERROR]', err);
    res.status(500).json({ ok: false, error: 'Server error saving data.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /admin?key=...
//  Admin dashboard — shows row count, last submissions, download link
// ─────────────────────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).send(adminDeniedPage());
  }

  let trials = [];
  try {
    const raw = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length > 1) {
      const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      trials = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      });
    }
  } catch (_) {}

  res.send(adminPage(ADMIN_KEY, trials));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /admin/download?key=...
//  Streams the full CSV to the researcher's browser
// ─────────────────────────────────────────────────────────────────────────────
app.get('/admin/download', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).send('Unauthorized.');
  }
  const filename = `stroop_results_${new Date().toISOString().slice(0, 10)}.csv`;
  res.download(CSV_FILE, filename, err => {
    if (err) console.error('[DOWNLOAD ERROR]', err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /admin/download-psytoolkit?key=...
//  Generates a ZIP file that mirrors PsyToolkit's survey+experiment export:
//
//  psytoolkit_stroop_YYYY-MM-DD.zip
//  ├── data.csv              ← one row per participant (demographics)
//  └── stroop/
//      ├── <participant_id>.txt   ← space-separated trial rows per participant
//      └── ...
//
//  Per-participant .txt format (4 space-separated columns):
//    col1: block_type  (1=practice, 2=real)
//    col2: condition   (1=congruent, 2=incongruent)
//    col3: STATUS      (1=correct, 2=wrong, 3=timeout)
//    col4: RT          (integer ms; 0 on timeout)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/admin/download-psytoolkit', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).send('Unauthorized.');
  }

  // ── Parse the CSV into trial records ────────────────────────────────────
  // Proper RFC-4180-aware CSV parser (handles commas inside quoted fields)
  function parseCSVLine(line) {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"')                    { inQ = false; }
        else                                    { cur += ch; }
      } else {
        if (ch === '"')  { inQ = true; }
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else               { cur += ch; }
      }
    }
    fields.push(cur);
    return fields;
  }

  let trials = [];
  try {
    const raw   = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      return res.status(404).send('No data yet.');
    }
    const headers = parseCSVLine(lines[0].replace(/^\uFEFF/, ''));
    trials = lines.slice(1).map(line => {
      const vals = parseCSVLine(line);
      const obj  = {};
      headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim(); });
      return obj;
    });
  } catch (err) {
    console.error('[PSYTOOLKIT DL] CSV read error:', err);
    return res.status(500).send('Error reading data.');
  }

  // ── Group trials by participant_id ───────────────────────────────────────
  const byParticipant = {};
  trials.forEach(t => {
    const pid = t.participant_id || 'unknown';
    if (!byParticipant[pid]) byParticipant[pid] = [];
    byParticipant[pid].push(t);
  });

  // ── Helper: map one trial row → PsyToolkit space-separated string ────────
  function toPsyRow(t) {
    const blockType = t.is_task === 'true' ? 2 : 1;
    const condition = t.condition === 'congruent' ? 1 : 2;
    const status    = t.user_input === 'timeout' ? 3
                    : t.accuracy === 'true'      ? 1 : 2;
    const rt        = t.rt_ms && t.rt_ms !== 'null'
                    ? Math.round(parseFloat(t.rt_ms))
                    : 0;
    return `${blockType} ${condition} ${status} ${rt}`;
  }

  // ── Build data.csv content (demographics, one row per participant) ────────
  const surveyHeaders = [
    'participant', 'start_time', 'end_time',
    'age', 'gender', 'gender_other', 'education_years',
    'mother_tongue', 'has_add_lang', 'additional_languages_data',
    'stroop',
  ];

  const surveyRows = Object.entries(byParticipant).map(([pid, pts]) => {
    const first = pts[0];
    const last  = pts[pts.length - 1];
    const esc   = v => (v && (v.includes(',') || v.includes('"')))
                     ? `"${v.replace(/"/g, '""')}"`
                     : (v || '');
    return [
      esc(pid),
      esc(first.timestamp_iso || ''),
      esc(last.timestamp_iso  || ''),
      esc(first.age           || ''),
      esc(first.gender        || ''),
      esc(first.gender_other  || ''),
      esc(first.education_years || ''),
      esc(first.mother_tongue   || ''),
      esc(first.has_add_lang    || ''),
      esc(first.additional_languages_data || ''),
      esc(`${pid}.txt`),
    ].join(',');
  });

  const dataCsvContent = [surveyHeaders.join(','), ...surveyRows].join('\r\n') + '\r\n';

  // ── Build and send ZIP ─────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  const zipName = `psytoolkit_stroop_${dateStr}.zip`;

  try {
    const zip = new AdmZip();

    // data.csv
    zip.addFile('data.csv', Buffer.from(dataCsvContent, 'utf8'));

    // stroop/<pid>.txt — one file per participant
    Object.entries(byParticipant).forEach(([pid, pts]) => {
      const rows = pts.map(toPsyRow).join('\n') + '\n';
      zip.addFile(`stroop/${pid}.txt`, Buffer.from(rows, 'utf8'));
    });

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);

    console.log(`[PSYTOOLKIT] ZIP sent: ${zipName} (${Object.keys(byParticipant).length} participants)`);
  } catch (err) {
    console.error('[PSYTOOLKIT ZIP ERROR]', err);
    res.status(500).send('Error building ZIP.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  HTML page builders
// ─────────────────────────────────────────────────────────────────────────────

function adminDeniedPage() {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:80px">
    <h1 style="color:#e05252">403 — Unauthorized</h1>
    <p>Admin key required. Add <code>?key=YOUR_KEY</code> to the URL.</p>
  </body></html>`;
}

function adminPage(key, trials) {
  const all = (trials || []).map(t => ({
    pid: t.participant_id,
    age: t.age,
    gender: t.gender,
    edu: t.education_years,
    tongue: t.mother_tongue,
    addLang: t.additional_languages_data || t.has_add_lang,
    is_task: t.is_task === true || t.is_task === 'true',
    trial_num: t.trial_number || t.block_trial_number,
    condition: t.condition,
    word: t.displayed_word,
    ink: t.ink_color,
    input: t.user_input,
    accuracy: t.accuracy === true || t.accuracy === 'true',
    rt: t.rt_ms != null && t.rt_ms !== 'null' ? parseFloat(t.rt_ms) : null,
    iso: t.timestamp_iso
  }));

  const pMap = {};
  all.forEach(t => {
    const p = t.pid || 'unknown';
    if (!pMap[p]) pMap[p] = { pid: p, trials: [], demo: t };
    pMap[p].trials.push(t);
  });

  const pSummaries = Object.values(pMap).map(p => {
    const real = p.trials.filter(t => t.is_task);
    const prac = p.trials.filter(t => !t.is_task);
    const cong = real.filter(t => t.condition === 'congruent' && t.accuracy && t.rt != null);
    const incong = real.filter(t => t.condition === 'incongruent' && t.accuracy && t.rt != null);

    const cRt = cong.length ? cong.reduce((s,t) => s + t.rt, 0) / cong.length : 0;
    const iRt = incong.length ? incong.reduce((s,t) => s + t.rt, 0) / incong.length : 0;
    const effect = iRt - cRt;
    const acc = real.length ? (real.filter(t => t.accuracy).length / real.length) * 100 : 0;

    const pracOk = prac.filter(t => t.accuracy && t.rt != null);
    const pRt = pracOk.length ? pracOk.reduce((s,t) => s + t.rt, 0) / pracOk.length : 0;

    return {
      pid: p.pid,
      age: p.demo.age || 'N/A',
      gender: p.demo.gender || 'N/A',
      edu: p.demo.edu || 'N/A',
      tongue: p.demo.tongue || 'N/A',
      addLang: p.demo.addLang || 'N/A',
      totalReal: real.length,
      cRt: Math.round(cRt * 10) / 10,
      iRt: Math.round(iRt * 10) / 10,
      effect: Math.round(effect * 10) / 10,
      acc: Math.round(acc * 10) / 10,
      pRt: Math.round(pRt * 10) / 10,
      realTrials: real
    };
  });

  const totalReal = pSummaries.reduce((s,p) => s + p.totalReal, 0);
  const totalP = pSummaries.length;
  const avgStroop = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.effect, 0) / totalP) * 10) / 10 : 0;
  const overallAcc = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.acc, 0) / totalP) * 10) / 10 : 0;
  const avgC = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.cRt, 0) / totalP) * 10) / 10 : 0;
  const avgI = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.iRt, 0) / totalP) * 10) / 10 : 0;

  const latest = pSummaries[pSummaries.length - 1] || null;

  const congSeries = latest ? latest.realTrials.filter(t => t.condition === 'congruent').map(t => Math.round(t.rt || 0)) : [];
  const incongSeries = latest ? latest.realTrials.filter(t => t.condition === 'incongruent').map(t => Math.round(t.rt || 0)) : [];
  const labels = Array.from({ length: Math.max(congSeries.length, incongSeries.length) }, (_, i) => i + 1);

  const recent = all.slice(-10).reverse();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Stroop Research Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e8eaf0;padding:32px 20px;line-height:1.5}
    .wrap{max-width:1100px;margin:0 auto}
    .header{display:flex;justify-space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:32px}
    h1{font-size:1.8rem;font-weight:800;background:linear-gradient(135deg,#e8eaf0,#7c9ef5);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}
    .sub{color:#8b8fa8;font-size:.9rem}
    .dl-btns{display:flex;gap:12px;flex-wrap:wrap}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:50px;font-size:.92rem;font-weight:700;text-decoration:none;transition:transform .15s}
    .btn-blue{background:linear-gradient(135deg,#5a7de0,#7c9ef5);color:#fff;box-shadow:0 4px 20px rgba(124,158,245,.3)}
    .btn-green{background:linear-gradient(135deg,#2db87a,#1a9e65);color:#fff;box-shadow:0 4px 20px rgba(45,184,122,.3)}
    .btn:hover{transform:translateY(-2px)}
    .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;margin-bottom:28px}
    .card{background:#161b27;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px}
    .card-title{font-size:.82rem;font-weight:600;color:#8b8fa8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
    .card-val{font-size:2.2rem;font-weight:800;color:#7c9ef5;line-height:1}
    .card-val.green{color:#52b46b}
    .card-val.purple{color:#a78bfa}
    .card-sub{font-size:.78rem;color:#8b8fa8;margin-top:6px}
    .insights-card{background:linear-gradient(135deg,#1c2336,#161b27);border:1px solid rgba(124,158,245,.25);border-radius:16px;padding:24px;margin-bottom:28px}
    .badge-tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:700;background:rgba(124,158,245,.15);color:#7c9ef5;border:1px solid rgba(124,158,245,.3);margin-bottom:12px}
    .insights-title{font-size:1.15rem;font-weight:700;margin-bottom:12px;color:#e9ecf4}
    .insights-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;font-size:.9rem}
    .insight-item{background:rgba(255,255,255,.03);padding:14px;border-radius:10px;border:1px solid rgba(255,255,255,.05)}
    .charts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;margin-bottom:32px}
    .chart-card{background:#161b27;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px}
    .chart-title{font-size:1rem;font-weight:700;margin-bottom:14px;color:#e8eaf0}
    .chart-container{position:relative;height:240px;width:100%}
    .section-title{font-size:1.1rem;font-weight:700;color:#e8eaf0;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;background:#161b27;border-radius:14px;overflow:hidden;font-size:.84rem;margin-bottom:32px}
    th{background:#1d2235;color:#8b8fa8;font-weight:600;padding:12px 14px;text-align:left}
    td{padding:11px 14px;border-top:1px solid rgba(255,255,255,.05);color:#c5c8d8}
    .badge-ok{background:rgba(82,180,107,.15);color:#52b46b;padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:700}
    .badge-err{background:rgba(224,82,82,.15);color:#e05252;padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:700}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <h1>🧠 Stroop Research & Cognitive Analytics</h1>
        <p class="sub">Real-time Stroop Effect calculation, participant metrics, & PsyToolkit data exports</p>
      </div>
      <div class="dl-btns">
        <a class="btn btn-blue" href="/admin/download?key=${key}">⬇ Full CSV (${totalReal})</a>
        <a class="btn btn-green" href="/admin/download-psytoolkit?key=${key}">🧪 PsyToolkit ZIP</a>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="card"><div class="card-title">Real Task Trials</div><div class="card-val">${totalReal.toLocaleString()}</div><div class="card-sub">Completed trials</div></div>
      <div class="card"><div class="card-title">Participants</div><div class="card-val">${totalP}</div><div class="card-sub">Unique session IDs</div></div>
      <div class="card"><div class="card-title">Avg Stroop Effect</div><div class="card-val purple">${avgStroop > 0 ? '+' : ''}${avgStroop} ms</div><div class="card-sub">Incongruent – Congruent RT</div></div>
      <div class="card"><div class="card-title">Overall Accuracy</div><div class="card-val green">${overallAcc}%</div><div class="card-sub">Precision rate</div></div>
    </div>

    ${latest ? `
    <div class="insights-card">
      <span class="badge-tag">VERIFIED SESSION · ${latest.pid}</span>
      <div class="insights-title">🔍 Detailed Cognitive Analysis for Session: <code>${latest.pid}</code></div>
      <div class="insights-grid">
        <div class="insight-item">
          <strong>👤 Participant Demographics:</strong><br>
          • Age: <strong>${latest.age}</strong> | Gender: <strong>${latest.gender}</strong><br>
          • Education: <strong>${latest.edu}</strong><br>
          • Native Language: <strong>${latest.tongue}</strong> | Add. Lang: <strong>${latest.addLang}</strong>
        </div>
        <div class="insight-item">
          <strong>⚡ Cognitive Performance:</strong><br>
          • Congruent Mean RT: <strong>${latest.cRt} ms</strong><br>
          • Incongruent Mean RT: <strong>${latest.iRt} ms</strong><br>
          • <strong>Stroop Effect: <span style="color:#a78bfa">+${latest.effect} ms</span></strong> (Cognitive Interference)
        </div>
        <div class="insight-item">
          <strong>🎯 Accuracy & Learning:</strong><br>
          • Accuracy: <strong>${latest.acc}%</strong> (${latest.totalReal}/${latest.totalReal} correct)<br>
          • Practice Mean RT: <strong>${latest.pRt} ms</strong><br>
          • Adaptation: <strong>${latest.pRt ? Math.round((1 - latest.cRt / latest.pRt) * 100) : 0}% speedup</strong> vs practice
        </div>
      </div>
    </div>
    ` : ''}

    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">📊 Stroop Effect Comparison (Mean RT)</div>
        <div class="chart-container"><canvas id="c1"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">📈 Trial-by-Trial Reaction Time Dynamics (ms)</div>
        <div class="chart-container"><canvas id="c2"></canvas></div>
      </div>
    </div>

    <div class="section-title">👥 Participant Performance Summary</div>
    <table>
      <thead>
        <tr><th>ID</th><th>Age / Gender</th><th>Education</th><th>Trials</th><th>Congruent RT</th><th>Incongruent RT</th><th>Stroop Effect</th><th>Accuracy</th></tr>
      </thead>
      <tbody>
        ${pSummaries.map(p => `<tr><td><code>${p.pid}</code></td><td>${p.age} / ${p.gender}</td><td>${p.edu}</td><td>${p.totalReal}</td><td>${p.cRt} ms</td><td>${p.iRt} ms</td><td><strong style="color:${p.effect > 0 ? '#a78bfa' : '#52b46b'}">${p.effect > 0 ? '+' : ''}${p.effect} ms</strong></td><td><span class="badge-ok">${p.acc}%</span></td></tr>`).join('')}
      </tbody>
    </table>

    <div class="section-title">📋 Recent Submissions</div>
    <table>
      <thead>
        <tr><th>ID</th><th>Trial#</th><th>Condition</th><th>Word</th><th>Ink</th><th>Response</th><th>Accurate</th><th>RT (ms)</th></tr>
      </thead>
      <tbody>
        ${recent.map(t => `<tr><td><code>${t.pid||''}</code></td><td>${t.trial_num||''}</td><td>${t.condition||''}</td><td>${t.word||''}</td><td>${t.ink||''}</td><td>${t.input||''}</td><td><span class="${t.accuracy?'badge-ok':'badge-err'}">${t.accuracy?'✓ Correct':'✗ Error'}</span></td><td>${t.rt ? t.rt + ' ms' : 'N/A'}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <script>
    new Chart(document.getElementById('c1'), {
      type: 'bar',
      data: {
        labels: ['Congruent', 'Incongruent'],
        datasets: [{ data: [${avgC}, ${avgI}], backgroundColor: ['rgba(124,158,245,0.8)', 'rgba(167,139,250,0.8)'], borderRadius: 8 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#8b8fa8' } }, x: { grid: { display: false }, ticks: { color: '#8b8fa8' } } } }
    });

    new Chart(document.getElementById('c2'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [
          { label: 'Congruent RT', data: ${JSON.stringify(congSeries)}, borderColor: '#7c9ef5', backgroundColor: 'rgba(124,158,245,0.1)', fill: true, tension: 0.3 },
          { label: 'Incongruent RT', data: ${JSON.stringify(incongSeries)}, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.1)', fill: true, tension: 0.3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e8eaf0' } } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#8b8fa8' } }, x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#8b8fa8' } } } }
    });
  </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🧠 Stroop Task server running`);
  console.log(`   App  → http://localhost:${PORT}`);
  console.log(`   Admin→ http://localhost:${PORT}/admin?key=${ADMIN_KEY}\n`);
});
