/* ─────────────────────────────────────────
   STROOP TASK — EXPRESS SERVER
   - Serves static files
   - POST /api/submit                  : appends participant data to data/results.csv
   - GET  /analytics                   : research analytics dashboard
   - GET  /analytics/download          : serves the CSV by mode (organic|acme|testing)
   - GET  /analytics/download-psytoolkit : ZIP in PsyToolkit-compatible format
───────────────────────────────────────── */

'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const AdmZip   = require('adm-zip');

const app  = express();
const PORT = process.env.PORT || 3000;

const ADMIN_KEY = process.env.ADMIN_KEY || 'stroop_admin_2024';

const DATA_DIR  = path.join(__dirname, 'data');
const CSV_FILE  = path.join(DATA_DIR, 'results.csv');

const CSV_HEADERS = [
  'participant_id','age','gender','gender_other','education_years',
  'mother_tongue','has_add_lang','additional_languages_data',
  'is_task','trial_number','block_trial_number','condition',
  'displayed_word','ink_color','user_input','input_method',
  'accuracy','rt_ms','timestamp_iso',
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function csvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

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

function generateAcmeTrials() {
  const words = ['אדום', 'כחול', 'ירוק', 'צהוב'];
  const pCount = 48;
  const trials = [];

  const genders = ['נקבה', 'נקבה', 'זכר', 'זכר', 'זכר', 'נקבה', 'אחר'];
  const edus = ['תואר אקדמי ראשון', 'השכלה תיכונית עם תעודת בגרות מלאה', 'תואר אקדמי שני ומעלה', 'השכלה על-תיכונית'];
  const tongues = ['עברית', 'עברית', 'עברית', 'עברית', 'ערבית', 'רוסית', 'אנגלית'];

  let seed = 42;
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
  function rndInt(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
  function sample(arr) { return arr[Math.floor(rnd() * arr.length)]; }

  for (let i = 1; i <= pCount; i++) {
    const pid = `ACME-P${String(i).padStart(2, '0')}`;
    const age = rndInt(19, 62);
    const gender = sample(genders);
    const edu = sample(edus);
    const tongue = sample(tongues);
    const hasAdd = tongue === 'עברית' ? (rnd() > 0.3 ? 'כן' : 'לא') : 'כן';
    const addLangData = hasAdd === 'כן' ? (tongue === 'עברית' ? 'אנגלית (Prof: 7/10)' : 'עברית (Prof: 9/10)') : '';
    const baseFactor = 0.85 + rnd() * 0.3;

    for (let pt = 1; pt <= 6; pt++) {
      const isCong = pt % 2 === 1;
      const w = sample(words);
      const ink = isCong ? w : sample(words.filter(x => x !== w));
      const isAcc = rnd() > 0.15;
      const rt = Math.round((isCong ? 3800 : 4500) * baseFactor + rnd() * 800);
      trials.push({
        participant_id: pid, age, gender, education_years: edu, mother_tongue: tongue,
        has_add_lang: hasAdd, additional_languages_data: addLangData,
        is_task: false, trial_number: pt, block_trial_number: pt,
        condition: isCong ? 'congruent' : 'incongruent',
        displayed_word: w, ink_color: ink,
        user_input: isAcc ? ink : sample(words.filter(x => x !== ink)),
        accuracy: isAcc, rt_ms: rt,
        timestamp_iso: new Date(1784900000000 + i * 3600000 + pt * 5000).toISOString()
      });
    }

    const conditions = [];
    for (let c = 0; c < 30; c++) conditions.push('congruent');
    for (let inc = 0; inc < 30; inc++) conditions.push('incongruent');
    for (let s = conditions.length - 1; s > 0; s--) {
      const j = Math.floor(rnd() * (s + 1));
      [conditions[s], conditions[j]] = [conditions[j], conditions[s]];
    }

    conditions.forEach((cond, idx) => {
      const isCong = cond === 'congruent';
      const w = sample(words);
      const ink = isCong ? w : sample(words.filter(x => x !== w));
      const isTimeout = rnd() < 0.01;
      const isCorrect = !isTimeout && (rnd() < (isCong ? 0.975 : 0.94));
      const baseRt = isCong ? 612 : 738;
      const fatigue = idx * 0.6;
      const noise = (rnd() - 0.5) * 160;
      const rt = isTimeout ? 2000 : Math.round(Math.max(380, (baseRt + fatigue + noise) * baseFactor));

      trials.push({
        participant_id: pid, age, gender, education_years: edu, mother_tongue: tongue,
        has_add_lang: hasAdd, additional_languages_data: addLangData,
        is_task: true, trial_number: idx + 1, block_trial_number: idx + 1,
        condition: cond, displayed_word: w, ink_color: ink,
        user_input: isTimeout ? 'timeout' : (isCorrect ? ink : sample(words.filter(x => x !== ink))),
        accuracy: isCorrect, rt_ms: isTimeout ? null : rt,
        timestamp_iso: new Date(1784900000000 + i * 3600000 + 60000 + idx * 2500).toISOString()
      });
    });
  }

  return trials;
}

function getLocalDatasetByMode(key) {
  const mode = key === 'acme' ? 'acme' : (key === 'testing' || key === ADMIN_KEY) ? 'testing' : 'organic';
  if (mode === 'acme') return { mode, trials: generateAcmeTrials() };

  let trials = [];
  try {
    const raw = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length > 1) {
      const headers = parseCSVLine(lines[0].replace(/^\uFEFF/, ''));
      trials = lines.slice(1).map(line => {
        const vals = parseCSVLine(line);
        const obj  = {};
        headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim(); });
        return obj;
      });
    }
  } catch (_) {}

  if (mode === 'testing') return { mode, trials };

  const organic = trials.filter(t => {
    const pid = String(t.participant_id || '').toUpperCase();
    return !pid.startsWith('TEST') && !pid.includes('LIVE-DOMAIN');
  });

  return { mode, trials: organic };
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.post('/api/submit', (req, res) => {
  const { trials } = req.body;
  if (!Array.isArray(trials) || trials.length === 0) {
    return res.status(400).json({ ok: false, error: 'No trial data provided.' });
  }

  ensureDataDir();

  const fileExists = fs.existsSync(CSV_FILE);
  const rows = [];

  if (!fileExists) {
    rows.push('\uFEFF' + CSV_HEADERS.join(','));
  }

  trials.forEach(t => {
    const line = CSV_HEADERS.map(h => csvCell(t[h])).join(',');
    rows.push(line);
  });

  fs.appendFile(CSV_FILE, rows.join('\r\n') + '\r\n', 'utf8', err => {
    if (err) {
      console.error('[SUBMIT ERROR]', err);
      return res.status(500).json({ ok: false, error: 'Failed to write data.' });
    }
    console.log(`[SUBMIT SUCCESS] Saved ${trials.length} trials (Total now in file).`);
    res.json({ ok: true, saved: trials.length });
  });
});

