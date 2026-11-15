/* 순수TV 화면. 경로는 모두 상대 경로(런처의 /module/sunsutv/ 아래에서도 동작). 로그인이 없어 시청 기록·나중에 볼 영상·좋아요 표시는 이 브라우저에 기억한다. */
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opt) => { const r = await fetch(url, opt); const j = await r.json().catch(() => ({ ok: false, message: r.statusText })); if (!r.ok || j.ok === false) throw Object.assign(new Error(j.message || '요청 실패'), { status: r.status, body: j }); return j; };
const send = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
const ago = (iso) => { const d = (Date.now() - new Date(iso)) / 1000; if (d < 60) return '방금'; if (d < 3600) return Math.floor(d / 60) + '분 전'; if (d < 86400) return Math.floor(d / 3600) + '시간 전'; if (d < 86400 * 30) return Math.floor(d / 86400) + '일 전'; return new Date(iso).toLocaleDateString('ko-KR'); };
const gb = (b) => (b / 1024 ** 3).toFixed(b > 10 * 1024 ** 3 ? 0 : 1) + ' GB', mb = (b) => b > 1024 ** 3 ? gb(b) : (b / 1024 ** 2).toFixed(0) + ' MB';
const ls = { get: (k, d) => { try { const v = localStorage.getItem('sunsutv.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('sunsutv.' + k, JSON.stringify(v)); } catch { } } };
let meta = { categories: [] }, state = { q: '', cat: '', sort: 'new', all: false }, poll = null, keyHandler = null, nextTimer = null;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2200); }
const thumbUrl = (v) => (v.yt ? `https://i.ytimg.com/vi/${v.yt}/hqdefault.jpg` : `thumb/${v.id}.jpg?v=${v.thumbVer || 0}`);

/* ---------- 카드 ---------- */
function card(v, opt = {}) {
  const bg = v.thumb ? `style="background-image:url('${thumbUrl(v)}')"` : '';
  const st = v.status === 'processing' ? '<span class="state">⏳ 변환 중…</span>' : v.status === 'failed' ? '<span class="state">⚠ 변환 실패</span>' : (v.thumb ? '' : '<span class="state">▶</span>');
  const pos = ls.get('pos', {})[v.id], prog = pos && v.duration ? `<span class="prog" style="width:${Math.min(100, pos / v.duration * 100).toFixed(0)}%"></span>` : '';
  const badge = v.visibility === 'unlisted' ? '<span class="badge">링크로만</span>' : v.hidden ? '<span class="badge">숨김</span>' : v.kind === 'link' ? '<span class="badge yt">▶ 유튜브</span>' : '';
  return `<a class="card ${opt.cur ? 'cur' : ''}" href="#/v/${v.id}${opt.list ? '?list=' + opt.list : ''}">${opt.remove ? `<button class="x" data-remove="${v.id}" title="${opt.remove}">✕</button>` : ''}
    <div class="thumb" ${bg}>${st}${badge}${v.duration ? `<span class="dur">${dur(v.duration)}</span>` : ''}${v.summary ? `<span class="sumov">${esc(v.summary)}</span>` : ''}${prog}</div>
    <div><h3>${esc(v.title)}</h3><div class="meta">${esc(v.category)} · 조회수 ${v.views}회 · ${ago(v.created)}${v.coreSec ? ` · ⚡ 핵심 ${dur(v.coreSec)}` : ''}</div>${v.hits && v.hits[0] ? `<div class="hitline"><b>${dur(v.hits[0].s)}</b> “${esc(v.hits[0].t)}”</div>` : ''}</div></a>`;
}
const grid = (videos, emptyTitle, emptySub, opt) => videos.length ? `<div class="grid">${videos.map((v) => card(v, opt)).join('')}</div>` : `<div class="empty"><b>${emptyTitle}</b>${emptySub || ''}</div>`;

/* ---------- 홈 · 인기 · 태그 ---------- */
const shelf = (title, videos, more) => videos.length ? `<section class="shelf"><h2>${more ? `<a ${more}>${esc(title)} <span>모두 보기 ›</span></a>` : esc(title)}</h2>
  <div class="rail"><button class="arrow l" title="앞으로">‹</button><div class="rowlist">${videos.map((v) => card(v)).join('')}</div><button class="arrow r" title="뒤로">›</button></div></section>` : '';
async function shelves() {
  const { videos } = await api('api/videos?sort=new');
  if (!videos.length) { $('#view').innerHTML = '<div class="empty"><b>아직 영상이 없어요</b>첫 영상을 올려 보세요.</div>'; return; }
  const ready = videos.filter((v) => v.status === 'ready' && v.kind !== 'link'), pos = ls.get('pos', {});   // 큰 화면과 이어 보기는 우리 서버에 있는 영상만
  const pop = ready.filter((v) => v.weekViews > 0).sort((a, b) => b.weekViews - a.weekViews || b.views - a.views).slice(0, 20), h = pop[0] || ready[0];
  const later = h && ls.get('later', []).includes(h.id);
  // 큰 화면: 가로 끝까지 16:9. 영상이 소리 없이 흐르고, 설명은 화면 오른쪽 위에 자막처럼 얹는다.
  const hero = h ? `<section class="hero"><a class="scr" href="#/v/${h.id}" ${h.thumb ? `style="background-image:url('${thumbUrl(h)}')"` : ''}>
      <video id="heroVid" muted loop playsinline preload="metadata" src="media/${h.id}${h.low ? '_360' : ''}.mp4?v=${h.thumbVer || 0}#t=${h.pts && h.pts[0] ? Math.floor(h.pts[0].s) : 0}"></video></a>
    <div class="cap"><span class="kicker">${pop[0] ? '이번 주 가장 많이 본 영상' : '새로 올라온 영상'}</span><h1>${esc(h.title)}</h1>
      ${h.summary || h.desc ? `<p>${esc(h.summary || h.desc)}</p>` : ''}<div class="info">${esc(h.category)} · 조회수 ${h.views}회 · ${ago(h.created)} · ${dur(h.duration)}</div>
      <div class="btns"><a class="btn primary" href="#/v/${h.id}">▶ 재생</a>${h.coreSec ? `<a class="btn" href="#/v/${h.id}?core=1">⚡ 핵심만 보기 (${dur(h.coreSec)})</a>` : ''}<button id="heroLater" class="btn ${later ? 'on' : ''}">${later ? '✓ 담김' : '＋ 나중에 보기'}</button></div></div></section>` : '';
  $('#view').innerHTML = hero + `<div class="chips">${['', ...meta.categories].map((c) => `<button data-cat="${esc(c)}" aria-pressed="${c === ''}">${esc(c) || '전체'}</button>`).join('')}</div>`
    + shelf('이어 보기', ready.filter((v) => pos[v.id])) + shelf('이번 주 인기', pop, 'href="#/popular"') + shelf('새로 올라온 영상', videos.slice(0, 20), 'data-all')
    + meta.categories.map((c) => shelf(c, videos.filter((v) => v.category === c).slice(0, 20), `data-cat="${esc(c)}"`)).join('');
  if ($('#heroVid')) $('#heroVid').play().catch(() => { });
  $$('[data-cat]').forEach((b) => b.onclick = () => { state.cat = b.dataset.cat; home(); window.scrollTo(0, 0); });
  $$('[data-all]').forEach((b) => b.onclick = () => { state.all = true; home(); window.scrollTo(0, 0); });
  $$('.rail').forEach((r) => { const list = $('.rowlist', r), upd = () => { $('.arrow.l', r).hidden = list.scrollLeft < 5; $('.arrow.r', r).hidden = list.scrollLeft + list.clientWidth > list.scrollWidth - 5; };
    $('.arrow.l', r).onclick = () => list.scrollBy({ left: -list.clientWidth * 0.8, behavior: 'smooth' }); $('.arrow.r', r).onclick = () => list.scrollBy({ left: list.clientWidth * 0.8, behavior: 'smooth' }); list.onscroll = upd; upd(); });
  if ($('#heroLater')) $('#heroLater').onclick = () => { const l = ls.get('later', []), on = l.includes(h.id); ls.set('later', on ? l.filter((x) => x !== h.id) : [h.id, ...l]); $('#heroLater').classList.toggle('on', !on); $('#heroLater').textContent = on ? '＋ 나중에 보기' : '✓ 담김'; };
  if (videos.some((v) => v.status === 'processing')) poll = setInterval(() => route(true), 4000);
}
async function home(kind, tag) {
  if (!kind && !tag && !state.q && !state.cat && !state.all) return shelves();
  const p = new URLSearchParams();
  if (kind === 'popular') p.set('sort', 'week'); else { if (state.q) p.set('q', state.q); if (state.cat) p.set('cat', state.cat); p.set('sort', state.sort); }
  if (tag) p.set('tag', tag);
  const { videos } = await api('api/videos?' + p);
  let head = '';
  if (kind === 'popular') head = '<h1 class="page">🔥 인기 영상</h1><p class="sub">최근 7일 동안 많이 본 순서예요.</p>';
  else if (tag) head = `<h1 class="page">#${esc(tag)}</h1>`;
  else head = `<div class="chips">${['', ...meta.categories].map((c) => `<button data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c) || '전체'}</button>`).join('')}<span class="sp"></span>
    <select id="sort"><option value="new">최신순</option><option value="views">조회순</option><option value="likes">좋아요순</option></select></div>${state.q ? `<p class="sub">"${esc(state.q)}" 검색 결과 ${videos.length}개</p>` : ''}`;
  $('#view').innerHTML = head + grid(kind === 'popular' ? videos.filter((v) => v.weekViews > 0).slice(0, 40) : videos, state.q || state.cat || tag ? '찾는 영상이 없어요' : kind === 'popular' ? '아직 본 영상이 없어요' : '아직 영상이 없어요', state.q || state.cat || tag || kind ? '' : '첫 영상을 올려 보세요.');
  if ($('#sort')) { $('#sort').value = state.sort; $('#sort').onchange = (e) => { state.sort = e.target.value; home(); }; }
  $$('[data-cat]').forEach((b) => b.onclick = () => { state.cat = b.dataset.cat; if (!b.dataset.cat) { state.all = false; state.q = ''; $('#q').value = ''; } home(); });
  if (videos.some((v) => v.status === 'processing')) poll = setInterval(() => route(true), 4000);
}

/* ---------- 시청 기록 · 나중에 볼 영상 ---------- */
async function localList(key, title, emptySub) {
  const ids = key === 'history' ? ls.get('history', []).map((h) => h.id) : ls.get('later', []);
  const { videos } = ids.length ? await api('api/videos?ids=' + ids.join(',')) : { videos: [] };
  $('#view').innerHTML = `<h1 class="page">${title}</h1><div class="chips"><span class="meta">이 브라우저에만 기억돼요.</span><span class="sp"></span>${ids.length ? '<button id="clearAll" class="small">모두 지우기</button>' : ''}</div>` + grid(videos, '아직 없어요', emptySub, { remove: '목록에서 빼기' });
  $$('[data-remove]').forEach((b) => b.onclick = (e) => { e.preventDefault(); if (key === 'history') ls.set('history', ls.get('history', []).filter((h) => h.id !== b.dataset.remove)); else ls.set('later', ls.get('later', []).filter((id) => id !== b.dataset.remove)); route(); });
  if ($('#clearAll')) $('#clearAll').onclick = () => { if (confirm('모두 지울까요?')) { ls.set(key, []); route(); } };
}

