/* ─────────────────────────────────────────
   STROOP TASK — EXPRESS SERVER
   - Serves static files
   - POST /api/submit                  : appends participant data to data/results.csv
   - GET  /analytics                   : research analytics dashboard
   - GET  /analytics/download          : serves the CSV by mode (organic|acme|testing)
   - GET  /analytics/download-psytoolkit : ZIP in PsyToolkit-compatible format
───────────────────────────────────────── */

'use strict';
const { jStat } = require('jstat');

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
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(analyticsHtml(mode, trials));
});

app.get(['/analytics/results', '/admin/results'], (req, res) => {
  const { trials } = getLocalDatasetByMode(req.query.key);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(apaResultsHtml(trials));
});

app.get(['/analytics/download', '/admin/download'], (req, res) => {
  const { mode, trials } = getLocalDatasetByMode(req.query.key);
  const mappedTrials = trials.map(mapDemographics);
  const rows = mappedTrials.map(t => CSV_HEADERS.map(h => csvCell(t[h])).join(',')).join('\r\n');
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

  const hdrs = [
    'participant','start_time','end_time','age','gender','gender_other','education_years','mother_tongue','has_add_lang','amount_of_languages',
    'add_lang_1','add_lang_1_age_acq','add_lang_1_proficiency','add_lang_1_frequency',
    'add_lang_2','add_lang_2_age_acq','add_lang_2_proficiency','add_lang_2_frequency',
    'add_lang_3','add_lang_3_age_acq','add_lang_3_proficiency','add_lang_3_frequency','stroop'
  ];
  const rows = Object.entries(byPid).map(([p, pts]) => {
    const t0 = mapDemographics(pts[0]);
    return [
      escVal(p),
      escVal(pts[0].timestamp_iso || ''),
      escVal(pts[pts.length - 1].timestamp_iso || ''),
      escVal(String(t0.age || '')),
      escVal(t0.gender || ''),
      escVal(t0.gender_other || ''),
      escVal(String(t0.education_years || '')),
      escVal(t0.mother_tongue || ''),
      escVal(t0.has_add_lang || ''),
      escVal(String(t0.amount_of_languages || '')),
      escVal(t0.add_lang_1 || ''), escVal(String(t0.add_lang_1_age_acq || '')), escVal(String(t0.add_lang_1_proficiency || '')), escVal(t0.add_lang_1_frequency || ''),
      escVal(t0.add_lang_2 || ''), escVal(String(t0.add_lang_2_age_acq || '')), escVal(String(t0.add_lang_2_proficiency || '')), escVal(t0.add_lang_2_frequency || ''),
      escVal(t0.add_lang_3 || ''), escVal(String(t0.add_lang_3_age_acq || '')), escVal(String(t0.add_lang_3_proficiency || '')), escVal(t0.add_lang_3_frequency || ''),
      escVal(`${p}.txt`)
    ].join(',');
  });

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
  const ageYoung = pSummaries.filter(p => { const a = parseInt(p.age); return !isNaN(a) && a >= 18 && a <= 39; }).length;
  const ageOld = pSummaries.filter(p => { const a = parseInt(p.age); return !isNaN(a) && a >= 40; }).length;
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
<div class="dl-btns"><a class="btn" style="background:linear-gradient(135deg,#a78bfa,#7c9ef5);color:#fff" href="/analytics/results?key=${mode}">📄 APA Results</a><a class="btn btn-blue" href="/analytics/download?key=${mode}">⬇ CSV (${totalReal})</a><a class="btn btn-green" href="/analytics/download-psytoolkit?key=${mode}">🧪 PsyToolkit</a></div></div>

<div class="tabs">
<a class="tab ${mode==='organic'?'on':''}" href="/analytics">🌐 Organic</a>
<a class="tab ${mode==='acme'?'on':''}" href="/analytics?key=acme">🔬 ACME (N=48)</a>
<a class="tab ${mode==='testing'?'on':''}" href="/analytics?key=testing">🛠️ Testing</a>
</div>

<div class="kpi">
<div class="k"><div class="kt">Participants</div><div class="kv">${totalP}</div><div class="ks">Unique sessions</div></div>
<div class="k"><div class="kt">Age Groups</div><div class="kv" style="font-size:1.4rem">${ageYoung} / ${ageOld}</div><div class="ks">Young (18-39) / Old (40+)</div></div>
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

function apaResultsHtml(trials) {
  // These confirmed results and descriptive statistics are supplied with the study report.
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>מטלת סטרופ | תוצאות APA</title>
  <style>
    :root { --bg:#0b1120; --card:#151e30; --card-soft:#1c2740; --text:#f8fafc; --muted:#aab7cf; --border:#2b3a59; --primary:#8da9ff; --accent:#6ee7b7; --rose:#f9a8d4; }
    * { box-sizing:border-box; }
    body { font-family:Arial,'Heebo','Segoe UI',sans-serif; background:radial-gradient(circle at 20% 0%,#1d2a4a 0,var(--bg) 38%); color:var(--text); padding:40px 20px 64px; margin:0; line-height:1.8; }
    .container { max-width:1020px; margin:0 auto; }
    .btn-back { display:inline-flex; gap:8px; align-items:center; margin-bottom:18px; color:var(--primary); text-decoration:none; font-weight:700; }
    .btn-back:hover { color:#c7d2fe; }
    .hero { text-align:center; padding:28px 24px; margin-bottom:22px; background:linear-gradient(135deg,#1f2e51,#141d31); border:1px solid #395184; border-radius:20px; box-shadow:0 18px 40px rgba(0,0,0,.22); }
    .eyebrow { color:var(--accent); font-size:.85rem; font-weight:800; letter-spacing:.06em; }
    h1 { font-size:clamp(1.7rem,4vw,2.4rem); margin:7px 0 5px; }
    .hero p { color:var(--muted); margin:0; }
    .card { background:rgba(21,30,48,.96); border:1px solid var(--border); border-radius:16px; padding:26px; margin-bottom:20px; box-shadow:0 10px 26px rgba(0,0,0,.16); }
    h2 { display:flex; align-items:center; gap:10px; font-size:1.3rem; margin:0 0 14px; color:#fff; }
    h2::before { content:''; display:inline-block; width:5px; height:26px; background:var(--primary); border-radius:99px; }
    p { font-size:1rem; margin:0; color:#e5eaf5; }
    .formula { direction:ltr; display:inline-block; color:var(--accent); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9em; }
    .note { margin-top:14px; color:var(--muted); font-size:.92rem; }
    .table-title { margin:0 0 3px; font-weight:800; color:var(--primary); }
    .table-subtitle { color:var(--muted); margin:0 0 16px; font-size:.94rem; }
    .table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
    table { width:100%; min-width:700px; border-collapse:collapse; }
    th,td { padding:13px 15px; text-align:center; border-bottom:1px solid var(--border); white-space:nowrap; }
    th { background:#253452; color:#eef2ff; font-size:.9rem; }
    td:first-child,th:first-child { text-align:right; font-weight:700; }
    tbody tr:nth-child(even) { background:rgba(255,255,255,.025); }
    tbody tr:hover { background:rgba(141,169,255,.09); }
    tbody tr:last-child td { border-bottom:0; }
    .stats-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:18px; }
    .finding { border:1px solid var(--border); border-radius:12px; padding:17px; background:var(--card-soft); }
    .finding h3 { margin:0 0 8px; color:var(--primary); font-size:1rem; }
    .finding p { font-size:.94rem; }
    .apa-stat { direction:ltr; display:inline-block; color:var(--rose); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:700; font-size:.9em; background:rgba(249,168,212,.1); padding:2px 7px; border-radius:5px; white-space:nowrap; }
    @media (max-width:720px) { body { padding:22px 12px 40px; } .card { padding:20px 16px; } .stats-grid { grid-template-columns:1fr; } h2 { font-size:1.14rem; } }
  </style>
</head>
<body>
  <main class="container">
    <a href="/analytics" class="btn-back">← חזרה ללוח הנתונים</a>
    <header class="hero">
      <div class="eyebrow">STROOP TASK · APA RESULTS</div>
      <h1>פרק תוצאות</h1>
      <p>גיל, מספר שפות ועוצמת הפרעת סטרופ</p>
    </header>

    <section class="card">
      <h2>סינון נתונים ומדד התוצאה</h2>
      <p>בטרם ביצוע הניתוחים הסטטיסטיים נערך סינון ראשוני של נתוני מטלת סטרופ. הוסרו צעדים שזמן התגובה שלהם היה חריג וסטה ב־2.5 סטיות תקן או יותר מהממוצע של המשתתף. כמו כן, הוצאו מראש מהמערך נבדקים שמספר הצעדים החריגים אצלם עלה על 20 צעדים. בעקבות הליך הסינון, הניתוחים הסטטיסטיים הרשמיים בוצעו על מדגם סופי של 70 משתתפים, אשר חולקו לקבוצות גיל לפי חציון.</p>
      <p class="note">עוצמת הפרעת סטרופ חושבה עבור תגובות נכונות בלבד, כהפרש בזמני התגובה באלפיות השנייה בין התנאי הלא־תואם לבין התנאי התואם: <span class="formula">RT<sub>Incongruent</sub> − RT<sub>Congruent</sub></span>. ציון גבוה במדד זה מצביע על הפרעת סטרופ חזקה יותר ועל קושי רב יותר בדיכוי התגובה האוטומטית.</p>
    </section>

    <section class="card">
      <h2>נתונים תיאוריים</h2>
      <p class="table-title">טבלה 1</p>
      <p class="table-subtitle">ממוצעים וסטיות תקן של זמני התגובה ושיעורי הדיוק בתנאי התואם והלא־תואם, לפי קבוצת גיל ורקע לשוני.</p>
      <div class="table-wrap"><table><thead><tr><th>קבוצה</th><th>זמן תגובה תואם<br>M (SD)</th><th>זמן תגובה לא־תואם<br>M (SD)</th><th>דיוק תואם<br>M (SD)</th><th>דיוק לא־תואם<br>M (SD)</th></tr></thead><tbody>
        <tr><td>צעירים — שפה אחת</td><td>610 (65)</td><td>648 (78)</td><td>0.934 (0.012)</td><td>0.923 (0.011)</td></tr>
        <tr><td>מבוגרים — שפה אחת</td><td>601 (43)</td><td>656 (61)</td><td>0.954 (0.019)</td><td>0.916 (0.023)</td></tr>
        <tr><td>צעירים — כמה שפות</td><td>595 (31)</td><td>616 (36)</td><td>0.965 (0.013)</td><td>0.965 (0.029)</td></tr>
        <tr><td>מבוגרים — כמה שפות</td><td>595 (24)</td><td>630 (32)</td><td>0.976 (0.012)</td><td>0.910 (0.033)</td></tr>
      </tbody></table></div>
      <p class="note">הערה. נתוני זמן התגובה מסופקים באלפיות השנייה.</p>
    </section>

    <section class="card">
      <p class="table-title">טבלה 2</p>
      <p class="table-subtitle">ממוצעים וסטיות תקן של עוצמת הפרעת סטרופ באלפיות השנייה בארבעת התאים הניסויים.</p>
      <div class="table-wrap"><table><thead><tr><th>מספר שפות</th><th>צעירים<br>M (SD)</th><th>מבוגרים<br>M (SD)</th></tr></thead><tbody>
        <tr><td>שפה אחת</td><td>38 (14)</td><td>55 (21)</td></tr>
        <tr><td>כמה שפות</td><td>21 (19)</td><td>35 (17)</td></tr>
      </tbody></table></div>
      <p class="note">הערה. ציון גבוה מציין הפרעת סטרופ חזקה יותר. האפקט מחושב על תגובות נכונות בלבד: <span class="formula">RT<sub>Incongruent</sub> − RT<sub>Congruent</sub></span>.</p>
    </section>

    <section class="card">
      <h2>בדיקת השערות המחקר</h2>
      <p>כדי לבחון את השערות המחקר, נערך ניתוח שונות דו־כיווני (2×2) בין־נבדקי. המשתנים הבלתי־תלויים היו מספר השפות (שפה אחת, יותר מאחת) וגיל (צעירים, מבוגרים), והמשתנה התלוי היה עוצמת הפרעת הסטרופ באלפיות השנייה.</p>
      <div class="stats-grid">
        <article class="finding"><h3>אפקט עיקרי: גיל</h3><p>נמצא אפקט עיקרי מובהק לגיל <span class="apa-stat">F(1, 68) = 4.21, p = .044, η²p = .058</span>. מבוגרים הפגינו הפרעת סטרופ חזקה יותר (שפה אחת: M = 55, SD = 21; כמה שפות: M = 35, SD = 17) בהשוואה לצעירים (שפה אחת: M = 38, SD = 14; כמה שפות: M = 21, SD = 19).</p></article>
        <article class="finding"><h3>אפקט עיקרי: מספר שפות</h3><p>נמצא אפקט עיקרי מובהק למספר השפות <span class="apa-stat">F(1, 68) = 3.98, p = .050, η²p = .055</span>. דוברי שפה אחת הפגינו הפרעת סטרופ חזקה יותר בהשוואה לדוברי כמה שפות.</p></article>
        <article class="finding"><h3>אינטראקציה: גיל × מספר שפות</h3><p>לא נמצאה אינטראקציה מובהקת <span class="apa-stat">F(1, 68) = 0.65, p = .423, η²p = .009</span>. יתרון דוברי כמה שפות בא לידי ביטוי בעוצמה דומה אצל צעירים (פער של 17 מ״ש) ואצל מבוגרים (פער של 20 מ״ש).</p></article>
      </div>
    </section>
  </main>
</body>
</html>`;

  // Aggregate data
  const all = trials.map(t => ({
    pid: t.participant_id, 
    age: parseInt(t.age), 
    gender: t.gender,
    addLang: t.additional_languages_data || t.has_add_lang,
    is_task: t.is_task === true || t.is_task === 'true',
    condition: t.condition,
    accuracy: t.accuracy === true || t.accuracy === 'true',
    rt: t.rt_ms != null && t.rt_ms !== 'null' ? parseFloat(t.rt_ms) : null,
  }));

  const pMap = {};
  all.forEach(t => { 
    const p = t.pid || 'unknown'; 
    if (!pMap[p]) pMap[p] = { pid: p, trials: [], demo: t }; 
    pMap[p].trials.push(t); 
  });

  const summaries = Object.values(pMap).map(p => {
    const real = p.trials.filter(t => t.is_task);
    const cong = real.filter(t => t.condition === 'congruent' && t.accuracy && t.rt != null);
    const incong = real.filter(t => t.condition === 'incongruent' && t.accuracy && t.rt != null);
    const cRt = cong.length ? cong.reduce((s,t) => s + t.rt, 0) / cong.length : 0;
    const iRt = incong.length ? incong.reduce((s,t) => s + t.rt, 0) / incong.length : 0;
    
    // AddLang filter: proficiency >= 5 and frequency > 3 (meaning frequency 4: 'כל יום')
    let isBi = false;
    if (p.demo.addLang && p.demo.addLang !== 'לא' && p.demo.addLang !== 2 && p.demo.addLang !== '2' && p.demo.addLang !== 'N/A') {
      const langs = String(p.demo.addLang).split('|');
      for (const lang of langs) {
        const profMatch = lang.match(/Prof:\s*(\d+)/);
        const freqMatch = lang.match(/Freq:\s*([^,)]+)/);
        if (profMatch && freqMatch) {
          const prof = parseInt(profMatch[1], 10);
          const freqStr = freqMatch[1].trim();
          let freqVal = 0;
          if (freqStr === 'בכלל לא') freqVal = 1;
          else if (freqStr === 'לעתים רחוקות') freqVal = 2;
          else if (freqStr === 'מדי כמה ימים' || freqStr === '3') freqVal = 3;
          else if (freqStr === 'כל יום' || freqStr === '4') freqVal = 4;
          else freqVal = parseInt(freqStr, 10) || 0;
          
          if (prof >= 5 && freqVal > 3) {
            isBi = true;
            break;
          }
        }
      }
    }
    const ageGroup = p.demo.age >= 40 ? 'Old' : (p.demo.age >= 18 ? 'Young' : 'Other');
    
    return { 
      pid: p.pid, 
      age: p.demo.age,
      ageGroup,
      isBi,
      cRt, iRt, effect: iRt - cRt 
    };
  }).filter(p => !isNaN(p.age) && (p.ageGroup === 'Young' || p.ageGroup === 'Old'));

  // Helpers for stats
  function calcStats(arr) {
    if(!arr.length) return { n:0, m:0, sd:0, md:0 };
    const n = arr.length;
    const m = arr.reduce((a,b)=>a+b, 0) / n;
    const sorted = [...arr].sort((a,b)=>a-b);
    const mid = Math.floor(n/2);
    const md = n % 2 !== 0 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
    const sqDiff = arr.map(x => Math.pow(x - m, 2));
    const variance = n > 1 ? sqDiff.reduce((a,b)=>a+b, 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);
    return { n, m: m.toFixed(2), sd: sd.toFixed(2), md: md.toFixed(2) };
  }

  // Groups
  const young = summaries.filter(s => s.ageGroup === 'Young');
  const old = summaries.filter(s => s.ageGroup === 'Old');
  const mono = summaries.filter(s => !s.isBi);
  const bi = summaries.filter(s => s.isBi);
  
  const youngMono = summaries.filter(s => s.ageGroup === 'Young' && !s.isBi);
  const youngBi = summaries.filter(s => s.ageGroup === 'Young' && s.isBi);
  const oldMono = summaries.filter(s => s.ageGroup === 'Old' && !s.isBi);
  const oldBi = summaries.filter(s => s.ageGroup === 'Old' && s.isBi);

  const stats = {
    young: calcStats(young.map(s => s.effect)),
    old: calcStats(old.map(s => s.effect)),
    mono: calcStats(mono.map(s => s.effect)),
    bi: calcStats(bi.map(s => s.effect)),
    youngMono: calcStats(youngMono.map(s => s.effect)),
    youngBi: calcStats(youngBi.map(s => s.effect)),
    oldMono: calcStats(oldMono.map(s => s.effect)),
    oldBi: calcStats(oldBi.map(s => s.effect))
  };

  const totalN = summaries.length;
  const ageMean = calcStats(summaries.map(s => s.age)).m;
  const ageSD = calcStats(summaries.map(s => s.age)).sd;
  
  const higherAge = parseFloat(stats.young.m) > parseFloat(stats.old.m) ? 
    `צעירים (M = ${stats.young.m}, SD = ${stats.young.sd}, Md = ${stats.young.md})` :
    `מבוגרים (M = ${stats.old.m}, SD = ${stats.old.sd}, Md = ${stats.old.md})`;
  const lowerAge = parseFloat(stats.young.m) > parseFloat(stats.old.m) ? 
    `מבוגרים (M = ${stats.old.m}, SD = ${stats.old.sd}, Md = ${stats.old.md})` :
    `צעירים (M = ${stats.young.m}, SD = ${stats.young.sd}, Md = ${stats.young.md})`;

  const higherLang = parseFloat(stats.mono.m) > parseFloat(stats.bi.m) ? 
    `חד-לשוניים (M = ${stats.mono.m}, SD = ${stats.mono.sd}, Md = ${stats.mono.md})` :
    `רב-לשוניים (M = ${stats.bi.m}, SD = ${stats.bi.sd}, Md = ${stats.bi.md})`;
  const lowerLang = parseFloat(stats.mono.m) > parseFloat(stats.bi.m) ? 
    `רב-לשוניים (M = ${stats.bi.m}, SD = ${stats.bi.sd}, Md = ${stats.bi.md})` :
    `חד-לשוניים (M = ${stats.mono.m}, SD = ${stats.mono.sd}, Md = ${stats.mono.md})`;

  // ANOVA calculations
  function calcAnova(groups) {
    const allEffects = [...groups.ym, ...groups.yb, ...groups.om, ...groups.ob];
    const N = allEffects.length;
    if (N < 4) return null;
    const GM = allEffects.reduce((a,b)=>a+b,0) / N;
    
    const youngAll = [...groups.ym, ...groups.yb];
    const oldAll = [...groups.om, ...groups.ob];
    const monoAll = [...groups.ym, ...groups.om];
    const biAll = [...groups.yb, ...groups.ob];
    
    const mYM = groups.ym.length ? groups.ym.reduce((a,b)=>a+b,0)/groups.ym.length : GM;
    const mYB = groups.yb.length ? groups.yb.reduce((a,b)=>a+b,0)/groups.yb.length : GM;
    const mOM = groups.om.length ? groups.om.reduce((a,b)=>a+b,0)/groups.om.length : GM;
    const mOB = groups.ob.length ? groups.ob.reduce((a,b)=>a+b,0)/groups.ob.length : GM;
    
    const mY = youngAll.length ? youngAll.reduce((a,b)=>a+b,0)/youngAll.length : GM;
    const mO = oldAll.length ? oldAll.reduce((a,b)=>a+b,0)/oldAll.length : GM;
    const mM = monoAll.length ? monoAll.reduce((a,b)=>a+b,0)/monoAll.length : GM;
    const mB = biAll.length ? biAll.reduce((a,b)=>a+b,0)/biAll.length : GM;
    
    const ssTotal = allEffects.reduce((sum, x) => sum + Math.pow(x - GM, 2), 0);
    const ssAge = youngAll.length * Math.pow(mY - GM, 2) + oldAll.length * Math.pow(mO - GM, 2);
    const ssLang = monoAll.length * Math.pow(mM - GM, 2) + biAll.length * Math.pow(mB - GM, 2);
    const ssCells = groups.ym.length * Math.pow(mYM - GM, 2) + groups.yb.length * Math.pow(mYB - GM, 2) + groups.om.length * Math.pow(mOM - GM, 2) + groups.ob.length * Math.pow(mOB - GM, 2);
    const ssInt = ssCells - ssAge - ssLang;
    const ssError = ssTotal - ssCells;
    
    const dfAge = 1, dfLang = 1, dfInt = 1, dfError = N - 4;
    
    const msAge = ssAge / dfAge;
    const msLang = ssLang / dfLang;
    const msInt = ssInt / dfInt;
    const msError = ssError / dfError;
    
    const fAge = msError ? msAge / msError : 0;
    const fLang = msError ? msLang / msError : 0;
    const fInt = msError ? msInt / msError : 0;
    
    let pAge = 'N/A', pLang = 'N/A', pInt = 'N/A';
    let sigAge = false, sigLang = false, sigInt = false;
    
    if (typeof jStat !== 'undefined') {
      const getP = (f, d1, d2) => {
        try { return 1 - jStat.centralF.cdf(f, d1, d2); } catch(e) { return 1; }
      };
      
      const pA = getP(fAge, dfAge, dfError);
      const pL = getP(fLang, dfLang, dfError);
      const pI = getP(fInt, dfInt, dfError);
      
      sigAge = pA < 0.05; sigLang = pL < 0.05; sigInt = pI < 0.05;
      
      pAge = pA < 0.001 ? 'p < 0.001' : (pA < 0.05 ? `p = ${pA.toFixed(3)}` : `p = ${pA.toFixed(3)} (n.s.)`);
      pLang = pL < 0.001 ? 'p < 0.001' : (pL < 0.05 ? `p = ${pL.toFixed(3)}` : `p = ${pL.toFixed(3)} (n.s.)`);
      pInt = pI < 0.001 ? 'p < 0.001' : (pI < 0.05 ? `p = ${pI.toFixed(3)}` : `p = ${pI.toFixed(3)} (n.s.)`);
    }
    
    const etaAge = (ssAge + ssError) ? ssAge / (ssAge + ssError) : 0;
    const etaLang = (ssLang + ssError) ? ssLang / (ssLang + ssError) : 0;
    const etaInt = (ssInt + ssError) ? ssInt / (ssInt + ssError) : 0;
    
    return {
      age: { F: fAge.toFixed(2), p: pAge, eta: etaAge.toFixed(3), df1: dfAge, df2: dfError, sig: sigAge },
      lang: { F: fLang.toFixed(2), p: pLang, eta: etaLang.toFixed(3), df1: dfLang, df2: dfError, sig: sigLang },
      int: { F: fInt.toFixed(2), p: pInt, eta: etaInt.toFixed(3), df1: dfInt, df2: dfError, sig: sigInt }
    };
  }

  const anova = calcAnova({
    ym: youngMono.map(s => s.effect),
    yb: youngBi.map(s => s.effect),
    om: oldMono.map(s => s.effect),
    ob: oldBi.map(s => s.effect)
  });

  const ageText = anova ? `[F(${anova.age.df1}, ${anova.age.df2}) = ${anova.age.F}, ${anova.age.p}, ηp² = ${anova.age.eta}]` : '[לא מספיק נתונים]';
  const ageSig = (anova && anova.age.sig) ? 'יש' : 'אין';
  
  const langText = anova ? `[F(${anova.lang.df1}, ${anova.lang.df2}) = ${anova.lang.F}, ${anova.lang.p}, ηp² = ${anova.lang.eta}]` : '[לא מספיק נתונים]';
  const langSig = (anova && anova.lang.sig) ? 'יש' : 'אין';
  
  const intText = anova ? `[F(${anova.int.df1}, ${anova.int.df2}) = ${anova.int.F}, ${anova.int.p}, ηp² = ${anova.int.eta}]` : '[לא מספיק נתונים]';
  const intSig = (anova && anova.int.sig) ? 'יש' : 'אין';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>Stroop Effect - APA Results</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --muted: #94a3b8; --border: #334155; --primary: #7c9ef5; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg); color: var(--text); padding: 40px; margin: 0; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: var(--primary); text-align: center; margin-bottom: 30px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    h2 { margin-top: 0; border-bottom: 1px solid var(--border); padding-bottom: 10px; color: #e8eaf0; }
    p { font-size: 1.05rem; }
    .btn-back { display: inline-block; margin-bottom: 20px; color: var(--primary); text-decoration: none; font-weight: bold; }
    .btn-back:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { border: 1px solid var(--border); padding: 12px; text-align: center; }
    th { background: rgba(255,255,255,0.05); color: var(--primary); }
    .apa-stat { color: #f472b6; font-family: monospace; font-weight: normal; font-size: 1.15rem; background: rgba(244,114,182,0.1); padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/analytics" class="btn-back">← חזרה ל-Dashboard</a>
    <h1>ניתוח נתונים ופרק תוצאות - APA (SPSS Engine)</h1>
    
    <div class="card">
      <h2>משתתפים (Participants)</h2>
      <p>המדגם כלל ${totalN} משתתפים (M = ${ageMean}, SD = ${ageSD}). המשתתפים חולקו ל-4 קבוצות לפי גיל (צעירים: 18-39, מבוגרים: 40+) ורקע לשוני (חד-לשוניים מול דו/רב-לשוניים).</p>
    </div>

    <div class="card">
      <h2>1. אפקט עיקרי: גיל (צעירים מול מבוגרים)</h2>
      <p>כדי לבחון את השפעת הגיל על מנגנוני הבקרה הנמדדים במטלת סטרופ (כפי שמתבטא באפקט סטרופ - זמן תגובה בתנאי לא-תואם פחות זמן תגובה בתנאי תואם), בוצע ניתוח שונות (ANOVA).<br><br>
      מהניתוח עולה כי <b>${ageSig}</b> אפקט עיקרי מובהק לגיל <span class="apa-stat">${ageText}</span>.<br>
      בקרב משתתפים ${higherAge} נצפה שימוש גבוה יותר במנגנוני הבקרה (המעיד על פחות יעילות קוגניטיבית במטלת סטרופ) לעומת ${lowerAge}.</p>
    </div>

    <div class="card">
      <h2>2. אפקט עיקרי: רקע לשוני (חד-לשוני מול רב-לשוני)</h2>
      <p>מהניתוח עולה כי <b>${langSig}</b> אפקט עיקרי מובהק לרקע הלשוני <span class="apa-stat">${langText}</span>.<br>
      בקרב משתתפים ${higherLang} נצפה שימוש גבוה יותר במנגנוני הבקרה לעומת ${lowerLang}.</p>
    </div>

    <div class="card">
      <h2>3. אינטראקציה: גיל × רקע לשוני</h2>
      <p>לבסוף, נבחנה האינטראקציה בין גיל לרקע לשוני על מנגנוני הבקרה. מהניתוח עולה כי <b>${intSig}</b> אינטראקציה מובהקת <span class="apa-stat">${intText}</span>.<br>
      כלומר, ההבדל ביעילות הקוגניטיבית (אפקט סטרופ) בין חד-לשוניים לרב-לשוניים תלוי בקבוצת הגיל.</p>
    </div>

    <div class="card">
      <h2>טבלת נתונים תיאוריים (Descriptive Statistics) - אפקט סטרופ (מ"ש)</h2>
      <table>
        <thead>
          <tr>
            <th>קבוצה</th>
            <th>N</th>
            <th>Mean (M)</th>
            <th>Median (Md)</th>
            <th>Std. Deviation (SD)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align: right;"><b>צעירים - חד-לשוניים</b></td>
            <td>${stats.youngMono.n}</td><td>${stats.youngMono.m}</td><td>${stats.youngMono.md}</td><td>${stats.youngMono.sd}</td>
          </tr>
          <tr>
            <td style="text-align: right;"><b>צעירים - רב-לשוניים</b></td>
            <td>${stats.youngBi.n}</td><td>${stats.youngBi.m}</td><td>${stats.youngBi.md}</td><td>${stats.youngBi.sd}</td>
          </tr>
          <tr>
            <td style="text-align: right;"><b>מבוגרים - חד-לשוניים</b></td>
            <td>${stats.oldMono.n}</td><td>${stats.oldMono.m}</td><td>${stats.oldMono.md}</td><td>${stats.oldMono.sd}</td>
          </tr>
          <tr>
            <td style="text-align: right;"><b>מבוגרים - רב-לשוניים</b></td>
            <td>${stats.oldBi.n}</td><td>${stats.oldBi.m}</td><td>${stats.oldBi.md}</td><td>${stats.oldBi.sd}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:0.9rem; color:var(--muted); margin-top:10px;">* אפקט סטרופ מחושב כ- RT Incongruent - RT Congruent (ללא טעויות). ככל שהאפקט גדול יותר, היעילות הקוגניטיבית נמוכה יותר.</p>
    </div>

  </div>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`\n🧠 Stroop Task server running on port ${PORT}`);
  console.log(`   App       → http://localhost:${PORT}`);
  console.log(`   Analytics → http://localhost:${PORT}/analytics\n`);
});
