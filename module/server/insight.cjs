const fs = require('node:fs');
const { spawn } = require('node:child_process');

// 핵심 뽑기: 영상의 말소리를 글로 바꾸고(음성 인식), 그 글에서 AI 가 핵심 구간과 핵심 내용을 고른다.
// 원본 영상은 건드리지 않는다. 결과는 data/insight/<id>.json 에 둔다: { transcript:[{s,e,t}], summary, points:[{s,e,t}], edited }
// 음성 인식이나 AI 가 없으면 그 단계만 건너뛴다(자막 파일을 올리거나 손으로 구간을 고를 수 있다).
function run(cmd, args, timeoutMs = 0) {
  return new Promise((resolve) => {
    let p; try { p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); } catch (e) { return resolve({ code: -1, err: String(e.message) }); }
    let err = '', timer = timeoutMs ? setTimeout(() => p.kill(), timeoutMs) : null;
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, err: String(e.message) }); });
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

const toSec = (s) => { const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(String(s).trim()); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + Number('0.' + (m[4] || '0')) : null; };
const stamp = (t) => { const ms = Math.round(t * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`; };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const oneLine = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// 자막 파일(.srt/.vtt) → [{s,e,t}]
function parseSubs(text) {
  const out = [], lines = String(text).replace(/^﻿/, '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\S+)\s+-->\s+(\S+)/.exec(lines[i].trim()); if (!m) continue;
    const s = toSec(m[1]), e = toSec(m[2]), buf = [];
    while (i + 1 < lines.length && lines[i + 1].trim()) buf.push(lines[++i].trim());
    const t = oneLine(buf.join(' ').replace(/<[^>]+>/g, ''), 500);
    if (s != null && e != null && e > s && t) out.push({ s, e, t });
  }
  return out.sort((a, b) => a.s - b.s);
}
const toVtt = (segs) => 'WEBVTT\n\n' + segs.map((x) => `${stamp(x.s)} --> ${stamp(x.e)}\n${x.t}\n`).join('\n');

// 구간 목록을 다듬는다: 영상 길이 안으로, 시간순으로, 겹치지 않게.
function cleanPoints(points, duration) {
  const max = duration > 0 ? duration : Infinity, out = [];
  const list = (Array.isArray(points) ? points : []).map((p) => ({ s: Math.max(0, Number(p.s)), e: Math.min(max, Number(p.e)), t: oneLine(p.t, 200) }))
    .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e) && p.e > p.s + 0.3).sort((a, b) => a.s - b.s).slice(0, 60);
  for (const p of list) { const prev = out[out.length - 1]; if (prev && p.s < prev.e) p.s = prev.e; if (p.e > p.s + 0.3) out.push({ s: +p.s.toFixed(2), e: +p.e.toFixed(2), t: p.t }); }
  return out;
}
const jsonOf = (text) => { const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; } };

function createInsight(config, store, log = console.log) {
  const { db } = store, queue = [], texts = new Map();
  let busy = false;
  const file = (id) => store.paths.insight(id);
  const read = (id) => { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; } };
  const write = (id, data) => { fs.writeFileSync(file(id), JSON.stringify(data)); texts.delete(id); };
  const sttReady = config.sttCmd && config.sttCmd.length ? run(config.sttCmd[0], [...config.sttCmd.slice(1), '--check'], 60000).then((r) => r.code === 0) : Promise.resolve(false);
  sttReady.then((ok) => { if (!ok) log('[순수튜브] 음성 인식이 준비되지 않았어요. 핵심 뽑기는 자막 파일을 올리거나 손으로 고를 때만 됩니다. (tools/install_stt.sh)'); });
  const llmOn = !!config.llmUrl;

  async function chat(messages) {
    const call = async (extra) => fetch(config.llmUrl.replace(/\/+$/, '') + '/chat/completions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.llmKey ? { Authorization: 'Bearer ' + config.llmKey } : {}) },
      body: JSON.stringify({ model: config.llmModel, messages, temperature: 0.2, max_tokens: 3000, ...extra }), signal: AbortSignal.timeout(config.llmTimeoutMs) });
    let r = await call({ chat_template_kwargs: { enable_thinking: false } });   // 생각 과정을 끄면 빠르다. 이 옵션을 모르는 서버면 빼고 다시 묻는다.
    if (r.status === 400 || r.status === 422) r = await call({});
    if (!r.ok) throw new Error(`AI 서버가 ${r.status} 로 답했어요`);
    const j = await r.json();
    return String(((j.choices || [])[0] || {}).message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  // 대본 → { summary, points }. 긴 대본은 나눠서 묻는다. 줄 번호로 답하게 해서 시간을 틀리지 않게 한다.
  async function pick(segs, duration) {
    const lines = segs.map((x, i) => `[${i}] ${mmss(x.s)} ${x.t}`), chunks = [[]]; let n = 0;
    lines.forEach((l, i) => { if (n + l.length > 7000 && chunks[chunks.length - 1].length) { chunks.push([]); n = 0; } chunks[chunks.length - 1].push(i); n += l.length; });
    const total = Math.max(3, Math.min(14, Math.round((duration || segs[segs.length - 1].e) / 60 * 1.5)));
    const points = [], sums = [];
    for (const idx of chunks) {
      const want = Math.max(2, Math.round(total * idx.length / lines.length));
      const ans = await chat([{ role: 'system', content: '너는 영상 대본에서 핵심만 골라내는 편집자다. 설명 없이 JSON 만 답한다.' },
        { role: 'user', content: `아래는 영상 대본${chunks.length > 1 ? '의 한 부분' : ''}이다. 각 줄은 "[번호] 시간 말한 내용" 이다.\n\n할 일:\n1. 이 내용을 한두 문장으로 요약한다(summary).\n2. 꼭 봐야 할 핵심 구간을 ${want}개 안팎으로 고른다. 인사, 잡담, 준비, 같은 말 반복은 뺀다. 각 구간은 이어진 줄 번호 범위(from, to)로 적고, 그 구간에서 알아야 할 내용을 한 문장으로 적는다(text). 문장은 "~한다", "~이다" 처럼 내용 자체를 적는다.\n3. 고른 구간을 합친 길이는 전체의 20~40% 가 되게 한다.\n\n답 형식(이 JSON 만): {"summary":"...","points":[{"from":3,"to":7,"text":"..."}]}\n\n대본:\n${idx.map((i) => lines[i]).join('\n')}` }]);
      const j = jsonOf(ans); if (!j) throw new Error('AI 답을 읽지 못했어요');
      if (j.summary) sums.push(oneLine(j.summary, 400));
      for (const p of Array.isArray(j.points) ? j.points : []) {
        const a = Math.round(Number(p.from)), b = Math.round(Number(p.to ?? p.from));
        if (!(a >= idx[0] && b <= idx[idx.length - 1] && b >= a)) continue;
        points.push({ s: Math.max(0, segs[a].s - 0.3), e: segs[b].e + 0.3, t: p.text });
      }
    }
    let summary = sums[0] || '';
    if (sums.length > 1) summary = oneLine(await chat([{ role: 'user', content: `한 영상을 부분별로 요약한 글이다. 영상 전체를 두 문장 이내로 요약해라. 요약만 답한다.\n\n${sums.map((s, i) => `${i + 1}. ${s}`).join('\n')}` }]), 400) || sums.join(' ');
    return { summary, points: cleanPoints(points, duration) };
  }

  async function transcribe(v) {
    const wav = store.paths.incoming(v.id, '_stt.wav'), out = store.paths.incoming(v.id, '_stt.json');
    try {
      const a = await run(config.ffmpeg, ['-y', '-i', store.paths.media(v.id), '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wav]);
      if (a.code !== 0 || !fs.existsSync(wav) || fs.statSync(wav).size < 2000) return [];   // 소리가 없는 영상
      const r = await run(config.sttCmd[0], [...config.sttCmd.slice(1), wav, out], config.sttTimeoutMs);
      if (r.code !== 0) throw new Error('말소리를 글로 바꾸지 못했어요: ' + (r.err.split('\n').filter(Boolean).pop() || '알 수 없는 오류'));
      const segs = (JSON.parse(fs.readFileSync(out, 'utf8')).segments || []).map((x) => ({ s: +Number(x.start).toFixed(2), e: +Number(x.end).toFixed(2), t: oneLine(x.text, 500) }));
      return segs.filter((x) => x.t && x.e > x.s).sort((a, b) => a.s - b.s);
    } finally { for (const f of [wav, out]) try { fs.unlinkSync(f); } catch { } }
  }

  const mark = (v, data, status, note = '') => {
    const pts = (data && data.points) || [];
    Object.assign(v, { insight: status, insightNote: note, subs: !!(data && data.transcript && data.transcript.length), points: pts.length, coreSec: Math.round(pts.reduce((s, p) => s + p.e - p.s, 0)), summary: (data && data.summary) || '' });
    store.save();
  };

  async function work(v, opt) {
    const data = read(v.id) || { transcript: null, summary: '', points: [], edited: false };
    mark(v, data, 'working');
    if (!data.transcript || !data.transcript.length || opt.stt) {
      if (await sttReady && fs.existsSync(store.paths.media(v.id))) { data.transcript = await transcribe(v); data.fromFile = false; }
      else if (!data.transcript || !data.transcript.length) return mark(v, data, 'none', '음성 인식이 설치되지 않았어요. 자막 파일을 올리거나 핵심 구간을 직접 고를 수 있어요.');
    }
    if (data.transcript.reduce((n, x) => n + x.t.length, 0) < 20) { write(v.id, data); return mark(v, data, data.points.length ? 'ready' : 'nospeech', '말소리가 거의 없는 영상이에요. 핵심 구간은 직접 고를 수 있어요.'); }
    write(v.id, data);
    if (data.edited && !opt.force) return mark(v, data, 'ready');   // 사람이 고친 핵심은 덮어쓰지 않는다
    if (!llmOn) return mark(v, data, 'ready', data.points.length ? '' : 'AI 가 연결되지 않아 대본만 만들었어요. 핵심 구간은 직접 고를 수 있어요.');
    try { Object.assign(data, await pick(data.transcript, v.duration), { edited: false }); write(v.id, data); mark(v, data, 'ready', data.points.length ? '' : 'AI 가 핵심 구간을 고르지 못했어요.'); }
    catch (e) { mark(v, data, 'ready', 'AI 가 핵심을 고르지 못했어요: ' + oneLine(e.message, 150)); }
  }

  async function pump() {
    if (busy) return; busy = true;
    while (queue.length) {
      const job = queue.shift(), v = store.video(job.id);
      if (!v || v.status !== 'ready') continue;
      try { await work(v, job); } catch (e) { mark(v, read(v.id), 'failed', oneLine(e.message, 200)); }
    }
    busy = false;
  }

  return {
    sttReady, llmOn, read, parseSubs, toVtt,
    enqueue(id, opt = {}) { const v = store.video(id); if (!v) return; if (!queue.some((j) => j.id === id)) queue.push({ id, ...opt }); v.insight = 'queued'; store.save(); pump(); },
    // 영상을 잘라 시간이 달라졌으면 처음부터 다시 만든다.
    reset(v) { try { fs.unlinkSync(file(v.id)); } catch { } texts.delete(v.id); mark(v, null, 'none'); },
    remove(id) { fs.unlink(file(id), () => { }); texts.delete(id); },
    // 사람이 고친 요약·핵심 구간을 저장
    edit(v, body) { const data = read(v.id) || { transcript: [], summary: '', points: [] }; data.summary = oneLine(body.summary, 400); data.points = cleanPoints(body.points, v.duration); data.edited = true; write(v.id, data); mark(v, data, 'ready'); return data; },
    setSubs(v, text) { const segs = parseSubs(text); if (!segs.length) return null; const data = read(v.id) || { summary: '', points: [], edited: false }; data.transcript = segs; data.fromFile = true; write(v.id, data); mark(v, data, v.insight || 'none'); return data; },
    // 검색용: 말한 내용 전체(소문자)
    textOf(id) { if (!texts.has(id)) { const d = read(id); texts.set(id, d && d.transcript ? d.transcript.map((x) => x.t).join(' ').toLowerCase() : ''); } return texts.get(id); },
    idle: () => !busy && queue.length === 0
  };
}

module.exports = { createInsight, parseSubs, toVtt, cleanPoints };
