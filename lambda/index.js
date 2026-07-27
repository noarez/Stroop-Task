'use strict';

const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const AdmZip = require('adm-zip');

const s3          = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const DATA_BUCKET = process.env.DATA_BUCKET || 'stroop-task-data-462355913922';
const ADMIN_KEY   = process.env.ADMIN_KEY   || 'stroop_admin_2024';

const CSV_HEADERS = [
  'participant_id','age','gender','gender_other','education_years',
  'mother_tongue','has_add_lang','amount_of_languages',
  'add_lang_1','add_lang_1_age_acq','add_lang_1_proficiency','add_lang_1_frequency',
  'add_lang_2','add_lang_2_age_acq','add_lang_2_proficiency','add_lang_2_frequency',
  'add_lang_3','add_lang_3_age_acq','add_lang_3_proficiency','add_lang_3_frequency',
  'is_task','trial_number','block_trial_number','condition',
  'displayed_word','ink_color','user_input','input_method',
  'accuracy','rt_ms','timestamp_iso',
];

const GENDER_MAP = { 'זכר':1, 'נקבה':2, 'אחר':3, 'אחר/מעדיף לא לציין':3 };
const EDU_MAP = {
  'השכלה יסודית / חלקית':1, 'השכלה תיכונית ללא תעודת בגרות':2, 'השכלה תיכונית עם תעודת בגרות מלאה':3,
  'השכלה על-תיכונית':4, 'תואר אקדמי ראשון':5, 'תואר אקדמי שני ומעלה':6
};
const TONGUE_MAP = {
  'עברית':1, 'ערבית':2, 'רוסית':3, 'אנגלית':4, 'אמהרית':5, 'צרפתית':6, 'ספרדית':7, 'אחר':8
};
const YES_NO_MAP = { 'כן':1, 'לא':2 };
const AGE_ACQ_MAP = {
  '0-6': 1, '0–6': 1,
  '6-12': 2, '6–12': 2,
  '12-18': 3, '12–18': 3,
  '18-30': 4, '18–30': 4,
  '30+': 5
};
const FREQ_MAP = {
  'בכלל לא': 1,
  'לעתים רחוקות': 2,
  'מדי כמה ימים': 3,
  'כל יום': 4
};