/* ---------- 재생 목록 ---------- */
async function playlistsPage() {
  const { playlists } = await api('api/playlists');
  $('#view').innerHTML = `<h1 class="page">📚 재생 목록</h1><div class="chips"><span class="sp"></span><button id="newPl" class="primary">＋ 새 재생 목록</button></div>` +
    (playlists.length ? `<div class="grid">${playlists.map((p) => `<a class="card" href="#/pl/${p.id}"><div class="thumb" ${p.cover ? `style="background-image:url('thumb/${p.cover}.jpg')"` : ''}><span class="dur">영상 ${p.count}개</span></div><div><h3>${esc(p.title)}</h3><div class="meta">${dur(p.duration)} · ${ago(p.created)}</div></div></a>`).join('')}</div>`
      : '<div class="empty"><b>재생 목록이 없어요</b>영상을 묶어 순서대로 볼 수 있어요.</div>');
  $('#newPl').onclick = async () => { const t = prompt('재생 목록 이름'); if (!t) return; try { const r = await api('api/playlists', send('POST', { title: t })); location.hash = '#/pl/' + r.playlist.id; } catch (e) { alert(e.message); } };
}
async function playlistPage(id) {
  const { playlist: p } = await api('api/playlists/' + id);
  $('#view').innerHTML = `<h1 class="page">${esc(p.title)}</h1><p class="sub">${esc(p.desc)} 영상 ${p.count}개 · ${dur(p.duration)}</p>
    <div class="chips">${p.videos.length ? `<a href="#/v/${p.videos[0].id}?list=${p.id}"><button class="primary">▶ 처음부터 재생</button></a>` : ''}<span class="sp"></span><button id="plEdit" class="small">이름·설명 고치기</button><button id="plDel" class="small">재생 목록 지우기</button></div>` +
    (p.videos.length ? p.videos.map((v, i) => `<div class="plrow"><span class="n">${i + 1}</span><a href="#/v/${v.id}?list=${p.id}"><div class="thumb" ${v.thumb ? `style="background-image:url('${thumbUrl(v)}')"` : ''}><span class="dur">${dur(v.duration)}</span></div></a>
      <a href="#/v/${v.id}?list=${p.id}"><b>${esc(v.title)}</b><div class="meta">${esc(v.category)} · 조회수 ${v.views}회</div></a>
      <span><button class="small" data-up="${i}" ${i ? '' : 'disabled'}>▲</button> <button class="small" data-down="${i}" ${i < p.videos.length - 1 ? '' : 'disabled'}>▼</button> <button class="small" data-out="${v.id}">빼기</button></span></div>`).join('')
      : '<div class="empty"><b>아직 영상이 없어요</b>영상 보기 화면의 "재생 목록에 담기"로 넣으세요.</div>');
  const order = p.videos.map((v) => v.id), reorder = async (i, j) => { [order[i], order[j]] = [order[j], order[i]]; await api('api/playlists/' + id, send('PATCH', { videos: order })); route(); };
  $$('[data-up]').forEach((b) => b.onclick = () => reorder(+b.dataset.up, +b.dataset.up - 1)); $$('[data-down]').forEach((b) => b.onclick = () => reorder(+b.dataset.down, +b.dataset.down + 1));
  $$('[data-out]').forEach((b) => b.onclick = async () => { await api(`api/playlists/${id}/videos/${b.dataset.out}`, { method: 'DELETE' }); route(); });
  $('#plEdit').onclick = async () => { const t = prompt('이름', p.title); if (t === null) return; const d = prompt('설명', p.desc); if (d === null) return; try { await api('api/playlists/' + id, send('PATCH', { title: t, desc: d })); route(); } catch (e) { alert(e.message); } };
  $('#plDel').onclick = async () => { if (confirm(`'${p.title}' 재생 목록을 지울까요? 영상은 지워지지 않아요.`)) { await api('api/playlists/' + id, { method: 'DELETE' }); location.hash = '#/playlists'; } };
}

/* ---------- 편집실: 필요한 부분만 남기기. 타임라인에서 남길 구간을 고르면 그 부분만 이어 붙인다(나머지는 저장하지 않는다) ---------- */
const tf = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const tp = (x) => { const a = String(x).trim().split(':').map(Number); return a.length && a.every((n) => Number.isFinite(n)) ? a.reduce((q, n) => q * 60 + n, 0) : NaN; };
const whenDur = (V) => new Promise((ok) => { const go = () => { if (Number.isFinite(V.duration)) return ok(); const h = () => { if (Number.isFinite(V.duration)) { V.removeEventListener('durationchange', h); V.currentTime = 0; ok(); } }; V.addEventListener('durationchange', h); V.currentTime = 1e101; };
  if (V.readyState >= 1) go(); else V.addEventListener('loadedmetadata', go, { once: true }); });
