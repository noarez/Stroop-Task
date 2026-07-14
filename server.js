/* ─────────────────────────────────────────
   STROOP TASK — EXPRESS SERVER
   - Serves static files
   - POST /api/submit  : appends participant data to data/results.csv
   - GET  /admin       : password-protected admin dashboard
   - GET  /admin/download : serves the full CSV to the researcher
───────────────────────────────────────── */

'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');

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
  'add_lang_count',
  'add_lang_name',
  'add_lang_age',
  'add_lang_prof',
  'add_lang_freq',
  'is_practice',
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

  // Parse the CSV to get stats
  let totalRows = 0, participants = new Set(), lastLines = [];
  try {
    const raw = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = raw.split('\r\n').filter(l => l.trim());
    totalRows = Math.max(0, lines.length - 1);   // subtract header
    lines.slice(1).forEach(line => {
      const pid = line.split(',')[0].replace(/"/g, '');
      if (pid) participants.add(pid);
    });
    lastLines = lines.slice(-6).reverse();        // last 5 data rows + header
  } catch (_) {}

  res.send(adminPage({
    key: ADMIN_KEY,
    totalRows,
    participants: participants.size,
    lastLines,
  }));
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
//  HTML page builders
// ─────────────────────────────────────────────────────────────────────────────

function adminDeniedPage() {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:80px">
    <h1 style="color:#e05252">403 — Unauthorized</h1>
    <p>Admin key required. Add <code>?key=YOUR_KEY</code> to the URL.</p>
  </body></html>`;
}

function adminPage({ key, totalRows, participants, lastLines }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Stroop Admin</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e8eaf0;min-height:100vh;padding:40px 24px}
    .wrap{max-width:860px;margin:0 auto}
    h1{font-size:1.8rem;font-weight:800;background:linear-gradient(135deg,#e8eaf0,#6b8aff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:6px}
    .sub{color:#8b8fa8;font-size:.9rem;margin-bottom:36px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:36px}
    .stat{background:#1a1d26;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:24px;text-align:center}
    .stat-val{font-size:2.4rem;font-weight:800;color:#6b8aff}
    .stat-lbl{font-size:.8rem;color:#8b8fa8;margin-top:4px}
    .dl-btn{display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#6b8aff,#8b5cf6);color:#fff;border:none;border-radius:50px;padding:14px 32px;font-size:1.05rem;font-weight:700;cursor:pointer;text-decoration:none;margin-bottom:36px;transition:transform .15s,box-shadow .15s;box-shadow:0 4px 24px rgba(107,138,255,.35)}
    .dl-btn:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(107,138,255,.5)}
    table{width:100%;border-collapse:collapse;background:#1a1d26;border-radius:14px;overflow:hidden;font-size:.82rem}
    th{background:#20232f;color:#8b8fa8;font-weight:600;padding:10px 14px;text-align:left}
    td{padding:9px 14px;border-top:1px solid rgba(255,255,255,.05);color:#c5c8d8;font-family:'Courier New',monospace}
    .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:700}
    .badge-ok{background:rgba(82,180,107,.15);color:#52b46b;border:1px solid rgba(82,180,107,.3)}
    .badge-err{background:rgba(224,82,82,.15);color:#e05252;border:1px solid rgba(224,82,82,.3)}
    .warn{background:rgba(201,176,32,.08);border:1px solid rgba(201,176,32,.25);border-radius:10px;padding:12px 16px;color:#c9b020;font-size:.85rem;margin-bottom:24px}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>🧠 Stroop Admin Panel</h1>
    <p class="sub">Researcher-only view — keep this URL private</p>

    ${totalRows === 0 ? `<div class="warn">⚠️ No data collected yet. The results file exists but contains no trial rows.</div>` : ''}

    <div class="grid">
      <div class="stat">
        <div class="stat-val">${totalRows.toLocaleString()}</div>
        <div class="stat-lbl">Total trial rows</div>
      </div>
      <div class="stat">
        <div class="stat-val">${participants}</div>
        <div class="stat-lbl">Unique participants</div>
      </div>
    </div>

    <a class="dl-btn" href="/admin/download?key=${key}">
      ⬇ Download Full CSV (${totalRows} rows)
    </a>

    <h2 style="font-size:1rem;color:#8b8fa8;margin-bottom:12px;font-weight:600">LAST SUBMISSIONS</h2>
    <table>
      <tr>
        <th>Participant ID</th>
        <th>Trial #</th>
        <th>Condition</th>
        <th>Word</th>
        <th>Ink</th>
        <th>Response</th>
        <th>Accurate</th>
        <th>RT (ms)</th>
      </tr>
      ${lastLines.slice(0, 5).map(row => {
        const c = row.split(',');
        const acc = c[9] === 'true';
        return `<tr>
          <td>${c[0]||''}</td>
          <td>${c[2]||''}</td>
          <td>${c[4]||''}</td>
          <td>${c[5]||''}</td>
          <td>${c[6]||''}</td>
          <td>${c[7]||''}</td>
          <td><span class="badge ${acc?'badge-ok':'badge-err'}">${acc?'✓':'✗'}</span></td>
          <td>${c[10]||''}</td>
        </tr>`;
      }).join('')}
    </table>
  </div>
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
