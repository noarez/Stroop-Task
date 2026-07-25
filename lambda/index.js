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
  const real   = trials.filter(t => t.is_task);
  const pids   = new Set(trials.map(t => t.participant_id));
  return { statusCode:200, headers:{'Content-Type':'text/html; charset=utf-8'}, body: adminHtml(key, real.length, pids.size, trials.slice(-5).reverse()) };
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

function adminHtml(key, totalRows, participants, last) {
  const rows = last.slice(0,5).map(t => `<tr><td>${t.participant_id||''}</td><td>${t.trial_number||''}</td><td>${t.condition||''}</td><td>${t.displayed_word||''}</td><td>${t.ink_color||''}</td><td>${t.user_input||''}</td><td><span style="color:${t.accuracy?'#52b46b':'#e05252'}">${t.accuracy?'✓':'✗'}</span></td><td>${t.rt_ms||''}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Stroop Admin</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;background:#0f1117;color:#e8eaf0;padding:40px 24px}.wrap{max-width:860px;margin:0 auto}h1{font-size:1.8rem;font-weight:800;background:linear-gradient(135deg,#e8eaf0,#6b8aff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px}.sub{color:#8b8fa8;font-size:.9rem;margin-bottom:36px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:36px}.stat{background:#1a1d26;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:24px;text-align:center}.stat-val{font-size:2.4rem;font-weight:800;color:#6b8aff}.stat-lbl{font-size:.8rem;color:#8b8fa8;margin-top:4px}.btns{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}.btn{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;border-radius:50px;font-size:1rem;font-weight:700;text-decoration:none;transition:transform .15s}.btn-blue{background:linear-gradient(135deg,#6b8aff,#8b5cf6);color:#fff;box-shadow:0 4px 24px rgba(107,138,255,.35)}.btn-green{background:linear-gradient(135deg,#2db87a,#1a9e65);color:#fff;box-shadow:0 4px 24px rgba(45,184,122,.35)}.btn:hover{transform:translateY(-2px)}table{width:100%;border-collapse:collapse;background:#1a1d26;border-radius:14px;overflow:hidden;font-size:.82rem}th{background:#20232f;color:#8b8fa8;font-weight:600;padding:10px 14px;text-align:left}td{padding:9px 14px;border-top:1px solid rgba(255,255,255,.05);color:#c5c8d8;font-family:monospace}</style>
  </head><body><div class="wrap">
  <h1>🧠 Stroop Admin Panel</h1><p class="sub">Researcher-only — keep this URL private</p>
  <div class="grid"><div class="stat"><div class="stat-val">${totalRows.toLocaleString()}</div><div class="stat-lbl">Real trial rows</div></div><div class="stat"><div class="stat-val">${participants}</div><div class="stat-lbl">Unique participants</div></div></div>
  <div class="btns"><a class="btn btn-blue" href="/admin/download?key=${key}">⬇ Download Full CSV</a><a class="btn btn-green" href="/admin/download-psytoolkit?key=${key}">🧪 Download PsyToolkit ZIP</a></div>
  <p style="font-size:.8rem;color:#8b8fa8;margin-bottom:28px">PsyToolkit ZIP compatible with <code>psytkReadData()</code> in R</p>
  <h2 style="font-size:1rem;color:#8b8fa8;margin-bottom:12px">LAST SUBMISSIONS</h2>
  <table><tr><th>ID</th><th>Trial#</th><th>Condition</th><th>Word</th><th>Ink</th><th>Response</th><th>OK</th><th>RT</th></tr>${rows}</table>
  </div></body></html>`;
}