function rangeEditor({ src, title, points, initial }) {
  return new Promise((resolve) => {
    const d = $('#dlg'); d.classList.add('studio');
    d.innerHTML = `<div class="st-top"><b class="st-logo">✂ 편집실</b><span class="st-title">${esc(title || '')}</span><span class="sp"></span><span id="edMsg" class="msg"></span><button id="edCancel" class="ghost">취소</button><button id="edOk" class="primary" disabled>이대로 남기기</button></div>
      <div class="st-main"><div class="st-stage"><video id="edV" playsinline preload="auto" src="${src}"></video></div>
        <aside class="st-side"><header><b>남길 구간</b><span class="sp"></span>${points && points.length ? '<button id="edCore" class="small">⚡ 핵심으로 채우기</button>' : ''}<button id="edClear" class="small">비우기</button></header>
          <div id="edList"></div><p class="st-help"><kbd>I</kbd> 여기부터 <kbd>O</kbd> 여기까지 <kbd>Space</kbd> 재생<br><kbd>←</kbd><kbd>→</kbd> 1초 <kbd>,</kbd><kbd>.</kbd> 한 장면 <kbd>Del</kbd> 구간 빼기</p></aside></div>
      <div class="st-bar"><button id="edBack" title="5초 뒤로">−5초</button><button id="edFp" title="한 장면 뒤로 (,)">◂</button><button id="edPlay" class="play" title="재생 / 멈춤 (Space)">▶</button><button id="edFn" title="한 장면 앞으로 (.)">▸</button><button id="edFwd" title="5초 앞으로">+5초</button>
        <span class="tc"><b id="edTc">0:00.0</b> / <span id="edDur">0:00.0</span></span><select id="edRate" title="재생 속도">${[0.5, 1, 1.5, 2, 4].map((r) => `<option value="${r}" ${r === 1 ? 'selected' : ''}>${r}배</option>`).join('')}</select><button id="edMute" title="소리">🔊</button>
        <span class="sp"></span><button id="edIn" class="mark" title="지금 장면을 시작으로 (I)">[ 여기부터</button><button id="edOut" class="mark" title="지금 장면을 끝으로 (O)">여기까지 ]</button><button id="edPrev" title="남길 부분만 이어서 재생">남길 부분만 미리 보기</button></div>
      <div class="st-time"><div id="edRuler" class="ruler"></div><div id="edStrip" class="track"><div id="edFilm" class="film"></div><div id="edRanges"></div><i id="edPos"></i></div></div>`;
    const V = $('#edV', d), track = $('#edStrip', d); let ranges = (initial || []).map((r) => ({ s: r.s, e: r.e })), pend = null, preview = false, settled = false, sel = -1, drag = null, raf = 0;
    const total = () => (Number.isFinite(V.duration) ? V.duration : 0), pc = (t) => (total() ? t / total() * 100 : 0);
    const norm = () => { const out = []; for (const r of ranges.filter((x) => x.e > x.s + 0.3).sort((a, b) => a.s - b.s)) { const q = out[out.length - 1]; if (q && r.s <= q.e) q.e = Math.max(q.e, r.e); else out.push(r); } ranges = out; if (sel >= ranges.length) sel = -1; };
    const drawRanges = () => { const T = total(); let h = '', prev = 0;
      if (ranges.length) { for (const r of ranges) { if (r.s > prev) h += `<s style="left:${pc(prev)}%;width:${pc(r.s - prev)}%"></s>`; prev = r.e; } if (prev < T) h += `<s style="left:${pc(prev)}%;width:${pc(T - prev)}%"></s>`; }
      h += ranges.map((r, i) => `<div class="rg ${i === sel ? 'sel' : ''}" data-i="${i}" style="left:${pc(r.s)}%;width:${pc(r.e - r.s)}%"><span class="h" data-edge="s"></span><em>${i + 1}</em><span class="h r" data-edge="e"></span></div>`).join('');
      if (pend != null) h += `<u style="left:${pc(pend)}%"></u>`; $('#edRanges', d).innerHTML = h; };
    const status = () => { const T = total(), keep = ranges.reduce((n, r) => n + r.e - r.s, 0); $('#edMsg', d).className = 'msg';
      $('#edMsg', d).textContent = pend != null ? `시작 ${tf(pend)} 을 잡았어요. 끝나는 곳에서 "여기까지"를 누르세요.` : ranges.length ? `남는 길이 ${dur(keep)} / 전체 ${dur(T)} · 고르지 않은 ${dur(Math.max(0, T - keep))} 는 저장하지 않아요.` : '아직 고른 구간이 없어요.';
      $('#edOk', d).disabled = !ranges.length; $('#edPrev', d).disabled = !ranges.length; $('#edPrev', d).classList.toggle('on', preview); $('#edIn', d).classList.toggle('on', pend != null); };
    const drawList = () => { $('#edList', d).innerHTML = ranges.map((r, i) => `<div class="edrow ${i === sel ? 'sel' : ''}" data-i="${i}"><b>${i + 1}</b><input class="tcin" data-k="s" value="${tf(r.s)}" title="시작 (분:초)"><span>→</span><input class="tcin" data-k="e" value="${tf(r.e)}" title="끝 (분:초)"><span class="len">${dur(r.e - r.s)}</span><span class="sp"></span><button class="small" data-go="${i}" title="이 구간 보기">▶</button><button class="small" data-del="${i}" title="이 구간 빼기">✕</button></div>`).join('')
        || '<p class="st-empty">영상을 보면서 남길 곳의 시작에서 <b>[ 여기부터</b>, 끝에서 <b>여기까지 ]</b> 를 누르세요. 여러 번 고를 수 있어요.</p>';
      $$('#edList [data-go]', d).forEach((b) => b.onclick = () => { sel = +b.dataset.go; preview = false; V.currentTime = ranges[sel].s; V.play().catch(() => { }); draw(); });
      $$('#edList [data-del]', d).forEach((b) => b.onclick = () => { ranges.splice(+b.dataset.del, 1); sel = -1; if (!ranges.length) preview = false; draw(); });
      $$('#edList .tcin', d).forEach((inp) => inp.onchange = () => { const r = ranges[+inp.parentElement.dataset.i], t = tp(inp.value); if (Number.isFinite(t)) { r[inp.dataset.k] = Math.max(0, Math.min(total(), t)); if (r.e <= r.s + 0.3) { if (inp.dataset.k === 's') r.s = Math.max(0, r.e - 0.5); else r.e = Math.min(total(), r.s + 0.5); } norm(); } draw(); }); };
    const draw = () => { drawRanges(); drawList(); status(); };
    const ruler = () => { const T = total(), step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((x) => T / x <= 12) || 3600; let h = ''; for (let t = 0; t <= T; t += step) h += `<span style="left:${pc(t)}%">${dur(t)}</span>`; $('#edRuler', d).innerHTML = h; $('#edDur', d).textContent = tf(T); };
    const ev = (el, name) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('timeout')), 8000); el.addEventListener(name, () => { clearTimeout(t); ok(); }, { once: true }); el.addEventListener('error', () => { clearTimeout(t); no(new Error('error')); }, { once: true }); });
    const film = async () => { const box = $('#edFilm', d), n = Math.max(6, Math.min(24, Math.round(box.clientWidth / 96))), tv = document.createElement('video'); tv.muted = true; tv.preload = 'auto'; tv.src = src;
      try { await ev(tv, 'loadeddata'); for (let k = 0; k < n && !settled; k++) { tv.currentTime = (k + 0.5) / n * total(); await ev(tv, 'seeked'); const c = document.createElement('canvas'); c.width = 160; c.height = 90; c.getContext('2d').drawImage(tv, 0, 0, 160, 90); box.appendChild(c); } } catch { } tv.removeAttribute('src'); tv.load(); };
    const warn = (t) => { $('#edMsg', d).className = 'msg bad'; $('#edMsg', d).textContent = t; };
    const seek = (t) => { preview = false; V.currentTime = Math.max(0, Math.min(total(), t)); status(); };
    const toggle = () => (V.paused ? V.play().catch(() => { }) : V.pause());
    const markIn = () => { pend = V.currentTime; draw(); };
    const markOut = () => { if (pend == null) return warn('먼저 시작하는 곳에서 "여기부터"를 눌러 주세요.'); if (V.currentTime <= pend + 0.3) return warn('끝이 시작보다 뒤여야 해요. 영상을 더 뒤로 옮긴 뒤 누르세요.'); const r = { s: pend, e: V.currentTime }; ranges.push(r); pend = null; norm(); sel = ranges.findIndex((x) => x.s <= r.s && x.e >= r.e); draw(); };
    const togglePrev = () => { if (!ranges.length) return; preview = !preview; if (preview) { V.currentTime = ranges[0].s; V.play().catch(() => { }); } status(); };
    const onKey = (e) => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.toLowerCase(), f = 1 / 30;
      const map = { ' ': toggle, k: toggle, i: markIn, o: markOut, p: togglePrev, arrowleft: () => seek(V.currentTime - (e.shiftKey ? 5 : 1)), arrowright: () => seek(V.currentTime + (e.shiftKey ? 5 : 1)), ',': () => { V.pause(); seek(V.currentTime - f); }, '.': () => { V.pause(); seek(V.currentTime + f); },
        delete: () => { if (sel >= 0) { ranges.splice(sel, 1); sel = -1; draw(); } }, backspace: () => { if (sel >= 0) { ranges.splice(sel, 1); sel = -1; draw(); } } };
      if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); } };
    const finish = (val) => { if (settled) return; settled = true; cancelAnimationFrame(raf); d.removeEventListener('keydown', onKey); V.pause(); V.removeAttribute('src'); V.load(); d.classList.remove('studio'); if (d.open) d.close(); resolve(val); };
    const tick = () => { if (settled) return; const t = V.currentTime; $('#edPos', d).style.left = pc(t) + '%'; $('#edTc', d).textContent = tf(t); $('#edPlay', d).textContent = V.paused ? '▶' : '❚❚';
      if (preview && !V.seeking && !V.paused && !ranges.some((r) => t >= r.s - 0.05 && t < r.e)) { const nx = ranges.find((r) => r.s > t); if (nx) V.currentTime = nx.s; else { V.pause(); preview = false; status(); } }
      raf = requestAnimationFrame(tick); };
    // 타임라인: 누르거나 끌어서 위치 옮기기, 구간 양쪽 손잡이를 끌어 길이 조절
    const move = (e) => { const b = track.getBoundingClientRect(), T = total(), t = Math.max(0, Math.min(T, (e.clientX - b.left) / b.width * T));
      if (drag.scrub) { preview = false; V.currentTime = t; return; } const r = ranges[drag.i];
      if (drag.edge === 's') r.s = Math.max(drag.i ? ranges[drag.i - 1].e : 0, Math.min(t, r.e - 0.5)); else r.e = Math.min(ranges[drag.i + 1] ? ranges[drag.i + 1].s : T, Math.max(t, r.s + 0.5));
      V.currentTime = r[drag.edge]; draw(); };
    track.onpointerdown = (e) => { if (!total()) return; const h = e.target.closest('.h'), rg = e.target.closest('.rg'); track.setPointerCapture(e.pointerId); V.pause();
      if (h) { drag = { i: +rg.dataset.i, edge: h.dataset.edge }; sel = drag.i; } else { drag = { scrub: true }; sel = rg ? +rg.dataset.i : -1; draw(); } move(e); };
    track.onpointermove = (e) => { if (drag) move(e); }; track.onpointerup = track.onpointercancel = () => { drag = null; };
    $('#edIn', d).onclick = markIn; $('#edOut', d).onclick = markOut; $('#edPrev', d).onclick = togglePrev; $('#edPlay', d).onclick = toggle; V.onclick = toggle;
    $('#edBack', d).onclick = () => seek(V.currentTime - 5); $('#edFwd', d).onclick = () => seek(V.currentTime + 5); $('#edFp', d).onclick = () => { V.pause(); seek(V.currentTime - 1 / 30); }; $('#edFn', d).onclick = () => { V.pause(); seek(V.currentTime + 1 / 30); };
    $('#edRate', d).onchange = (e) => { V.playbackRate = +e.target.value; }; $('#edMute', d).onclick = () => { V.muted = !V.muted; $('#edMute', d).textContent = V.muted ? '🔇' : '🔊'; };
    if ($('#edCore', d)) $('#edCore', d).onclick = () => { ranges = points.map((x) => ({ s: x.s, e: x.e })); pend = null; sel = -1; norm(); draw(); };
    $('#edClear', d).onclick = () => { ranges = []; pend = null; preview = false; sel = -1; draw(); };
    whenDur(V).then(() => { if (!settled) { ruler(); draw(); film(); } });
    V.addEventListener('error', () => { warn('이 파일은 여기서 미리 볼 수 없어요. 그대로 올린 뒤 영상 화면의 "편집"에서 골라 주세요.'); $('#edIn', d).disabled = $('#edOut', d).disabled = true; });
    $('#edCancel', d).onclick = () => finish(null);
    $('#edOk', d).onclick = () => { norm(); finish(ranges.map((r) => ({ s: +r.s.toFixed(2), e: +r.e.toFixed(2) }))); };
    d.addEventListener('close', () => finish(null), { once: true }); d.addEventListener('keydown', onKey);
    d.showModal(); draw(); tick();
  });
}

