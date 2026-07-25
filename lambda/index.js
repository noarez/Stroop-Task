'use strict';

/**
 * STROOP TASK — AWS LAMBDA API HANDLER
 * Routes: POST /api/submit | GET /admin | GET /admin/download | GET /admin/download-psytoolkit
 * Env vars: DATA_BUCKET, ADMIN_KEY
 */

const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const AdmZip = require('adm-zip');

const s3          = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const DATA_BUCKET = process.env.DATA_BUCKET || 'stroop-task-data-462355913922';
const ADMIN_KEY   = process.env.ADMIN_KEY   || 'stroop_admin_2024';

const CSV_HEADERS = [
  'participant_id','age','gender','gender_other','education_years',
  'mother_tongue','has_add_lang','additional_languages_data',
  'is_task','trial_number','block_trial_number','condition',
  'displayed_word','ink_color','user_input','input_method',
  'accuracy','rt_ms','timestamp_iso',
];

function csvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g,'""') + '"' : s;
}

async function streamToBuffer(stream) {
  return new Promise((res, rej) => {
    const c = []; stream.on('data', d => c.push(d)); stream.on('end', () => res(Buffer.concat(c))); stream.on('error', rej);
  });
}

async function loadAllTrials() {
  const files = []; let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: DATA_BUCKET, Prefix: 'results/', ContinuationToken: token }));
    (r.Contents||[]).forEach(o => files.push(o.Key));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  const all = [];
  await Promise.all(files.map(async key => {
    try {
      const r    = await s3.send(new GetObjectCommand({ Bucket: DATA_BUCKET, Key: key }));
      const buf  = await streamToBuffer(r.Body);
      const data = JSON.parse(buf.toString('utf8'));
      if (Array.isArray(data.trials)) all.push(...data.trials);
    } catch(e) { console.warn('load fail', key, e.message); }
  }));
  return all;
}

function toPsyRow(t) {
  const b = t.is_task ? 2 : 1;
  const c = t.condition === 'congruent' ? 1 : 2;
  const s = t.user_input === 'timeout' ? 3 : t.accuracy ? 1 : 2;
  const r = t.rt_ms != null ? Math.round(t.rt_ms) : 0;
  return `${b} ${c} ${s} ${r}`;
}

function esc(v) {
  if (!v) return '';
  v = String(v);
  return (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g,'""')}"` : v;
}

async function handleSubmit(body) {
  const { trials } = typeof body === 'string' ? JSON.parse(body) : body;
  if (!Array.isArray(trials) || !trials.length)
    return { statusCode:400, body: JSON.stringify({ ok:false, error:'No trial data.' }) };
  const pid = trials[0].participant_id || `unknown-${Date.now()}`;
  const key = `results/${pid}_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  await s3.send(new PutObjectCommand({ Bucket:DATA_BUCKET, Key:key, Body:JSON.stringify({participant_id:pid,submitted_at:new Date().toISOString(),trials}), ContentType:'application/json' }));
  console.log(`[SUBMIT] +${trials.length} trials → ${key}`);
  return { statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ok:true, saved:trials.length }) };
}

async function handleAdmin(key) {
  if (key !== ADMIN_KEY) return { statusCode:403, headers:{'Content-Type':'text/html'}, body:`<h1>403 Unauthorized</h1>` };
  const trials = await loadAllTrials();
  return { statusCode:200, headers:{'Content-Type':'text/html; charset=utf-8'}, body: adminHtml(key, trials) };
}

async function handleCsv(key) {
  if (key !== ADMIN_KEY) return { statusCode:403, body:'Unauthorized.' };
  const trials = await loadAllTrials();
  const rows   = trials.map(t => CSV_HEADERS.map(h => csvCell(t[h])).join(',')).join('\r\n');
  const csv    = '\uFEFF' + CSV_HEADERS.join(',') + '\r\n' + rows + '\r\n';
  return { statusCode:200, headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="stroop_results_${new Date().toISOString().slice(0,10)}.csv"`}, body:Buffer.from(csv,'utf8').toString('base64'), isBase64Encoded:true };
}

async function handlePsyToolkit(key) {
  if (key !== ADMIN_KEY) return { statusCode:403, body:'Unauthorized.' };
  const trials = await loadAllTrials();
  const byPid  = {};
  trials.forEach(t => { const p = t.participant_id||'unknown'; (byPid[p]=byPid[p]||[]).push(t); });
  const hdrs = ['participant','start_time','end_time','age','gender','gender_other','education_years','mother_tongue','has_add_lang','additional_languages_data','stroop'];
  const rows  = Object.entries(byPid).map(([p,pts]) => [esc(p),esc(pts[0].timestamp_iso||''),esc(pts[pts.length-1].timestamp_iso||''),esc(String(pts[0].age||'')),esc(pts[0].gender||''),esc(pts[0].gender_other||''),esc(String(pts[0].education_years||'')),esc(pts[0].mother_tongue||''),esc(pts[0].has_add_lang||''),esc(pts[0].additional_languages_data||''),esc(`${p}.txt`)].join(','));
  const csv   = [hdrs.join(','),...rows].join('\r\n') + '\r\n';
  const zip   = new AdmZip();
  zip.addFile('data.csv', Buffer.from(csv,'utf8'));
  Object.entries(byPid).forEach(([p,pts]) => zip.addFile(`stroop/${p}.txt`, Buffer.from(pts.map(toPsyRow).join('\n')+'\n','utf8')));
  return { statusCode:200, headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="psytoolkit_stroop_${new Date().toISOString().slice(0,10)}.zip"`}, body:zip.toBuffer().toString('base64'), isBase64Encoded:true };
}

exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
  const path   = event.requestContext?.http?.path || event.path || '/';
  const query  = event.queryStringParameters || {};
  console.log(`[REQ] ${method} ${path}`);
  const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' };
  try {
    if (method === 'OPTIONS') return { statusCode:204, headers:cors };
    let r;
    if (method==='POST' && path.startsWith('/api/submit'))          r = await handleSubmit(event.body);
    else if (method==='GET' && path==='/admin/download-psytoolkit') r = await handlePsyToolkit(query.key);
    else if (method==='GET' && path==='/admin/download')            r = await handleCsv(query.key);
    else if (method==='GET' && path.startsWith('/admin'))           r = await handleAdmin(query.key);
    else r = { statusCode:404, body:'Not found.' };
    return { ...r, headers:{ ...cors, ...(r.headers||{}) } };
  } catch(e) {
    console.error('[ERR]', e);
    return { statusCode:500, headers:cors, body:JSON.stringify({ ok:false, error:'Internal server error.' }) };
  }
};

function adminHtml(key, trials) {
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
    .header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:32px}
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