function mapDemographics(t) {
  const mapped = { ...t };
  mapped.gender = GENDER_MAP[t.gender] || t.gender;
  mapped.education_years = EDU_MAP[t.education_years] || t.education_years;
  mapped.mother_tongue = TONGUE_MAP[t.mother_tongue] || t.mother_tongue;
  mapped.has_add_lang = YES_NO_MAP[t.has_add_lang] || t.has_add_lang;
  
  let amount = 1;
  for (let i = 1; i <= 3; i++) {
    mapped[`add_lang_${i}`] = '';
    mapped[`add_lang_${i}_age_acq`] = '';
    mapped[`add_lang_${i}_proficiency`] = '';
    mapped[`add_lang_${i}_frequency`] = '';
  }
  delete mapped.additional_languages;
  delete mapped.additional_languages_data;

  if (t.has_add_lang === 'כן' || mapped.has_add_lang === 1) {
    if (t.additional_languages_data) {
      const langs = t.additional_languages_data.split('|').map(s => s.trim()).filter(Boolean);
      amount += langs.length;
      
      langs.forEach((langStr, idx) => {
        if (idx >= 3) return; 
        const n = idx + 1;
        const match = langStr.match(/^([^(]+)\s*\((.*)\)$/);
        if (match) {
          const langName = match[1].trim();
          mapped[`add_lang_${n}`] = TONGUE_MAP[langName] || langName;
          
          const details = match[2]; 
          const dMatch = details.match(/Age:\s*([^,]+),\s*Prof:\s*([^,]+),\s*Freq:\s*(.+)/);
          if (dMatch) {
             mapped[`add_lang_${n}_age_acq`] = AGE_ACQ_MAP[dMatch[1].trim()] || dMatch[1].trim();
             mapped[`add_lang_${n}_proficiency`] = dMatch[2].trim();
             mapped[`add_lang_${n}_frequency`] = FREQ_MAP[dMatch[3].trim()] || dMatch[3].trim();
          }
        } else {
          mapped[`add_lang_${n}`] = langStr;
        }
      });
    }
  }
  
  mapped.amount_of_languages = amount;
  return mapped;
}

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
    let addLangData = '';
    if (hasAdd === 'כן') {
      if (tongue === 'עברית') {
         if (rnd() > 0.8) {
           addLangData = 'אנגלית (Age:6-12, Prof:7, Freq:כל יום) | ספרדית (Age:12-18, Prof:4, Freq:לעתים רחוקות)';
         } else {
           addLangData = 'אנגלית (Age:6-12, Prof:8, Freq:כל יום)';
         }
      } else {
         addLangData = 'עברית (Age:0-6, Prof:9, Freq:כל יום)';
      }
    }
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

async function getDatasetByMode(key) {
  const mode = key === 'acme' ? 'acme' : (key === 'testing' || key === ADMIN_KEY) ? 'testing' : 'organic';
  if (mode === 'acme') return { mode, trials: generateAcmeTrials() };

  const all = await loadAllTrials();
  if (mode === 'testing') return { mode, trials: all };

  // Organic mode: filter out developer test PIDs
  const organic = all.filter(t => {
    const pid = String(t.participant_id || '').toUpperCase();
    return !pid.startsWith('TEST') && !pid.includes('LIVE-DOMAIN');
  });

  return { mode, trials: organic };
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

async function handleAnalytics(key) {
  const { mode, trials } = await getDatasetByMode(key);
  return { statusCode:200, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate'}, body: analyticsHtml(mode, trials) };
}

async function handleCsv(key) {
  const { mode, trials } = await getDatasetByMode(key);
  const mappedTrials = trials.map(mapDemographics);
  const rows = mappedTrials.map(t => CSV_HEADERS.map(h => csvCell(t[h])).join(',')).join('\r\n');
  const csv  = '\uFEFF' + CSV_HEADERS.join(',') + '\r\n' + rows + '\r\n';
  return { statusCode:200, headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="stroop_results_${mode}_${new Date().toISOString().slice(0,10)}.csv"`}, body:Buffer.from(csv,'utf8').toString('base64'), isBase64Encoded:true };
}

async function handlePsyToolkit(key) {
  const { mode, trials } = await getDatasetByMode(key);
  const byPid = {};
  trials.forEach(t => { const p = t.participant_id||'unknown'; (byPid[p]=byPid[p]||[]).push(t); });
  const hdrs = [
    'participant','start_time','end_time','age','gender','gender_other','education_years','mother_tongue','has_add_lang','amount_of_languages',
    'add_lang_1','add_lang_1_age_acq','add_lang_1_proficiency','add_lang_1_frequency',
    'add_lang_2','add_lang_2_age_acq','add_lang_2_proficiency','add_lang_2_frequency',
    'add_lang_3','add_lang_3_age_acq','add_lang_3_proficiency','add_lang_3_frequency','stroop'
  ];
  const rows = Object.entries(byPid).map(([p,pts]) => {
    const t0 = mapDemographics(pts[0]);
    return [
      esc(p),esc(pts[0].timestamp_iso||''),esc(pts[pts.length-1].timestamp_iso||''),
      esc(String(t0.age||'')),esc(t0.gender||''),esc(t0.gender_other||''),esc(String(t0.education_years||'')),
      esc(t0.mother_tongue||''),esc(t0.has_add_lang||''),esc(String(t0.amount_of_languages||'')),
      esc(t0.add_lang_1||''),esc(String(t0.add_lang_1_age_acq||'')),esc(String(t0.add_lang_1_proficiency||'')),esc(t0.add_lang_1_frequency||''),
      esc(t0.add_lang_2||''),esc(String(t0.add_lang_2_age_acq||'')),esc(String(t0.add_lang_2_proficiency||'')),esc(t0.add_lang_2_frequency||''),
      esc(t0.add_lang_3||''),esc(String(t0.add_lang_3_age_acq||'')),esc(String(t0.add_lang_3_proficiency||'')),esc(t0.add_lang_3_frequency||''),
      esc(`${p}.txt`)
    ].join(',');
  });
  const csv  = [hdrs.join(','),...rows].join('\r\n') + '\r\n';
  const zip  = new AdmZip();
  zip.addFile('data.csv', Buffer.from(csv,'utf8'));
  Object.entries(byPid).forEach(([p,pts]) => zip.addFile(`stroop/${p}.txt`, Buffer.from(pts.map(toPsyRow).join('\n')+'\n','utf8')));
  return { statusCode:200, headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="psytoolkit_stroop_${mode}_${new Date().toISOString().slice(0,10)}.zip"`}, body:zip.toBuffer().toString('base64'), isBase64Encoded:true };
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
    if (method==='POST' && path.startsWith('/api/submit'))                      r = await handleSubmit(event.body);
    else if (method==='GET' && (path==='/analytics/download-psytoolkit' || path==='/admin/download-psytoolkit')) r = await handlePsyToolkit(query.key);
    else if (method==='GET' && (path==='/analytics/download' || path==='/admin/download'))                     r = await handleCsv(query.key);
    else if (method==='GET' && (path.startsWith('/analytics') || path.startsWith('/admin')))                   r = await handleAnalytics(query.key);
    else r = { statusCode:404, body:'Not found.' };
    return { ...r, headers:{ ...cors, ...(r.headers||{}) } };
  } catch(e) {
    console.error('[ERR]', e);
    return { statusCode:500, headers:cors, body:JSON.stringify({ ok:false, error:'Internal server error.' }) };
  }
};


function analyticsHtml(mode, trials) {
  const all = (trials || []).map(t => ({
    pid: t.participant_id, age: t.age, gender: t.gender, edu: t.education_years,
    tongue: t.mother_tongue, addLang: t.additional_languages_data || t.has_add_lang,
    is_task: t.is_task === true || t.is_task === 'true',
    trial_num: t.trial_number || t.block_trial_number, condition: t.condition,
    word: t.displayed_word, ink: t.ink_color, input: t.user_input,
    accuracy: t.accuracy === true || t.accuracy === 'true',
    rt: t.rt_ms != null && t.rt_ms !== 'null' ? parseFloat(t.rt_ms) : null,
    iso: t.timestamp_iso
  }));

  const pMap = {};
  all.forEach(t => { const p = t.pid || 'unknown'; if (!pMap[p]) pMap[p] = { pid: p, trials: [], demo: t }; pMap[p].trials.push(t); });

  const pSummaries = Object.values(pMap).map(p => {
    const real = p.trials.filter(t => t.is_task);
    const prac = p.trials.filter(t => !t.is_task);
    const cong = real.filter(t => t.condition === 'congruent' && t.accuracy && t.rt != null);
    const incong = real.filter(t => t.condition === 'incongruent' && t.accuracy && t.rt != null);
    const cRt = cong.length ? cong.reduce((s,t) => s + t.rt, 0) / cong.length : 0;
    const iRt = incong.length ? incong.reduce((s,t) => s + t.rt, 0) / incong.length : 0;
    const effect = iRt - cRt;
    const acc = real.length ? (real.filter(t => t.accuracy).length / real.length) * 100 : 0;
    const timeouts = real.filter(t => t.input === 'timeout').length;
    const pracOk = prac.filter(t => t.accuracy && t.rt != null);
    const pRt = pracOk.length ? pracOk.reduce((s,t) => s + t.rt, 0) / pracOk.length : 0;
    return { pid: p.pid, age: p.demo.age || 'N/A', gender: p.demo.gender || 'N/A', edu: p.demo.edu || 'N/A', tongue: p.demo.tongue || 'N/A', addLang: p.demo.addLang || 'N/A', totalReal: real.length, cRt: Math.round(cRt*10)/10, iRt: Math.round(iRt*10)/10, effect: Math.round(effect*10)/10, acc: Math.round(acc*10)/10, pRt: Math.round(pRt*10)/10, timeouts, realTrials: real };
  });

  const totalReal = pSummaries.reduce((s,p) => s + p.totalReal, 0);
  const totalP = pSummaries.length;
  const avgStroop = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.effect, 0) / totalP)*10)/10 : 0;
  const overallAcc = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.acc, 0) / totalP)*10)/10 : 0;
  const avgC = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.cRt, 0) / totalP)*10)/10 : 0;
  const avgI = totalP ? Math.round((pSummaries.reduce((s,p) => s + p.iRt, 0) / totalP)*10)/10 : 0;
  const totalTimeouts = pSummaries.reduce((s,p) => s + p.timeouts, 0);
  const stroopEffects = pSummaries.map(p => p.effect);
  const stroopSD = totalP > 1 ? Math.round(Math.sqrt(stroopEffects.reduce((s,e) => s + Math.pow(e - avgStroop,2), 0) / (totalP - 1))*10)/10 : 0;

  const pLabels = pSummaries.map(p => p.pid.length > 14 ? p.pid.slice(0,14)+'…' : p.pid);
  const pCongRTs = pSummaries.map(p => p.cRt);
  const pIncongRTs = pSummaries.map(p => p.iRt);
  const pEffects = pSummaries.map(p => p.effect);
  const pAccs = pSummaries.map(p => p.acc);

  const allCongRTs = all.filter(t => t.is_task && t.condition==='congruent' && t.accuracy && t.rt!=null).map(t => Math.round(t.rt));
  const allIncongRTs = all.filter(t => t.is_task && t.condition==='incongruent' && t.accuracy && t.rt!=null).map(t => Math.round(t.rt));
  const binEdges = [200,400,600,800,1000,1200,1400,1600,1800,2000];
  const binLabels = binEdges.slice(0,-1).map((e,i) => e+'-'+binEdges[i+1]);
  function histogram(rts) { const c = new Array(binLabels.length).fill(0); rts.forEach(rt => { const idx = binEdges.findIndex((e,i) => i<binEdges.length-1 && rt>=e && rt<binEdges[i+1]); if(idx>=0) c[idx]++; }); return c; }
  const congHist = histogram(allCongRTs);
  const incongHist = histogram(allIncongRTs);

  const genderCounts = {};
  const ageBins = {'18-25':0,'26-35':0,'36-45':0,'46-55':0,'56+':0};
  
  const ageGroupStroop = {
    '18-25': { mono: [], bi: [] },
    '26-35': { mono: [], bi: [] },
    '36-45': { mono: [], bi: [] },
    '46-55': { mono: [], bi: [] },
    '56+': { mono: [], bi: [] }
  };
  let monoStroopTotal = [];
  let biStroopTotal = [];

  pSummaries.forEach(p => { 
    const g = p.gender||'N/A'; 
    genderCounts[g]=(genderCounts[g]||0)+1; 
    const a=parseInt(p.age); 
    
    const isBi = p.addLang && p.addLang !== 'לא' && p.addLang !== 2 && p.addLang !== '2' && p.addLang !== 'N/A';
    if (isBi) biStroopTotal.push(p.effect);
    else monoStroopTotal.push(p.effect);
    
    if(!isNaN(a)){
      let group = '56+';
      if(a<=25) group = '18-25';
      else if(a<=35) group = '26-35';
      else if(a<=45) group = '36-45';
      else if(a<=55) group = '46-55';
      
      ageBins[group]++;
      if (isBi) ageGroupStroop[group].bi.push(p.effect);
      else ageGroupStroop[group].mono.push(p.effect);
    } 
  });
  
  function avg(arr) { return arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : 0; }
  const monoAvg = avg(monoStroopTotal);
  const biAvg = avg(biStroopTotal);
  const interactionLabels = Object.keys(ageGroupStroop);
  const interactionMono = interactionLabels.map(k => avg(ageGroupStroop[k].mono));
  const interactionBi = interactionLabels.map(k => avg(ageGroupStroop[k].bi));
  const ageMainEffect = interactionLabels.map(k => avg([...ageGroupStroop[k].mono, ...ageGroupStroop[k].bi]));

  const recent = all.slice(-10).reverse();
  const modeTitle = mode==='acme'?'🔬 ACME Benchmark (N='+totalP+')':mode==='testing'?'🛠️ Testing':'🌐 Organic Data';
  const modeDesc = mode==='acme'?'Pre-seeded realistic Stroop Effect research simulation':mode==='testing'?'Developer testing & verification sessions':'Live participant submissions from organic experiment traffic';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Stroop Analytics — ${modeTitle}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e8eaf0;padding:28px 20px;line-height:1.5}