/* ---------- 가리기: 화면 위에 네모를 그려 그 부분을 모자이크로 가린다(얼굴, 번호판, 개인정보) ---------- */
function blurEditor({ src, title }) {
  return new Promise((resolve) => {
    const d = $('#dlg'); d.classList.add('studio');
    d.innerHTML = `<div class="st-top"><b class="st-logo">▦ 가리기</b><span class="st-title">${esc(title || '')}</span><span class="sp"></span><span id="blMsg" class="msg"></span><button id="blCancel" class="ghost">취소</button><button id="blOk" class="primary" disabled>이대로 가리기</button></div>
      <div class="st-main"><div class="st-stage" id="blStage"><div id="blWrap" class="bl-wrap"><video id="blV" playsinline preload="auto" src="${src}"></video><div id="blLayer" class="bl-layer"></div></div></div>
        <aside class="st-side"><header><b>가릴 곳</b><span class="sp"></span><button id="blClear" class="small">비우기</button></header><div id="blList"></div>
          <p class="st-help">화면 위에서 마우스로 끌어 네모를 그리세요.<br>네모를 끌면 옮겨지고, 가릴 시간도 정할 수 있어요.</p></aside></div>
      <div class="st-bar"><button id="blPlay" class="play" title="재생 / 멈춤 (Space)">▶</button><span class="tc"><b id="blTc">0:00.0</b> / <span id="blDur">0:00.0</span></span><input id="blSeek" type="range" min="0" max="1000" value="0"></div>`;
    const V = $('#blV', d), layer = $('#blLayer', d), wrap = $('#blWrap', d); let boxes = [], sel = -1, drag = null, settled = false, raf = 0, seeking = false;
    const total = () => (Number.isFinite(V.duration) ? V.duration : 0), on = (b, t) => t >= b.s && (b.e == null || t <= b.e);
    const fit = () => { const st = $('#blStage', d).getBoundingClientRect(), a = (V.videoWidth || 16) / (V.videoHeight || 9), w = Math.min(st.width - 28, (st.height - 28) * a); wrap.style.width = w + 'px'; wrap.style.height = w / a + 'px'; };
    const drawBoxes = () => { const t = V.currentTime; layer.innerHTML = boxes.map((b, i) => `<div class="bx ${i === sel ? 'sel' : ''} ${on(b, t) ? '' : 'off'}" data-i="${i}" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"><em>${i + 1}</em></div>`).join(''); };
    const drawList = () => { $('#blList', d).innerHTML = boxes.map((b, i) => `<div class="edrow blrow ${i === sel ? 'sel' : ''}" data-i="${i}"><b>${i + 1}</b><span class="when">${b.s === 0 && b.e == null ? '영상 전체' : `${tf(b.s)} → ${b.e == null ? '끝' : tf(b.e)}`}</span><span class="sp"></span>
        <button class="small" data-k="s" title="지금 장면부터 가리기">여기부터</button><button class="small" data-k="e" title="지금 장면까지 가리기">여기까지</button><button class="small" data-k="all" title="영상 전체에서 가리기">전체</button><button class="small" data-k="del" title="빼기">✕</button></div>`).join('')
        || '<p class="st-empty">가리고 싶은 곳(얼굴, 번호판, 화면 속 개인정보)을 <b>화면 위에서 끌어</b> 네모로 표시하세요.</p>';
      $$('#blList [data-k]', d).forEach((bt) => bt.onclick = () => { const i = +bt.parentElement.dataset.i, b = boxes[i], k = bt.dataset.k, t = +V.currentTime.toFixed(2); sel = i;
        if (k === 'del') { boxes.splice(i, 1); sel = -1; } else if (k === 'all') { b.s = 0; b.e = null; } else if (k === 's') { b.s = t; if (b.e != null && b.e <= t) b.e = null; } else { if (t <= b.s) { b.s = 0; } b.e = t; }
        draw(); });
      $('#blMsg', d).className = 'msg'; $('#blMsg', d).textContent = boxes.length ? `${boxes.length}곳을 모자이크로 가려요. 적용하면 되돌릴 수 없어요.` : '아직 그린 곳이 없어요.'; $('#blOk', d).disabled = !boxes.length; };
    const draw = () => { drawBoxes(); drawList(); };
    const at = (e) => { const r = layer.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
    layer.onpointerdown = (e) => { const bx = e.target.closest('.bx'), [x, y] = at(e); layer.setPointerCapture(e.pointerId); V.pause();
      if (bx) { sel = +bx.dataset.i; const b = boxes[sel]; drag = { move: true, dx: x - b.x, dy: y - b.y }; } else { boxes.push({ x, y, w: 0, h: 0, s: 0, e: null }); sel = boxes.length - 1; drag = { x0: x, y0: y }; } draw(); };
    layer.onpointermove = (e) => { if (!drag) return; const [x, y] = at(e), b = boxes[sel];
      if (drag.move) { b.x = Math.max(0, Math.min(1 - b.w, x - drag.dx)); b.y = Math.max(0, Math.min(1 - b.h, y - drag.dy)); } else { b.x = Math.min(x, drag.x0); b.y = Math.min(y, drag.y0); b.w = Math.abs(x - drag.x0); b.h = Math.abs(y - drag.y0); } drawBoxes(); };
    layer.onpointerup = layer.onpointercancel = () => { if (drag && !drag.move && (boxes[sel].w < 0.015 || boxes[sel].h < 0.015)) { boxes.splice(sel, 1); sel = -1; } drag = null; draw(); };
    const toggle = () => (V.paused ? V.play().catch(() => { }) : V.pause());
    const onKey = (e) => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return; const k = e.key.toLowerCase();
      const map = { ' ': toggle, k: toggle, arrowleft: () => { V.currentTime = Math.max(0, V.currentTime - 1); }, arrowright: () => { V.currentTime = Math.min(total(), V.currentTime + 1); }, delete: () => { if (sel >= 0) { boxes.splice(sel, 1); sel = -1; draw(); } } };
      if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); } };
    const finish = (val) => { if (settled) return; settled = true; cancelAnimationFrame(raf); window.removeEventListener('resize', fit); d.removeEventListener('keydown', onKey); V.pause(); V.removeAttribute('src'); V.load(); d.classList.remove('studio'); if (d.open) d.close(); resolve(val); };
    let lastOn = '';
    const tick = () => { if (settled) return; const t = V.currentTime; $('#blTc', d).textContent = tf(t); $('#blPlay', d).textContent = V.paused ? '▶' : '❚❚'; if (!seeking && total()) $('#blSeek', d).value = Math.round(t / total() * 1000);
      const now = boxes.map((b) => (on(b, t) ? 1 : 0)).join(''); if (now !== lastOn && !drag) { lastOn = now; drawBoxes(); } raf = requestAnimationFrame(tick); };
    $('#blPlay', d).onclick = toggle; $('#blClear', d).onclick = () => { boxes = []; sel = -1; draw(); };
    $('#blSeek', d).oninput = (e) => { seeking = true; V.currentTime = e.target.value / 1000 * total(); }; $('#blSeek', d).onchange = () => { seeking = false; };
    whenDur(V).then(() => { if (settled) return; $('#blDur', d).textContent = tf(total()); fit(); draw(); });
    V.addEventListener('error', () => { $('#blMsg', d).className = 'msg bad'; $('#blMsg', d).textContent = '영상을 불러오지 못했어요.'; });
    window.addEventListener('resize', fit);
    $('#blCancel', d).onclick = () => finish(null);
    $('#blOk', d).onclick = () => finish(boxes.map((b) => ({ x: +b.x.toFixed(4), y: +b.y.toFixed(4), w: +b.w.toFixed(4), h: +b.h.toFixed(4), s: b.s, ...(b.e == null ? {} : { e: b.e }) })));
    d.addEventListener('close', () => finish(null), { once: true }); d.addEventListener('keydown', onKey);
    d.showModal(); fit(); draw(); tick();
  });
}