app.get(['/analytics', '/admin'], (req, res) => {
  const { mode, trials } = getLocalDatasetByMode(req.query.key);
  res.send(analyticsHtml(mode, trials));
});

app.get(['/analytics/download', '/admin/download'], (req, res) => {
  const { mode, trials } = getLocalDatasetByMode(req.query.key);
  const rows = trials.map(t => CSV_HEADERS.map(h => csvCell(t[h])).join(',')).join('\r\n');
  const csv  = '\uFEFF' + CSV_HEADERS.join(',') + '\r\n' + rows + '\r\n';
  const filename = `stroop_results_${mode}_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

app.get(['/analytics/download-psytoolkit', '/admin/download-psytoolkit'], (req, res) => {
  const { mode, trials } = getLocalDatasetByMode(req.query.key);
  const byPid = {};
  trials.forEach(t => { const p = t.participant_id || 'unknown'; (byPid[p] = byPid[p] || []).push(t); });

  function toPsyRow(t) {
    const b = (t.is_task === true || t.is_task === 'true') ? 2 : 1;
    const c = t.condition === 'congruent' ? 1 : 2;
    const s = t.user_input === 'timeout' ? 3 : (t.accuracy === true || t.accuracy === 'true') ? 1 : 2;
    const r = t.rt_ms != null && t.rt_ms !== 'null' ? Math.round(parseFloat(t.rt_ms)) : 0;
    return `${b} ${c} ${s} ${r}`;
  }

  function escVal(v) {
    if (!v) return '';
    v = String(v);
    return (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  const hdrs = ['participant','start_time','end_time','age','gender','gender_other','education_years','mother_tongue','has_add_lang','additional_languages_data','stroop'];
  const rows = Object.entries(byPid).map(([p, pts]) => [
    escVal(p),
    escVal(pts[0].timestamp_iso || ''),
    escVal(pts[pts.length - 1].timestamp_iso || ''),
    escVal(String(pts[0].age || '')),
    escVal(pts[0].gender || ''),
    escVal(pts[0].gender_other || ''),
    escVal(String(pts[0].education_years || '')),
    escVal(pts[0].mother_tongue || ''),
    escVal(pts[0].has_add_lang || ''),
    escVal(pts[0].additional_languages_data || ''),
    escVal(`${p}.txt`)
  ].join(','));

  const csvContent = [hdrs.join(','), ...rows].join('\r\n') + '\r\n';
  const zipName = `psytoolkit_stroop_${mode}_${new Date().toISOString().slice(0, 10)}.zip`;

  try {
    const zip = new AdmZip();
    zip.addFile('data.csv', Buffer.from(csvContent, 'utf8'));
    Object.entries(byPid).forEach(([p, pts]) => {
      zip.addFile(`stroop/${p}.txt`, Buffer.from(pts.map(toPsyRow).join('\n') + '\n', 'utf8'));
    });

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('[PSYTOOLKIT ZIP ERROR]', err);
    res.status(500).send('Error building ZIP.');
  }
});

function analyticsHtml(mode, trials) {
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

  const modeTitle = mode === 'acme' ? '🔬 ACME Benchmark Simulation (N=48)' : mode === 'testing' ? '🛠️ Developer Testing Runs' : '🌐 Organic Audience Data';
  const modeDesc  = mode === 'acme' ? 'Pre-seeded realistic Stroop Effect literature simulation modeling published benchmark metrics' : mode === 'testing' ? 'Contains all developer testing & verification sessions' : 'Live participant submissions collected from organic experiment traffic';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Stroop Research Analytics — ${modeTitle}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e8eaf0;padding:32px 20px;line-height:1.5}
    .wrap{max-width:1100px;margin:0 auto}
    .header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:24px}
    h1{font-size:1.8rem;font-weight:800;background:linear-gradient(135deg,#e8eaf0,#7c9ef5);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}
    .sub{color:#8b8fa8;font-size:.9rem}
    .dl-btns{display:flex;gap:12px;flex-wrap:wrap}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:50px;font-size:.92rem;font-weight:700;text-decoration:none;transition:transform .15s}
    .btn-blue{background:linear-gradient(135deg,#5a7de0,#7c9ef5);color:#fff;box-shadow:0 4px 20px rgba(124,158,245,.3)}
    .btn-green{background:linear-gradient(135deg,#2db87a,#1a9e65);color:#fff;box-shadow:0 4px 20px rgba(45,184,122,.3)}
    .btn:hover{transform:translateY(-2px)}
    
    .tabs-bar{display:flex;background:#161b27;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:6px;gap:6px;margin-bottom:28px;overflow-x:auto}
    .tab-btn{flex:1;min-width:180px;text-align:center;padding:10px 16px;border-radius:10px;font-size:.88rem;font-weight:600;color:#8b8fa8;text-decoration:none;transition:all .2s;white-space:nowrap}
    .tab-btn:hover{color:#e8eaf0;background:rgba(255,255,255,.04)}
    .tab-btn.active{background:linear-gradient(135deg,#5a7de0,#7c9ef5);color:#fff;box-shadow:0 4px 16px rgba(124,158,245,.3)}

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
        <p class="sub">${modeDesc}</p>
      </div>
      <div class="dl-btns">
        <a class="btn btn-blue" href="/analytics/download?key=${mode}">⬇ Full CSV (${totalReal})</a>
        <a class="btn btn-green" href="/analytics/download-psytoolkit?key=${mode}">🧪 PsyToolkit ZIP</a>
      </div>
    </div>

    <!-- Dataset Selector Bar -->
    <div class="tabs-bar">
      <a class="tab-btn ${mode === 'organic' ? 'active' : ''}" href="/analytics?key=organic">🌐 Organic Audience Data</a>
      <a class="tab-btn ${mode === 'acme' ? 'active' : ''}" href="/analytics?key=acme">🔬 ACME Research Benchmark (N=48 Simulation)</a>
      <a class="tab-btn ${mode === 'testing' ? 'active' : ''}" href="/analytics?key=testing">🛠️ Developer Testing Runs</a>
    </div>

    <div class="kpi-grid">
      <div class="card"><div class="card-title">Real Task Trials</div><div class="card-val">${totalReal.toLocaleString()}</div><div class="card-sub">Completed trials</div></div>
      <div class="card"><div class="card-title">Participants</div><div class="card-val">${totalP}</div><div class="card-sub">Unique session IDs</div></div>
      <div class="card"><div class="card-title">Avg Stroop Effect</div><div class="card-val purple">${avgStroop > 0 ? '+' : ''}${avgStroop} ms</div><div class="card-sub">Incongruent – Congruent RT</div></div>
      <div class="card"><div class="card-title">Overall Accuracy</div><div class="card-val green">${overallAcc}%</div><div class="card-sub">Precision rate</div></div>
    </div>

    ${latest ? `
    <div class="insights-card">
      <span class="badge-tag">${mode === 'acme' ? 'BENCHMARK MODEL' : 'ACTIVE SESSION'} · ${latest.pid}</span>
      <div class="insights-title">🔍 Cognitive & Demographic Profile: <code>${latest.pid}</code></div>
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
          • <strong>Stroop Effect: <span style="color:#a78bfa">+${latest.effect} ms</span></strong> (Interference Delta)
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

    <div class="section-title">👥 Participant Performance Summary (${pSummaries.length})</div>
    <table>
      <thead>
        <tr><th>ID</th><th>Age / Gender</th><th>Education</th><th>Trials</th><th>Congruent RT</th><th>Incongruent RT</th><th>Stroop Effect</th><th>Accuracy</th></tr>
      </thead>
      <tbody>
        ${pSummaries.slice(0, 50).map(p => `<tr><td><code>${p.pid}</code></td><td>${p.age} / ${p.gender}</td><td>${p.edu}</td><td>${p.totalReal}</td><td>${p.cRt} ms</td><td>${p.iRt} ms</td><td><strong style="color:${p.effect > 0 ? '#a78bfa' : '#52b46b'}">${p.effect > 0 ? '+' : ''}${p.effect} ms</strong></td><td><span class="badge-ok">${p.acc}%</span></td></tr>`).join('')}
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

app.listen(PORT, () => {
  console.log(`\n🧠 Stroop Task server running`);
  console.log(`   App       → http://localhost:${PORT}`);
  console.log(`   Analytics → http://localhost:${PORT}/analytics\n`);
});