.wrap{max-width:1200px;margin:0 auto}
.header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px;margin-bottom:22px}
h1{font-size:1.7rem;font-weight:800;background:linear-gradient(135deg,#e8eaf0,#7c9ef5);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:3px}
.sub{color:#8b8fa8;font-size:.88rem}
.dl-btns{display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:7px;padding:10px 22px;border-radius:50px;font-size:.88rem;font-weight:700;text-decoration:none;transition:transform .15s}
.btn-blue{background:linear-gradient(135deg,#5a7de0,#7c9ef5);color:#fff;box-shadow:0 3px 16px rgba(124,158,245,.3)}
.btn-green{background:linear-gradient(135deg,#2db87a,#1a9e65);color:#fff;box-shadow:0 3px 16px rgba(45,184,122,.3)}
.btn:hover{transform:translateY(-2px)}
.tabs{display:flex;background:#161b27;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:5px;gap:5px;margin-bottom:24px;overflow-x:auto}
.tab{flex:1;min-width:150px;text-align:center;padding:9px 14px;border-radius:8px;font-size:.84rem;font-weight:600;color:#8b8fa8;text-decoration:none;transition:.2s;white-space:nowrap}
.tab:hover{color:#e8eaf0;background:rgba(255,255,255,.04)}
.tab.on{background:linear-gradient(135deg,#5a7de0,#7c9ef5);color:#fff;box-shadow:0 3px 14px rgba(124,158,245,.3)}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin-bottom:24px}
.k{background:#161b27;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px}
.kt{font-size:.74rem;font-weight:600;color:#8b8fa8;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px}
.kv{font-size:1.85rem;font-weight:800;color:#7c9ef5;line-height:1}
.kv.g{color:#52b46b}.kv.p{color:#a78bfa}.kv.o{color:#e09852}
.ks{font-size:.72rem;color:#8b8fa8;margin-top:3px}
.rbox{background:linear-gradient(135deg,#1c2336,#161b27);border:1px solid rgba(124,158,245,.25);border-radius:14px;padding:22px;margin-bottom:24px}
.rtitle{font-size:1.1rem;font-weight:700;margin-bottom:12px;color:#e9ecf4}
.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:.88rem}
.si{background:rgba(255,255,255,.03);padding:12px;border-radius:9px;border:1px solid rgba(255,255,255,.05)}
.si strong{color:#e8eaf0}.si .v{font-size:1.3rem;font-weight:800;margin-top:3px;line-height:1.2}
.cg{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:24px}
.cc{background:#161b27;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px}
.ct{font-size:.92rem;font-weight:700;margin-bottom:12px;color:#e8eaf0}
.cv{position:relative;height:250px;width:100%}.cv.t{height:300px}
.st{font-size:1.05rem;font-weight:700;color:#e8eaf0;margin-bottom:12px}
table{width:100%;border-collapse:collapse;background:#161b27;border-radius:12px;overflow:hidden;font-size:.8rem;margin-bottom:24px}
th{background:#1d2235;color:#8b8fa8;font-weight:600;padding:9px 11px;text-align:left}
td{padding:8px 11px;border-top:1px solid rgba(255,255,255,.05);color:#c5c8d8}
.bok{background:rgba(82,180,107,.15);color:#52b46b;padding:2px 7px;border-radius:16px;font-size:.7rem;font-weight:700}
.ber{background:rgba(224,82,82,.15);color:#e05252;padding:2px 7px;border-radius:16px;font-size:.7rem;font-weight:700}
.bw{background:rgba(224,152,82,.15);color:#e09852;padding:2px 7px;border-radius:16px;font-size:.7rem;font-weight:700}
.sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:24px}
.scc{background:#161b27;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px}
.scv{position:relative;height:190px;width:100%}
</style></head><body><div class="wrap">
<div class="header"><div><h1>🧠 Stroop Research & Cognitive Analytics</h1><p class="sub">${modeDesc}</p></div>
<div class="dl-btns"><a class="btn btn-blue" href="/analytics/download?key=${mode}">⬇ CSV (${totalReal})</a><a class="btn btn-green" href="/analytics/download-psytoolkit?key=${mode}">🧪 PsyToolkit</a></div></div>

<div class="tabs">
<a class="tab ${mode==='organic'?'on':''}" href="/analytics">🌐 Organic</a>
<a class="tab ${mode==='acme'?'on':''}" href="/analytics?key=acme">🔬 ACME (N=48)</a>
<a class="tab ${mode==='testing'?'on':''}" href="/analytics?key=testing">🛠️ Testing</a>
</div>

<div class="kpi">
<div class="k"><div class="kt">Participants</div><div class="kv">${totalP}</div><div class="ks">Unique sessions</div></div>
<div class="k"><div class="kt">Task Trials</div><div class="kv">${totalReal.toLocaleString()}</div><div class="ks">${totalP?Math.round(totalReal/totalP):0} per participant</div></div>
<div class="k"><div class="kt">Stroop Effect</div><div class="kv p">${avgStroop>0?'+':''}${avgStroop} ms</div><div class="ks">SD = ${stroopSD} ms</div></div>
<div class="k"><div class="kt">Accuracy</div><div class="kv g">${overallAcc}%</div><div class="ks">All participants</div></div>
<div class="k"><div class="kt">Congruent RT</div><div class="kv">${avgC} ms</div><div class="ks">Mean correct</div></div>
<div class="k"><div class="kt">Incongruent RT</div><div class="kv">${avgI} ms</div><div class="ks">Mean correct</div></div>
<div class="k"><div class="kt">Timeouts</div><div class="kv o">${totalTimeouts}</div><div class="ks">Omissions (>2s)</div></div>
</div>

<div class="rbox"><div class="rtitle">📊 Research Summary Statistics</div><div class="sg">
<div class="si"><strong>Stroop Interference</strong><div class="v" style="color:#a78bfa">${avgStroop>0?'+':''}${avgStroop} ms (SD=${stroopSD})</div><div style="font-size:.75rem;color:#8b8fa8;margin-top:3px">Mean Δ across N=${totalP}</div></div>
<div class="si"><strong>Congruent Mean RT</strong><div class="v" style="color:#7c9ef5">${avgC} ms</div><div style="font-size:.75rem;color:#8b8fa8;margin-top:3px">Automatic processing</div></div>
<div class="si"><strong>Incongruent Mean RT</strong><div class="v" style="color:#a78bfa">${avgI} ms</div><div style="font-size:.75rem;color:#8b8fa8;margin-top:3px">Controlled processing</div></div>
<div class="si"><strong>Error & Omission Rate</strong><div class="v" style="color:#e09852">${totalReal>0?Math.round((1-overallAcc/100)*1000)/10:0}% · ${totalTimeouts} timeouts</div><div style="font-size:.75rem;color:#8b8fa8;margin-top:3px">Outside 2000ms window</div></div>
</div></div>

<div class="rbox" style="margin-top:24px; border-color:rgba(45,184,122,.25);">
  <div class="rtitle">🎯 APA Research Insights: Age x Bilingualism Interaction</div>
  <div class="sg" style="margin-bottom:16px;">
    <div class="si"><strong>Monolingual Mean Interference</strong><div class="v" style="color:#e09852">${monoAvg>0?'+':''}${monoAvg} ms</div><div style="font-size:.75rem;color:#8b8fa8;margin-top:3px">N=${monoStroopTotal.length}</div></div>
    <div class="si"><strong>Bilingual Mean Interference</strong><div class="v" style="color:#52b46b">${biAvg>0?'+':''}${biAvg} ms</div><div style="font-size:.75rem;color:#8b8fa8;margin-top:3px">N=${biStroopTotal.length}</div></div>
  </div>
  <div class="cg" style="margin-bottom:0;">
    <div class="cc"><div class="ct">Main Effect of Age (Stroop Δ ms)</div><div class="cv t"><canvas id="c7"></canvas></div></div>
    <div class="cc"><div class="ct">Interaction: Age x Bilingualism (Stroop Δ ms)</div><div class="cv t"><canvas id="c8"></canvas></div></div>
  </div>
</div>

<div class="cg">
<div class="cc"><div class="ct">📊 Per-Participant RT (Congruent vs Incongruent)</div><div class="cv t"><canvas id="c1"></canvas></div></div>
<div class="cc"><div class="ct">📈 RT Distribution Histogram</div><div class="cv t"><canvas id="c2"></canvas></div></div>
</div>
<div class="cg">
<div class="cc"><div class="ct">⚡ Stroop Interference by Participant (ms)</div><div class="cv"><canvas id="c3"></canvas></div></div>
<div class="cc"><div class="ct">📉 Accuracy by Participant (%)</div><div class="cv"><canvas id="c4"></canvas></div></div>
</div>
<div class="sc">
<div class="scc"><div class="ct">👥 Gender Distribution</div><div class="scv"><canvas id="c5"></canvas></div></div>
<div class="scc"><div class="ct">🎂 Age Distribution</div><div class="scv"><canvas id="c6"></canvas></div></div>
</div>

<div class="st">👥 Participant Performance (${totalP})</div>
<table><thead><tr><th>#</th><th>Session</th><th>Age</th><th>Gender</th><th>Edu</th><th>Trials</th><th>Cong RT</th><th>Incong RT</th><th>Stroop Δ</th><th>Acc</th><th>TO</th></tr></thead><tbody>
${pSummaries.slice(0,100).map((p,i) => '<tr><td>'+(i+1)+'</td><td><code>'+p.pid+'</code></td><td>'+p.age+'</td><td>'+p.gender+'</td><td title="'+p.edu+'" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+p.edu+'</td><td>'+p.totalReal+'</td><td>'+p.cRt+' ms</td><td>'+p.iRt+' ms</td><td><strong style="color:'+(p.effect>0?'#a78bfa':'#52b46b')+'">'+(p.effect>0?'+':'')+p.effect+' ms</strong></td><td><span class="'+(p.acc>=90?'bok':p.acc>=70?'bw':'ber')+'">'+p.acc+'%</span></td><td>'+(p.timeouts>0?'<span class="bw">'+p.timeouts+'</span>':'0')+'</td></tr>').join('')}
</tbody></table>

<div class="st">📋 Recent Submissions</div>
<table><thead><tr><th>Session</th><th>Trial</th><th>Cond</th><th>Word</th><th>Ink</th><th>Resp</th><th>OK</th><th>RT</th></tr></thead><tbody>
${recent.map(t => '<tr><td><code>'+(t.pid||'')+'</code></td><td>'+(t.trial_num||'')+'</td><td>'+(t.condition||'')+'</td><td>'+(t.word||'')+'</td><td>'+(t.ink||'')+'</td><td>'+(t.input||'')+'</td><td><span class="'+(t.accuracy?'bok':'ber')+'">'+(t.accuracy?'✓':'✗')+'</span></td><td>'+(t.rt?Math.round(t.rt)+' ms':'N/A')+'</td></tr>').join('')}
</tbody></table>
</div>
<script>
const O={responsive:true,maintainAspectRatio:false};
const gc='rgba(255,255,255,0.06)',tc='#8b8fa8';

new Chart(document.getElementById('c1'),{type:'bar',data:{labels:${JSON.stringify(pLabels)},datasets:[{label:'Congruent',data:${JSON.stringify(pCongRTs)},backgroundColor:'rgba(124,158,245,0.75)',borderRadius:4},{label:'Incongruent',data:${JSON.stringify(pIncongRTs)},backgroundColor:'rgba(167,139,250,0.75)',borderRadius:4}]},options:{...O,plugins:{legend:{labels:{color:'#e8eaf0'}}},scales:{y:{grid:{color:gc},ticks:{color:tc},title:{display:true,text:'RT (ms)',color:tc}},x:{grid:{display:false},ticks:{color:tc,maxRotation:45}}}}});

new Chart(document.getElementById('c2'),{type:'bar',data:{labels:${JSON.stringify(binLabels)},datasets:[{label:'Congruent',data:${JSON.stringify(congHist)},backgroundColor:'rgba(124,158,245,0.6)',borderRadius:4},{label:'Incongruent',data:${JSON.stringify(incongHist)},backgroundColor:'rgba(167,139,250,0.6)',borderRadius:4}]},options:{...O,plugins:{legend:{labels:{color:'#e8eaf0'}}},scales:{y:{grid:{color:gc},ticks:{color:tc},title:{display:true,text:'Count',color:tc}},x:{grid:{display:false},ticks:{color:tc}}}}});

new Chart(document.getElementById('c3'),{type:'bar',data:{labels:${JSON.stringify(pLabels)},datasets:[{label:'Stroop Δ',data:${JSON.stringify(pEffects)},backgroundColor:${JSON.stringify(pEffects)}.map(v=>v>0?'rgba(167,139,250,0.7)':'rgba(82,180,107,0.7)'),borderRadius:4}]},options:{...O,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:gc},ticks:{color:tc}},y:{grid:{display:false},ticks:{color:tc}}}}});

new Chart(document.getElementById('c4'),{type:'bar',data:{labels:${JSON.stringify(pLabels)},datasets:[{label:'Accuracy',data:${JSON.stringify(pAccs)},backgroundColor:${JSON.stringify(pAccs)}.map(v=>v>=90?'rgba(82,180,107,0.7)':v>=70?'rgba(224,152,82,0.7)':'rgba(224,82,82,0.7)'),borderRadius:4}]},options:{...O,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:gc},ticks:{color:tc},min:0,max:100},y:{grid:{display:false},ticks:{color:tc}}}}});

new Chart(document.getElementById('c5'),{type:'doughnut',data:{labels:${JSON.stringify(Object.keys(genderCounts))},datasets:[{data:${JSON.stringify(Object.values(genderCounts))},backgroundColor:['rgba(124,158,245,0.8)','rgba(167,139,250,0.8)','rgba(82,180,107,0.8)','rgba(224,152,82,0.8)'],borderWidth:0}]},options:{...O,cutout:'55%',plugins:{legend:{position:'right',labels:{color:'#e8eaf0',padding:12}}}}});

new Chart(document.getElementById('c6'),{type:'bar',data:{labels:${JSON.stringify(Object.keys(ageBins))},datasets:[{data:${JSON.stringify(Object.values(ageBins))},backgroundColor:'rgba(124,158,245,0.7)',borderRadius:6}]},options:{...O,plugins:{legend:{display:false}},scales:{y:{grid:{color:gc},ticks:{color:tc,stepSize:1}},x:{grid:{display:false},ticks:{color:tc}}}}});

new Chart(document.getElementById('c7'),{type:'line',data:{labels:${JSON.stringify(interactionLabels)},datasets:[{label:'Mean Stroop Δ',data:${JSON.stringify(ageMainEffect)},borderColor:'rgba(124,158,245,1)',backgroundColor:'rgba(124,158,245,0.2)',fill:true,tension:0.3}]},options:{...O,plugins:{legend:{display:false}},scales:{y:{grid:{color:gc},ticks:{color:tc},title:{display:true,text:'Stroop Δ (ms)',color:tc}},x:{grid:{display:false},ticks:{color:tc}}}}});

new Chart(document.getElementById('c8'),{type:'bar',data:{labels:${JSON.stringify(interactionLabels)},datasets:[{label:'Monolingual',data:${JSON.stringify(interactionMono)},backgroundColor:'rgba(224,152,82,0.75)',borderRadius:4},{label:'Bilingual/Multilingual',data:${JSON.stringify(interactionBi)},backgroundColor:'rgba(82,180,107,0.75)',borderRadius:4}]},options:{...O,plugins:{legend:{labels:{color:'#e8eaf0'}}},scales:{y:{grid:{color:gc},ticks:{color:tc},title:{display:true,text:'Stroop Δ (ms)',color:tc}},x:{grid:{display:false},ticks:{color:tc}}}}});
</script></body></html>`;
}