/* ---------- 보기 화면 ---------- */
function dialog(html) { const d = $('#dlg'); d.innerHTML = html; d.showModal(); $$('[data-close]', d).forEach((b) => b.onclick = () => d.close()); return d; }
function comments(list) {
  const liked = ls.get('cliked', {}), one = (c, reply) => `<div class="comment ${reply ? 'reply' : ''}"><span class="when">${ago(c.created)}</span><div>${c.at != null ? `<a class="at" data-at="${c.at}">${dur(c.at)}</a>` : ''}${esc(c.text)}</div>
    <div class="ops"><button class="small ${liked[c.id] ? 'on' : ''}" data-clike="${c.id}">👍 ${c.likes || 0}</button>${reply ? '' : `<button class="small ghost" data-reply="${c.id}">답글</button>`}<button class="small ghost" data-cdel="${c.id}">삭제</button></div></div>`;
  return list.filter((c) => !c.parent).reverse().map((c) => one(c) + list.filter((r) => r.parent === c.id).map((r) => one(r, true)).join('')).join('');
}
async function watch(id, params) {
  let d; try { d = await api('api/videos/' + id); } catch (e) { $('#view').innerHTML = `<div class="empty"><b>${esc(e.message)}</b><a href="#/">처음으로</a></div>`; return; }
  const v = d.video, listId = params.get('list'); let pl = null;
  if (listId) try { pl = (await api('api/playlists/' + listId)).playlist; } catch { }
  const quality = v.low && ls.get('quality', '720') === '360' ? '360' : '720', src = (q) => `media/${v.id}${q === '360' ? '_360' : ''}.mp4?v=${v.thumbVer || 0}`;   // 편집하면 주소가 바뀌어 옛 영상이 남지 않는다
  const link = v.kind === 'link';
  const player = link ? `<iframe id="ytFrame" class="yt" src="https://www.youtube-nocookie.com/embed/${v.yt}?autoplay=1&rel=0${params.get('t') ? '&start=' + Math.floor(+params.get('t')) : ''}" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <p class="meta ytnote">유튜브에 있는 영상을 링크로 보여 드려요. 화면이 안 나오면 <a class="tag" href="https://www.youtube.com/watch?v=${v.yt}" target="_blank" rel="noopener">유튜브에서 열기 ↗</a></p>`
    : v.status === 'ready' ? `<video id="player" controls autoplay playsinline src="${src(quality)}" ${v.thumb ? `poster="${thumbUrl(v)}"` : ''}>${v.subs ? `<track kind="subtitles" srclang="ko" label="한국어" src="subs/${v.id}.vtt">` : ''}</video>
    <div id="strip" class="strip" title="파란 부분이 핵심 구간이에요" hidden></div>
    <div class="pbar"><button class="small" id="coreBtn" title="핵심 구간만 이어서 보기 (H)" hidden></button><button class="small" id="back10" title="10초 뒤로 (J)">⏪ 10초</button><button class="small" id="fwd10" title="10초 앞으로 (L)">10초 ⏩</button>
      <select id="speed" title="재생 속도 (&lt; &gt;)">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => `<option value="${s}">${s}배</option>`).join('')}</select>
      ${v.low ? `<select id="quality" title="화질"><option value="720">720p</option><option value="360">360p (느린 망)</option></select>` : ''}
      <span class="sp"></span><label><input type="checkbox" id="autoplay"> 자동 다음 영상</label><button class="small" id="theater" title="극장 모드 (T)">극장 모드</button><button class="small" id="pip" title="작은 창으로 보기">작은 창</button><button class="small" id="full" title="전체 화면 (F)">전체 화면</button></div>`
    : `<div class="thumb"><span class="state">${v.status === 'processing' ? '⏳ 영상을 줄이는 중이에요. 잠시 뒤 자동으로 열려요.' : '⚠ ' + esc(v.note || '변환 실패')}</span></div>`;
  const liked = ls.get('liked', {})[v.id] || 0, later = ls.get('later', []).includes(v.id);
  const plBox = pl ? `<div class="plbox"><header><b>${esc(pl.title)}</b><div class="meta">${pl.videos.findIndex((x) => x.id === v.id) + 1} / ${pl.videos.length}</div></header><div class="items">${pl.videos.map((x) => card(x, { list: pl.id, cur: x.id === v.id })).join('')}</div></div>` : '';
  $('#view').innerHTML = `<div class="watch"><section>${player}
    <h1>${esc(v.title)}</h1><div class="meta">${esc(v.category)} · 조회수 <span id="views">${v.views}</span>회 · ${ago(v.created)}${v.bytes ? ' · ' + mb(v.bytes) : ''}${v.kind === 'link' ? ' · 유튜브 링크' : ''}${v.visibility === 'unlisted' ? ' · 링크로만 공개' : ''}${v.hidden ? ' · 관리자가 숨김' : ''}</div>
    <div class="actions"><button id="like" class="${liked === 1 ? 'on' : ''}">👍 <b id="likes">${v.likes}</b></button><button id="dislike" class="${liked === -1 ? 'on' : ''}">👎 <b id="dislikes">${v.dislikes}</b></button>
      <button id="share">↗ 공유</button><button id="later" class="${later ? 'on' : ''}">⏰ ${later ? '담김' : '나중에 보기'}</button><button id="addPl">📚 재생 목록에 담기</button><span class="sp"></span>
      <button id="edit" class="ghost">고치기</button><button id="thumbBtn" class="ghost">썸네일</button><button id="trimBtn" class="ghost">✂ 편집</button><button id="blurBtn" class="ghost">▦ 가리기</button><button id="audioBtn" class="ghost">🔊 소리 정리</button><button id="report" class="ghost">신고</button><button id="del" class="ghost">지우기</button></div>
    ${v.note && v.status === 'ready' ? `<p class="msg bad">${esc(v.note)}</p>` : ''}
    ${v.desc || v.tags.length ? `<div class="desc">${esc(v.desc)}${v.tags.length ? (v.desc ? '\n' : '') + v.tags.map((t) => `<a class="tag" href="#/tag/${encodeURIComponent(t)}">#${esc(t)}</a>`).join('') : ''}</div>` : ''}
    <div class="comments"><h2>댓글 ${d.comments.length}개</h2>
      <form class="cform" id="cform"><input id="ctext" maxlength="1000" placeholder="댓글 추가"><label class="meta" style="white-space:nowrap"><input type="checkbox" id="cat"> 지금 장면에</label><button class="primary">등록</button></form>
      <div id="clist">${comments(d.comments)}</div></div>
    </section><aside class="side"><div id="core" class="corebox"></div>${plBox}<h2>관련 영상</h2>${d.related.map((x) => card(x)).join('') || '<div class="meta">아직 없어요</div>'}</aside></div>`;
  const P = $('#player');
  if (P) {
    // 시청 기록, 이어 보기, 공유 링크의 시작 시간
    ls.set('history', [{ id: v.id, at: Date.now() }, ...ls.get('history', []).filter((h) => h.id !== v.id)].slice(0, 200));
    const startAt = params.get('t') != null ? +params.get('t') : (ls.get('pos', {})[v.id] || 0);
    P.addEventListener('loadedmetadata', () => { if (startAt > 0 && startAt < P.duration - 3) P.currentTime = startAt; P.playbackRate = +ls.get('speed', 1); }, { once: true });
    let lastSave = 0; P.addEventListener('timeupdate', () => { if (Math.abs(P.currentTime - lastSave) < 3) return; lastSave = P.currentTime; const pos = ls.get('pos', {}); if (P.duration && P.currentTime > P.duration * 0.95) delete pos[v.id]; else pos[v.id] = Math.floor(P.currentTime); ls.set('pos', pos); });
    let counted = false; P.addEventListener('playing', async () => { if (counted) return; counted = true; const r = await api(`api/videos/${id}/view`, { method: 'POST' }).catch(() => null); if (r && $('#views')) $('#views').textContent = r.views; });
    P.addEventListener('ended', () => { const pos = ls.get('pos', {}); delete pos[v.id]; ls.set('pos', pos);
      const i = pl ? pl.videos.findIndex((x) => x.id === v.id) : -1, next = pl && i >= 0 && pl.videos[i + 1] ? `#/v/${pl.videos[i + 1].id}?list=${pl.id}` : (!pl && ls.get('autoplay', true) && d.related[0] ? '#/v/' + d.related[0].id : null);
      if (next) { toast('다음 영상으로 넘어가요'); nextTimer = setTimeout(() => { location.hash = next; }, 1200); } });
    P.addEventListener('seeking', () => clearTimeout(nextTimer));   // 끝난 뒤 되감으면 넘어가지 않는다
    P.addEventListener('timeupdate', () => { coreTick(); mark(); });
    $('#coreBtn').onclick = () => setCore(!coreOn);
    $('#strip').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); jump((e.clientX - r.left) / r.width * total()); };
    $('#speed').value = String(ls.get('speed', 1)); $('#speed').onchange = (e) => { P.playbackRate = +e.target.value; ls.set('speed', +e.target.value); };
    if ($('#quality')) { $('#quality').value = quality; $('#quality').onchange = (e) => { const t = P.currentTime, paused = P.paused, rate = P.playbackRate; ls.set('quality', e.target.value); P.src = src(e.target.value); P.addEventListener('loadedmetadata', () => { P.currentTime = t; P.playbackRate = rate; if (!paused) P.play(); }, { once: true }); }; }
    const seek = (dt) => { P.currentTime = Math.max(0, Math.min(P.duration || 0, P.currentTime + dt)); };
    $('#back10').onclick = () => seek(-10); $('#fwd10').onclick = () => seek(10);
    $('#autoplay').checked = ls.get('autoplay', true); $('#autoplay').onchange = (e) => ls.set('autoplay', e.target.checked);
    const theater = (on) => { document.body.classList.toggle('theater', on); ls.set('theater', on); $('#theater').classList.toggle('on', on); }; theater(ls.get('theater', false)); $('#theater').onclick = () => theater(!document.body.classList.contains('theater'));
    $('#pip').onclick = async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await P.requestPictureInPicture(); } catch { toast('이 브라우저는 작은 창을 지원하지 않아요'); } };
    const full = () => { if (document.fullscreenElement) document.exitFullscreen(); else P.requestFullscreen().catch(() => { }); }; $('#full').onclick = full;
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2], bump = (n) => { const i = Math.max(0, Math.min(speeds.length - 1, speeds.indexOf(P.playbackRate) + n)); P.playbackRate = speeds[i]; $('#speed').value = String(speeds[i]); ls.set('speed', speeds[i]); toast(speeds[i] + '배'); };
    keyHandler = (e) => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]')) return; const k = e.key.toLowerCase();
      const map = { ' ': () => (P.paused ? P.play() : P.pause()), k: () => (P.paused ? P.play() : P.pause()), j: () => seek(-10), l: () => seek(10), arrowleft: () => seek(-5), arrowright: () => seek(5), f: full, t: () => $('#theater').click(), m: () => { P.muted = !P.muted; }, h: () => setCore(!coreOn), '<': () => bump(-1), '>': () => bump(1), ',': () => bump(-1), '.': () => bump(1) };
      if (map[k]) { e.preventDefault(); map[k](); } };
    document.addEventListener('keydown', keyHandler);
  } else if (link) {   // 유튜브 링크: 기록과 조회수만 남기고, 우리 영상용 기능(편집·가리기·핵심)은 숨긴다
    ls.set('history', [{ id: v.id, at: Date.now() }, ...ls.get('history', []).filter((h) => h.id !== v.id)].slice(0, 200));
    api(`api/videos/${id}/view`, { method: 'POST' }).then((r) => { if ($('#views')) $('#views').textContent = r.views; }).catch(() => { });
    ['#thumbBtn', '#trimBtn', '#blurBtn', '#audioBtn', '#core'].forEach((q) => { if ($(q)) $(q).hidden = true; });
  } else if (v.status === 'processing') poll = setInterval(async () => { const r = await api('api/videos/' + id).catch(() => null); if (r && r.video.status !== 'processing') route(); }, 3000);

  /* ----- 핵심 보기: 핵심 구간만 이어서 재생, 핵심 내용과 대본을 글로 ----- */
  let ins = d.insight || { status: 'none', note: '', summary: '', points: [], transcript: [] }, coreOn = false, tab = 'core', editing = false, lastLine = -1;
  const total = () => (P && P.duration) || v.duration || 0;
  const inPt = (t) => ins.points.findIndex((p) => t >= p.s - 0.05 && t < p.e);
  const coreTick = () => { if (!coreOn || P.seeking) return; const t = P.currentTime; if (inPt(t) >= 0) return; const nx = ins.points.find((p) => p.s > t);
    if (nx) P.currentTime = nx.s; else { coreOn = false; $('#coreBtn').classList.remove('on'); P.pause(); toast('핵심을 다 봤어요'); } };
  const setCore = (on) => { coreOn = !!on && ins.points.length > 0 && !!P; if ($('#coreBtn')) $('#coreBtn').classList.toggle('on', coreOn); if (!coreOn) return;
    if (inPt(P.currentTime) < 0 && !ins.points.some((p) => p.s > P.currentTime)) P.currentTime = ins.points[0].s; else coreTick();
    P.play().catch(() => { }); toast('핵심 구간만 이어서 보여 드려요'); };
  const jump = (t) => { if (!P) return; if (coreOn && inPt(t) < 0) setCore(false); P.currentTime = Math.max(0, Math.min(total(), t)); P.play().catch(() => { }); };
  const mark = () => { const t = P.currentTime, cur = inPt(t); if ($('#stripPos')) $('#stripPos').style.left = (total() ? t / total() * 100 : 0) + '%';
    $$('#core .pt').forEach((a, i) => a.classList.toggle('cur', i === cur));
    if (tab !== 'script' || editing) return; let i = -1; for (let k = 0; k < ins.transcript.length && ins.transcript[k].s <= t; k++) i = k;
    if (i === lastLine) return; lastLine = i; const rows = $$('#core .ln'); rows.forEach((a) => a.classList.toggle('cur', +a.dataset.i === i));
    const el = rows.find((a) => +a.dataset.i === i), box = $('#core .body'); if (el && box && !box.matches(':hover')) box.scrollTop = el.offsetTop - box.clientHeight / 2; };
  const tfmt = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
  const tparse = (x) => { const a = String(x).trim().split(':').map(Number); return a.length && a.every((n) => Number.isFinite(n)) ? a.reduce((p, n) => p * 60 + n, 0) : NaN; };
  const ptRow = (p) => `<div class="ptrow"><input class="ps" value="${tfmt(p.s)}" title="시작 (분:초)"><button class="small" data-now="ps" title="지금 장면을 시작으로">지금</button><input class="pe" value="${tfmt(p.e)}" title="끝 (분:초)"><button class="small" data-now="pe" title="지금 장면을 끝으로">지금</button><button class="small" data-rm title="이 구간 빼기">✕</button><input class="ptx" maxlength="200" placeholder="이 구간의 핵심 내용" value="${esc(p.t)}"></div>`;
  function renderCore() {
    const box = $('#core'); if (!box) return;
    const busy = ins.status === 'queued' || ins.status === 'working', has = ins.points.length, tr = ins.transcript.length, sec = ins.points.reduce((n, p) => n + p.e - p.s, 0);
    if ($('#coreBtn')) { $('#coreBtn').hidden = !has; $('#coreBtn').textContent = `⚡ 핵심만 보기 (${dur(sec)})`; if (!has) coreOn = false; $('#coreBtn').classList.toggle('on', coreOn); }
    if ($('#strip')) { $('#strip').hidden = !has; $('#strip').innerHTML = ins.points.map((p) => `<b style="left:${p.s / total() * 100}%;width:${(p.e - p.s) / total() * 100}%" title="${esc(p.t)}"></b>`).join('') + '<i id="stripPos"></i>'; }
    if (editing) {
      box.innerHTML = `<header><b>⚡ 핵심 고치기</b></header><div class="body"><label class="meta">한 줄 요약<textarea id="iSum" rows="2" maxlength="400">${esc(ins.summary)}</textarea></label>
        <p class="meta">영상을 원하는 장면에 두고 "지금"을 누르면 그 시간이 들어가요.</p><div id="iPts">${ins.points.map(ptRow).join('')}</div><button id="iAdd" class="small">＋ 지금 장면부터 구간 추가</button><p id="iMsg" class="msg bad"></p></div>
        <footer><span class="sp"></span><button id="iCancel" class="small ghost">취소</button><button id="iSave" class="small primary">저장</button></footer>`;
      const bind = () => { $$('#iPts [data-rm]').forEach((b) => b.onclick = () => b.parentElement.remove()); $$('#iPts [data-now]').forEach((b) => b.onclick = () => { if (P) $('.' + b.dataset.now, b.parentElement).value = tfmt(P.currentTime); }); }; bind();
      $('#iAdd').onclick = () => { const t = P ? P.currentTime : 0; $('#iPts').insertAdjacentHTML('beforeend', ptRow({ s: t, e: Math.min(total() || t + 10, t + 10), t: '' })); bind(); };
      $('#iCancel').onclick = () => { editing = false; renderCore(); };
      $('#iSave').onclick = async () => { const points = $$('#iPts .ptrow').map((r) => ({ s: tparse($('.ps', r).value), e: tparse($('.pe', r).value), t: $('.ptx', r).value }));
        if (points.some((p) => !(p.e > p.s))) { $('#iMsg').textContent = '시간은 분:초 로 적고, 끝이 시작보다 뒤여야 해요. (예 1:30)'; return; }
        try { ins = (await api(`api/videos/${id}/insight`, send('PUT', { summary: $('#iSum').value, points }))).insight; editing = false; tab = 'core'; renderCore(); toast('핵심을 저장했어요'); } catch (e) { $('#iMsg').textContent = e.message; } };
      return;
    }
    if (!has && tr && tab === 'core' && !busy && !ins.summary) tab = 'script';
    const core = (ins.summary ? `<p class="sum">${esc(ins.summary)}</p>` : '') + (has ? ins.points.map((p) => `<a class="pt" data-s="${p.s}"><span class="at">${dur(p.s)}</span>${esc(p.t) || '핵심 구간'} <span class="meta">${Math.max(1, Math.round(p.e - p.s))}초</span></a>`).join('')
      : busy ? '' : `<p class="meta">${esc(ins.note) || '아직 핵심 구간이 없어요.'}</p>`) + (has && ins.note ? `<p class="meta">${esc(ins.note)}</p>` : '');
    const script = `<input id="trQ" placeholder="대본에서 찾기" style="margin-bottom:6px">` + ins.transcript.map((x, i) => `<a class="ln ${inPt((x.s + x.e) / 2) >= 0 ? 'core' : ''}" data-i="${i}" data-s="${x.s}"><span class="at">${dur(x.s)}</span>${esc(x.t)}</a>`).join('');
    box.innerHTML = `<header><b>⚡ 핵심 내용</b>${tr ? `<button class="small ${tab === 'core' ? 'on' : ''}" data-tab="core">핵심</button><button class="small ${tab === 'script' ? 'on' : ''}" data-tab="script">전체 대본</button>` : ''}</header>
      <div class="body">${busy ? '<p class="meta">⏳ 말소리를 글로 바꾸고 핵심을 고르는 중이에요. 끝나면 여기에 나타나요.</p>' : ''}${tab === 'script' && tr ? script : core}</div>
      <footer>${v.status === 'ready' ? `<button id="insEdit" class="small">${has ? '고치기' : '직접 고르기'}</button>${(tr ? meta.llm : meta.stt) && !busy ? `<button id="insRedo" class="small">${has ? 'AI로 다시 만들기' : 'AI로 핵심 만들기'}</button>` : ''}
        <label class="small filebtn" title=".srt 또는 .vtt 자막 파일을 대본으로 써요"><input id="insSubs" type="file" accept=".srt,.vtt,text/vtt" hidden>자막 파일 올리기</label>` : ''}</footer>`;
    lastLine = -1;
    $$('#core [data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; renderCore(); });
    $$('#core [data-s]').forEach((a) => a.onclick = () => jump(+a.dataset.s));
    if ($('#trQ')) $('#trQ').oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $$('#core .ln').forEach((a) => { a.hidden = !!q && !a.textContent.toLowerCase().includes(q); }); };
    if ($('#insEdit')) $('#insEdit').onclick = () => { editing = true; renderCore(); };
    if ($('#insRedo')) $('#insRedo').onclick = async () => { if (ins.edited && !confirm('직접 고친 핵심이 지워지고 AI 가 새로 골라요. 계속할까요?')) return;
      try { ins = (await api(`api/videos/${id}/insight`, send('POST', {}))).insight; renderCore(); watchInsight(); } catch (e) { toast(e.message); } };
    if ($('#insSubs')) $('#insSubs').onchange = async (e) => { const f = e.target.files[0]; if (!f) return;
      try { ins = (await api(`api/videos/${id}/subs`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: await f.text() })).insight; toast('자막을 대본으로 넣었어요'); renderCore(); watchInsight(); } catch (er) { toast(er.message); } };
    if (P) mark();
  }
  function watchInsight() { if (!P || !['queued', 'working'].includes(ins.status)) return; clearInterval(poll);
    poll = setInterval(async () => { const r = await api(`api/videos/${id}/insight`).catch(() => null); if (!r) return; const done = !['queued', 'working'].includes(r.insight.status);
      if (done) { clearInterval(poll); poll = null; if (r.insight.points.length) toast('핵심을 뽑았어요'); } if (!editing && (done || r.insight.status !== ins.status)) { ins = r.insight; renderCore(); } }, 3000); }
  renderCore(); watchInsight();
  if (P && params.get('core') === '1' && ins.points.length) P.addEventListener('loadedmetadata', () => { P.currentTime = ins.points[0].s; setCore(true); }, { once: true });

  const vote = async (kind) => { const map = ls.get('liked', {}), cur = map[v.id] || 0, want = kind === 'like' ? 1 : -1; let r;
    if (cur === want) { r = await api(`api/videos/${id}/${kind}`, send('POST', { undo: true })); delete map[v.id]; }
    else { if (cur) await api(`api/videos/${id}/${cur === 1 ? 'like' : 'dislike'}`, send('POST', { undo: true })); r = await api(`api/videos/${id}/${kind}`, send('POST')); map[v.id] = want; }
    ls.set('liked', map); $('#likes').textContent = r.likes; $('#dislikes').textContent = r.dislikes; $('#like').classList.toggle('on', map[v.id] === 1); $('#dislike').classList.toggle('on', map[v.id] === -1); };
  $('#like').onclick = () => vote('like'); $('#dislike').onclick = () => vote('dislike');
  $('#later').onclick = () => { const l = ls.get('later', []), on = l.includes(v.id); ls.set('later', on ? l.filter((x) => x !== v.id) : [v.id, ...l]); $('#later').classList.toggle('on', !on); $('#later').textContent = '⏰ ' + (on ? '나중에 보기' : '담김'); toast(on ? '나중에 볼 영상에서 뺐어요' : '나중에 볼 영상에 담았어요'); };
  $('#share').onclick = () => { const base = location.href.split('#')[0] + '#/v/' + v.id, t = P ? Math.floor(P.currentTime) : 0;
    const dg = dialog(`<h2>공유</h2><input id="shareUrl" readonly value="${esc(base)}"><label class="pick"><input type="checkbox" id="shareT"> 지금 시간(${dur(t)})부터 재생</label><div class="row"><button data-close class="ghost">닫기</button><button id="copy" class="primary">주소 복사</button></div>`);
    $('#shareT', dg).onchange = (e) => { $('#shareUrl', dg).value = base + (e.target.checked ? '?t=' + t : ''); };
    $('#copy', dg).onclick = async () => { const u = $('#shareUrl', dg); try { await navigator.clipboard.writeText(u.value); } catch { u.select(); document.execCommand('copy'); } toast('주소를 복사했어요'); dg.close(); }; };
  $('#addPl').onclick = async () => { const { playlists } = await api('api/playlists');
    const dg = dialog(`<h2>재생 목록에 담기</h2>${playlists.map((p) => `<label class="pick"><input type="checkbox" data-pl="${p.id}" ${p.ids.includes(v.id) ? 'checked' : ''}> ${esc(p.title)} <span class="meta">(${p.count})</span></label>`).join('') || '<p class="meta">아직 재생 목록이 없어요.</p>'}
      <div class="row" style="margin-top:10px"><input id="newPlName" placeholder="새 재생 목록 이름" style="flex:1"><button id="mkPl">만들어 담기</button></div><div class="row" style="margin-top:10px"><button data-close class="primary">완료</button></div>`);
    $$('[data-pl]', dg).forEach((c) => c.onchange = async () => { if (c.checked) await api(`api/playlists/${c.dataset.pl}/videos`, send('POST', { video: v.id })); else await api(`api/playlists/${c.dataset.pl}/videos/${v.id}`, { method: 'DELETE' }); toast(c.checked ? '담았어요' : '뺐어요'); });
    $('#mkPl', dg).onclick = async () => { const t = $('#newPlName', dg).value.trim(); if (!t) return; const r = await api('api/playlists', send('POST', { title: t })); await api(`api/playlists/${r.playlist.id}/videos`, send('POST', { video: v.id })); toast(`'${t}'에 담았어요`); dg.close(); }; };
  $('#edit').onclick = () => { const dg = dialog(`<h2>영상 정보 고치기</h2><label>제목 <input id="eTitle" maxlength="100" value="${esc(v.title)}"></label><label>분류 <select id="eCat">${meta.categories.map((c) => `<option ${c === v.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>설명 <textarea id="eDesc" rows="4" maxlength="2000">${esc(v.desc)}</textarea></label><label>태그 <input id="eTags" value="${esc(v.tags.join(', '))}"></label>
      <label>공개 범위 <select id="eVis"><option value="public">공개 (목록과 검색에 보임)</option><option value="unlisted" ${v.visibility === 'unlisted' ? 'selected' : ''}>링크로만 (목록에 숨김)</option></select></label><p id="eMsg" class="msg bad"></p><div class="row"><button data-close class="ghost">취소</button><button id="eSave" class="primary">저장</button></div>`);
    $('#eSave', dg).onclick = async () => { try { await api('api/videos/' + id, send('PATCH', { title: $('#eTitle', dg).value, category: $('#eCat', dg).value, desc: $('#eDesc', dg).value, tags: $('#eTags', dg).value, visibility: $('#eVis', dg).value })); dg.close(); route(); } catch (e) { $('#eMsg', dg).textContent = e.message; } }; };
  $('#thumbBtn').onclick = () => { if (!P) return toast('영상 변환이 끝난 뒤에 바꿀 수 있어요'); const t = P.currentTime;
    const dg = dialog(`<h2>썸네일 바꾸기</h2><p>영상을 원하는 장면에 멈춘 뒤 누르세요.</p><div class="row" style="justify-content:flex-start"><button id="thNow" class="primary">지금 장면(${dur(t)})으로</button><label style="margin:0"><input id="thFile" type="file" accept="image/*" hidden><span class="small" style="display:inline-block;border:1px solid var(--line);border-radius:8px;padding:7px 12px;cursor:pointer;color:var(--text)">사진 올리기</span></label></div><p id="thMsg" class="msg bad"></p><div class="row"><button data-close class="ghost">닫기</button></div>`);
    const done = () => { dg.close(); toast('썸네일을 바꿨어요'); route(); };
    $('#thNow', dg).onclick = async () => { try { await api(`api/videos/${id}/thumb`, send('POST', { t })); done(); } catch (e) { $('#thMsg', dg).textContent = e.message; } };
    $('#thFile', dg).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await api(`api/videos/${id}/thumb`, { method: 'PUT', headers: { 'Content-Type': f.type || 'image/jpeg' }, body: f }); done(); } catch (er) { $('#thMsg', dg).textContent = er.message; } }; };
  $('#trimBtn').onclick = async () => { if (!P) return toast('영상 변환이 끝난 뒤에 편집할 수 있어요'); P.pause();
    const keep = await rangeEditor({ src: src('720'), title: v.title, points: ins.points }); if (!keep) return;
    if (!confirm(`고른 ${keep.length}개 구간만 남기고 나머지는 지워요. 되돌릴 수 없어요. 계속할까요?`)) return;
    try { await api(`api/videos/${id}/cut`, send('POST', { keep })); const pos = ls.get('pos', {}); delete pos[v.id]; ls.set('pos', pos); route(); } catch (e) { alert(e.message); } };
  $('#blurBtn').onclick = async () => { if (!P) return toast('영상 변환이 끝난 뒤에 가릴 수 있어요'); P.pause();
    const boxes = await blurEditor({ src: src('720'), title: v.title }); if (!boxes) return;
    if (!confirm(`고른 ${boxes.length}곳을 모자이크로 가려요. 되돌릴 수 없어요. 계속할까요?`)) return;
    try { await api(`api/videos/${id}/blur`, send('POST', { boxes })); route(); } catch (e) { alert(e.message); } };
  $('#audioBtn').onclick = async () => { if (!P) return toast('영상 변환이 끝난 뒤에 할 수 있어요');
    if (!confirm('잡음을 줄이고 소리 크기를 듣기 좋게 맞춰요. 되돌릴 수 없어요. 계속할까요?')) return;
    try { await api(`api/videos/${id}/audio`, send('POST')); route(); } catch (e) { alert(e.message); } };
  $('#report').onclick = async () => { const r = prompt('신고 이유를 적어 주세요 (관리 화면에 전달돼요)'); if (!r) return; try { await api(`api/videos/${id}/report`, send('POST', { reason: r })); toast('신고했어요'); } catch (e) { alert(e.message); } };
  $('#del').onclick = async () => { if (!confirm(`'${v.title}' 영상을 지울까요? 되돌릴 수 없어요.`)) return; await api('api/videos/' + id, { method: 'DELETE' }); refreshMeta(); location.hash = '#/'; };
  $('#cform').onsubmit = async (e) => { e.preventDefault(); const text = $('#ctext').value.trim(); if (!text) return; const body = { text }; if ($('#cat').checked && P) body.at = Math.floor(P.currentTime);
    try { await api(`api/videos/${id}/comments`, send('POST', body)); reloadComments(); $('#ctext').value = ''; } catch (err) { alert(err.message); } };
  async function reloadComments() { const r = await api('api/videos/' + id); $('#clist').innerHTML = comments(r.comments); $('.comments h2').textContent = `댓글 ${r.comments.length}개`; bindComments(); }
  function bindComments() {
    $$('#clist [data-at]').forEach((a) => a.onclick = () => { if (P) { P.currentTime = +a.dataset.at; P.play(); P.scrollIntoView({ block: 'center' }); } });
    $$('#clist [data-cdel]').forEach((b) => b.onclick = async () => { if (confirm('댓글을 지울까요?')) { await api(`api/videos/${id}/comments/${b.dataset.cdel}`, { method: 'DELETE' }); reloadComments(); } });
    $$('#clist [data-reply]').forEach((b) => b.onclick = async () => { const t = prompt('답글'); if (!t) return; await api(`api/videos/${id}/comments`, send('POST', { text: t, parent: b.dataset.reply })); reloadComments(); });
    $$('#clist [data-clike]').forEach((b) => b.onclick = async () => { const map = ls.get('cliked', {}), on = !!map[b.dataset.clike]; await api(`api/videos/${id}/comments/${b.dataset.clike}/like`, send('POST', { undo: on })); if (on) delete map[b.dataset.clike]; else map[b.dataset.clike] = 1; ls.set('cliked', map); reloadComments(); });
  }
  bindComments(); window.scrollTo(0, 0);
}

/* ---------- 관리 ---------- */
async function admin() {
  const sort = admin.sort || 'new', { videos } = await api('api/videos?all=1&sort=' + sort); await refreshMeta();
  const pct = meta.totalBytes ? (1 - meta.freeBytes / meta.totalBytes) * 100 : 0;
  $('#view').innerHTML = `<h1 class="page">⚙ 관리</h1>
    <div class="box"><h2>저장 공간</h2>영상 ${meta.videos}개 · ${meta.hours.toFixed(1)}시간 · 영상이 쓰는 용량 ${gb(meta.usedBytes)}${meta.freeBytes != null ? ` · 디스크 ${gb(meta.totalBytes - meta.freeBytes)} / ${gb(meta.totalBytes)} 사용 (${gb(meta.freeBytes)} 남음)<div class="meter"><div class="${pct > 80 ? 'warn' : ''}" style="width:${pct.toFixed(0)}%"></div></div>` : ''}${meta.compress ? '' : '<p class="msg bad">ffmpeg 가 없어 영상을 줄이지 못하고 있어요. 서버에 ffmpeg 를 설치하세요.</p>'}</div>
    <div class="box"><h2>핵심 뽑기</h2>말소리를 글로 바꾸기: <b>${meta.stt ? '켜짐' : '꺼짐'}</b> · AI 로 핵심 고르기: <b>${meta.llm ? '켜짐' : '꺼짐'}</b>
      ${meta.stt ? '<div class="row" style="justify-content:flex-start;margin-top:8px"><button id="insAll" class="small">핵심이 없는 영상 모두 만들기</button></div>' : '<p class="meta">서버에서 tools/install_stt.sh 를 한 번 실행하면 켜져요. 꺼져 있어도 자막 파일을 올리거나 직접 고를 수 있어요.</p>'}${meta.llm ? '' : '<p class="meta">AI 는 서버 환경변수 SUNSUTV_LLM_URL 에 주소를 넣으면 켜져요.</p>'}</div>
    <div class="box"><h2>분류</h2><div id="cats">${meta.categories.map((c) => `<div class="catrow"><input value="${esc(c)}" data-old="${esc(c)}" maxlength="20"><button class="small" data-catdel>지우기</button></div>`).join('')}</div>
      <div class="row" style="justify-content:flex-start"><button id="catAdd" class="small">＋ 분류 추가</button><button id="catSave" class="small primary">분류 저장</button><span class="meta">이름을 바꾸면 영상도 따라 바뀌고, 지운 분류의 영상은 맨 아래 분류로 가요.</span></div></div>
    <div class="box"><h2>전체 영상</h2><div class="chips"><select id="aSort"><option value="new">최신순</option><option value="size">용량 큰 순</option><option value="views">조회순</option><option value="reports">신고 많은 순</option></select><span class="sp"></span><span id="selInfo" class="meta"></span><button id="bulkDel" disabled>고른 영상 지우기</button></div>
      <table class="adm"><thead><tr><th><input type="checkbox" id="selAll"></th><th></th><th>제목</th><th>분류</th><th>용량</th><th>길이</th><th>조회</th><th>신고</th><th>상태</th><th></th></tr></thead><tbody>
      ${videos.map((v) => `<tr><td><input type="checkbox" data-sel="${v.id}" data-bytes="${v.bytes}"></td><td>${v.thumb ? `<img src="${thumbUrl(v)}" loading="lazy">` : ''}</td><td><a href="#/v/${v.id}"><b>${esc(v.title)}</b></a><div class="meta">${ago(v.created)}</div></td><td>${esc(v.category)}</td>
        <td class="num">${mb(v.bytes)}</td><td class="num">${dur(v.duration)}</td><td class="num">${v.views}</td><td class="num">${v.reports ? `<button class="small" data-reports="${v.id}">${v.reports}건</button>` : '0'}</td>
        <td>${v.status !== 'ready' ? (v.status === 'processing' ? '변환 중' : '실패') : v.hidden ? '숨김' : v.visibility === 'unlisted' ? '링크로만' : '공개'}</td><td><button class="small" data-hide="${v.id}" data-on="${v.hidden}">${v.hidden ? '숨김 풀기' : '숨기기'}</button></td></tr>`).join('') || '<tr><td colspan="10" class="meta">영상이 없어요</td></tr>'}</tbody></table></div>`;
  if ($('#insAll')) $('#insAll').onclick = async () => { try { const r = await api('api/admin/insight', send('POST')); toast(r.queued ? `${r.queued}개를 줄 세웠어요` : '만들 영상이 없어요'); } catch (e) { alert(e.message); } };
  $('#aSort').value = sort; $('#aSort').onchange = (e) => { admin.sort = e.target.value; admin(); };
  const upd = () => { const sel = $$('[data-sel]:checked'); $('#bulkDel').disabled = !sel.length; $('#selInfo').textContent = sel.length ? `${sel.length}개 고름 · ${mb(sel.reduce((s, c) => s + +c.dataset.bytes, 0))}` : ''; };
  $$('[data-sel]').forEach((c) => c.onchange = upd); $('#selAll').onchange = (e) => { $$('[data-sel]').forEach((c) => { c.checked = e.target.checked; }); upd(); };
  $('#bulkDel').onclick = async () => { const ids = $$('[data-sel]:checked').map((c) => c.dataset.sel); if (!confirm(`영상 ${ids.length}개를 지울까요? 되돌릴 수 없어요.`)) return; const r = await api('api/admin/delete', send('POST', { ids })); toast(`${r.deleted}개 지웠어요`); admin(); };
  $$('[data-hide]').forEach((b) => b.onclick = async () => { await api('api/videos/' + b.dataset.hide, send('PATCH', { hidden: b.dataset.on !== 'true' })); admin(); });
  $$('[data-reports]').forEach((b) => b.onclick = async () => { const r = await api(`api/videos/${b.dataset.reports}/reports`);
    const dg = dialog(`<h2>신고 내용</h2>${r.reports.map((x) => `<div class="comment"><span class="when">${ago(x.at)}</span><div>${esc(x.reason)}</div></div>`).join('')}<div class="row" style="margin-top:12px"><button id="rClear">신고 비우기</button><button data-close class="primary">닫기</button></div>`);
    $('#rClear', dg).onclick = async () => { await api('api/videos/' + b.dataset.reports, send('PATCH', { clearReports: true })); dg.close(); admin(); }; });
  $('#catAdd').onclick = () => { $('#cats').insertAdjacentHTML('beforeend', '<div class="catrow"><input value="" data-old="" maxlength="20" placeholder="새 분류"><button class="small" data-catdel>지우기</button></div>'); bindCat(); };
  const bindCat = () => $$('[data-catdel]').forEach((b) => b.onclick = () => b.parentElement.remove()); bindCat();
  $('#catSave').onclick = async () => { const rows = $$('#cats input'), rename = {}; rows.forEach((i) => { if (i.dataset.old && i.value.trim() && i.dataset.old !== i.value.trim()) rename[i.dataset.old] = i.value.trim(); });
    try { await api('api/categories', send('PUT', { categories: rows.map((i) => i.value.trim()).filter(Boolean), rename })); toast('분류를 저장했어요'); admin(); } catch (e) { alert(e.message); } };
}

/* ---------- 길 찾기 ---------- */
function route(soft) {
  clearInterval(poll); poll = null; clearTimeout(nextTimer); if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
  const [pathPart, query] = (location.hash.slice(1) || '/').split('?'), params = new URLSearchParams(query || ''), seg = pathPart.split('/').filter(Boolean);
  if (seg[0] !== 'v') document.body.classList.remove('theater');
  const nav = { undefined: 'home', popular: 'popular', playlists: 'playlists', pl: 'playlists', history: 'history', later: 'later', admin: 'admin' }[seg[0]];
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav)); document.body.classList.remove('shownav');
  const go = seg[0] === 'v' && /^[0-9a-f]{12}$/.test(seg[1] || '') ? (soft ? Promise.resolve() : watch(seg[1], params)) : seg[0] === 'popular' ? home('popular') : seg[0] === 'tag' && seg[1] ? home('', decodeURIComponent(seg[1]))
    : seg[0] === 'playlists' ? playlistsPage() : seg[0] === 'pl' && seg[1] ? playlistPage(seg[1]) : seg[0] === 'history' ? localList('history', '🕘 시청 기록', '영상을 보면 여기에 쌓여요.')
    : seg[0] === 'later' ? localList('later', '⏰ 나중에 볼 영상', '영상 보기 화면에서 "나중에 보기"를 누르세요.') : seg[0] === 'admin' ? admin() : home();
  go.catch((e) => { $('#view').innerHTML = `<div class="empty"><b>${esc(e.message)}</b><a href="#/">처음으로</a></div>`; });
}
window.addEventListener('hashchange', () => route());
$$('.logo, .nav [data-nav=home]').forEach((a) => a.addEventListener('click', () => { state.q = ''; state.cat = ''; state.all = false; $('#q').value = ''; if (location.hash === '#/' || location.hash === '') route(); }));
$('#searchForm').onsubmit = (e) => { e.preventDefault(); state.q = $('#q').value.trim(); state.cat = ''; if (location.hash !== '#/' && location.hash !== '') location.hash = '#/'; else route(); };

async function refreshMeta() {
  meta = await api('api/meta');
  $('#upCat').innerHTML = meta.categories.map((c) => `<option>${esc(c)}</option>`).join('');
  const pct = meta.totalBytes ? 1 - meta.freeBytes / meta.totalBytes : 0;
  $('#disk').innerHTML = `영상 ${meta.videos}개 · ${meta.hours.toFixed(1)}시간 · ${gb(meta.usedBytes)} 사용` + (meta.freeBytes != null ? ` · <span class="${pct > 0.8 ? 'warn' : ''}">저장 공간 ${gb(meta.freeBytes)} 남음${pct > 0.8 ? ' (80% 넘게 찼어요)' : ''}</span>` : '') + (meta.compress ? '' : ' · <span class="warn">ffmpeg 없음: 압축 안 함</span>');
}

/* ---------- 올리기: 여러 개, 조각으로 나눠 끊겨도 이어서 ---------- */
const CHUNK = 8 * 1024 * 1024, dlg = $('#uploadDlg'); let files = [], uploading = false, cancelled = false, lastUploaded = null;
const fkey = (f) => `${f.name}|${f.size}|${f.lastModified}`;
function renderUp() { $('#upList').innerHTML = files.map((f, i) => `<div class="uprow" data-i="${i}"><input class="t" maxlength="100" value="${esc(f.title)}" placeholder="제목" ${uploading ? 'disabled' : ''}><button type="button" class="small ${f.keep ? 'on' : ''}" data-edit="${i}" ${uploading || f.cls === 'ok' ? 'disabled' : ''} title="필요한 부분만 골라 올리기">✂ ${f.keep ? `${f.keep.length}개 구간 · ${dur(f.keep.reduce((n, r) => n + r.e - r.s, 0))}` : '편집'}</button><span class="st ${f.cls || ''}">${f.st || mb(f.file.size)}</span><div class="bar"><div style="width:${f.pct || 0}%"></div></div></div>`).join('');
  $$('#upList .t').forEach((inp, i) => inp.oninput = () => { files[i].title = inp.value; });
  $$('#upList [data-edit]').forEach((b) => b.onclick = async () => { const f = files[+b.dataset.edit], url = URL.createObjectURL(f.file);
    const keep = await rangeEditor({ src: url, title: f.title, initial: f.keep }); URL.revokeObjectURL(url); if (keep) { f.keep = keep; renderUp(); } }); }
function addFiles(list) { for (const file of list) { if (files.some((f) => fkey(f.file) === fkey(file))) continue; files.push({ file, title: file.name.replace(/\.[^.]+$/, '') }); } renderUp(); }
function setRow(i, st, pct, cls) { Object.assign(files[i], { st, pct, cls }); const row = $(`#upList [data-i="${i}"]`); if (!row) return; $('.st', row).textContent = st; $('.st', row).className = 'st ' + (cls || ''); $('.bar div', row).style.width = pct + '%'; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function uploadOne(i, common) {
  const f = files[i].file, key = fkey(f), saved = ls.get('uploads', {});
  if (meta.maxBytes && f.size > meta.maxBytes) throw new Error(`너무 커요 (최대 ${gb(meta.maxBytes)})`);
  let uid = saved[key], received = 0;
  if (uid) try { received = (await api('api/uploads/' + uid)).received; setRow(i, `이어서 올리는 중 ${(received / f.size * 100).toFixed(0)}%`, received / f.size * 100); } catch { uid = null; }
  if (!uid) { uid = (await api('api/uploads', send('POST', { filename: f.name, size: f.size, title: files[i].title.trim() || f.name, keep: files[i].keep, ...common }))).uploadId; saved[key] = uid; ls.set('uploads', saved); }
  let tries = 0;
  while (received < f.size) {
    if (cancelled) throw new Error('취소함 (다시 고르면 이어서 올라가요)');
    try {
      const r = await api(`api/uploads/${uid}?offset=${received}`, { method: 'PUT', body: f.slice(received, received + CHUNK) });
      received = r.received; tries = 0; setRow(i, `올리는 중 ${(received / f.size * 100).toFixed(0)}%`, received / f.size * 100);
      if (r.done) { const s2 = ls.get('uploads', {}); delete s2[key]; ls.set('uploads', s2); return r.video; }
    } catch (e) {
      if (e.body && typeof e.body.received === 'number' && (e.status === 409 || e.status === 400)) { received = e.body.received; continue; }
      if (e.status && e.status !== 409 && e.status < 500) { const s2 = ls.get('uploads', {}); delete s2[key]; ls.set('uploads', s2); throw e; }
      if (++tries > 6) throw new Error('연결이 계속 끊겨요. 나중에 같은 파일을 다시 고르면 이어서 올라가요.');
      setRow(i, `연결이 끊겨 다시 시도 중 (${tries})`, received / f.size * 100); await sleep(Math.min(8000, 1000 * tries));
    }
  }
}
/* ---------- 화면 녹화해서 바로 올리기 (설치 없이 브라우저만으로. 내 화면 + 마이크) ---------- */
async function startRec() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) return alert('이 주소에서는 화면 녹화를 쓸 수 없어요. 브라우저가 https 주소(또는 localhost)에서만 화면 녹화를 허용해요.');
  let screen; try { screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true }); } catch { return; }
  let mic = null; try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { }
  const tracks = [...screen.getVideoTracks()], auds = [screen, mic].filter((x) => x && x.getAudioTracks().length); let ctx = null;
  if (auds.length) { ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination(); auds.forEach((x) => ctx.createMediaStreamSource(x).connect(dest)); tracks.push(...dest.stream.getAudioTracks()); }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 2500000 }), chunks = [], t0 = Date.now();
  const bar = document.createElement('div'); bar.id = 'recBar'; bar.innerHTML = `<span class="dot"></span><b>녹화 중</b><span id="recT">0:00</span><span class="meta">${mic ? '🎙 마이크 켜짐' : '🎙 마이크 없음'}</span><button id="recStop" class="primary">■ 녹화 끝내기</button>`; document.body.appendChild(bar);
  const timer = setInterval(() => { $('#recT').textContent = dur((Date.now() - t0) / 1000); }, 500), stop = () => { if (mr.state !== 'inactive') mr.stop(); };
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = () => { clearInterval(timer); bar.remove(); [screen, mic].forEach((x) => x && x.getTracks().forEach((t) => t.stop())); if (ctx) ctx.close();
    const n = new Date(), p2 = (x) => String(x).padStart(2, '0'), name = `화면 녹화 ${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())} ${p2(n.getHours())}시 ${p2(n.getMinutes())}분`;
    addFiles([new File(chunks, name + '.webm', { type: 'video/webm' })]); if (!dlg.open) dlg.showModal(); toast('녹화를 올릴 목록에 넣었어요. ✂ 편집으로 다듬을 수 있어요'); };
  screen.getVideoTracks()[0].addEventListener('ended', stop); $('#recStop').onclick = stop;
  mr.start(1000); if (dlg.open) dlg.close();
}
$('#recBtn').onclick = startRec;
/* ---------- 유튜브 링크 걸기: 영상을 가져오지 않고 주소만 등록한다 ---------- */
$('#ytUrl').onchange = async () => { const u = $('#ytUrl').value.trim(); if (!u || $('#ytTitle').value.trim()) return;   // 제목을 유튜브에서 받아 본다(안 되면 직접 적는다)
  try { const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u)); if (r.ok) { const j = await r.json(); if (j.title && !$('#ytTitle').value.trim()) $('#ytTitle').value = j.title; } } catch { } };
$('#ytAdd').onclick = async () => { const msg = $('#upMsg'); msg.className = 'msg';
  try { const r = await api('api/links', send('POST', { url: $('#ytUrl').value, title: $('#ytTitle').value, cat: $('#upCat').value, desc: $('#upDesc').value, tags: $('#upTags').value, visibility: $('#upVis').value }));
    $('#ytUrl').value = ''; $('#ytTitle').value = ''; dlg.close(); refreshMeta(); toast('유튜브 링크를 걸었어요'); location.hash = '#/v/' + r.video.id; } catch (e) { msg.textContent = e.message; msg.className = 'msg bad'; } };
$('#uploadBtn').onclick = () => { if (!uploading) { files = files.filter((f) => f.cls !== 'ok'); renderUp(); } $('#upMsg').textContent = ''; $('#upMsg').className = 'msg'; dlg.showModal(); };
$('#upCancel').onclick = () => { if (uploading) { cancelled = true; return; } dlg.close(); };
$('#file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
const drop = $('#drop'); ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
$('#uploadForm').onsubmit = async (e) => {
  e.preventDefault(); const msg = $('#upMsg'); msg.className = 'msg';
  const todo = files.map((f, i) => i).filter((i) => files[i].cls !== 'ok');
  if (!todo.length) { msg.textContent = '영상 파일을 골라 주세요.'; msg.className = 'msg bad'; return; }
  uploading = true; cancelled = false; $('#upGo').disabled = true; $('#upCancel').textContent = '취소'; renderUp();
  const common = { clean: $('#upClean').checked, cat: $('#upCat').value, desc: $('#upDesc').value, tags: $('#upTags').value, visibility: $('#upVis').value }; let okN = 0, badN = 0;
  for (const i of todo) { try { setRow(i, '올리는 중 0%', 0); lastUploaded = await uploadOne(i, common); setRow(i, '올림 ✓', 100, 'ok'); okN++; } catch (er) { setRow(i, er.message, files[i].pct || 0, 'bad'); badN++; if (cancelled) break; } }
  uploading = false; $('#upGo').disabled = false; $('#upCancel').textContent = '닫기'; renderUp(); refreshMeta();
  msg.textContent = `${okN}개 올림${badN ? `, ${badN}개 실패` : ''}`; msg.className = badN ? 'msg bad' : 'msg';
  if (okN && !badN) { dlg.close(); files = []; $('#upDesc').value = ''; $('#upTags').value = ''; if (okN === 1 && lastUploaded) location.hash = '#/v/' + lastUploaded.id; else { location.hash = '#/'; route(); } }
};

refreshMeta().then(() => route()).catch((e) => { $('#view').innerHTML = `<div class="empty"><b>서버에 연결하지 못했어요</b>${esc(e.message)}</div>`; });
