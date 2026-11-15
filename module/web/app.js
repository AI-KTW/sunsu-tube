/* 순수TV 화면. 경로는 모두 상대 경로(런처의 /module/sunsutube/ 아래에서도 동작). 로그인이 없어 시청 기록·나중에 볼 영상·좋아요 표시는 이 브라우저에 기억한다. */
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opt) => { const r = await fetch(url, opt); const j = await r.json().catch(() => ({ ok: false, message: r.statusText })); if (!r.ok || j.ok === false) throw Object.assign(new Error(j.message || '요청 실패'), { status: r.status, body: j }); return j; };
const send = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
const ago = (iso) => { const d = (Date.now() - new Date(iso)) / 1000; if (d < 60) return '방금'; if (d < 3600) return Math.floor(d / 60) + '분 전'; if (d < 86400) return Math.floor(d / 3600) + '시간 전'; if (d < 86400 * 30) return Math.floor(d / 86400) + '일 전'; return new Date(iso).toLocaleDateString('ko-KR'); };
const gb = (b) => (b / 1024 ** 3).toFixed(b > 10 * 1024 ** 3 ? 0 : 1) + ' GB', mb = (b) => b > 1024 ** 3 ? gb(b) : (b / 1024 ** 2).toFixed(0) + ' MB';
const ls = { get: (k, d) => { try { const v = localStorage.getItem('sunsutube.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('sunsutube.' + k, JSON.stringify(v)); } catch { } } };
let meta = { categories: [] }, state = { q: '', cat: '', sort: 'new', all: false }, poll = null, keyHandler = null, nextTimer = null;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2200); }
const thumbUrl = (v) => `thumb/${v.id}.jpg?v=${v.thumbVer || 0}`;

/* ---------- 카드 ---------- */
function card(v, opt = {}) {
  const bg = v.thumb ? `style="background-image:url('${thumbUrl(v)}')"` : '';
  const st = v.status === 'processing' ? '<span class="state">⏳ 변환 중…</span>' : v.status === 'failed' ? '<span class="state">⚠ 변환 실패</span>' : (v.thumb ? '' : '<span class="state">▶</span>');
  const pos = ls.get('pos', {})[v.id], prog = pos && v.duration ? `<span class="prog" style="width:${Math.min(100, pos / v.duration * 100).toFixed(0)}%"></span>` : '';
  const badge = v.visibility === 'unlisted' ? '<span class="badge">링크로만</span>' : v.hidden ? '<span class="badge">숨김</span>' : '';
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
  const ready = videos.filter((v) => v.status === 'ready'), pos = ls.get('pos', {});
  const pop = ready.filter((v) => v.weekViews > 0).sort((a, b) => b.weekViews - a.weekViews || b.views - a.views).slice(0, 20), h = pop[0] || ready[0];
  const later = h && ls.get('later', []).includes(h.id);
  // 큰 화면: 가로 끝까지 16:9. 영상이 소리 없이 흐르고, 설명은 화면 오른쪽 위에 자막처럼 얹는다.
  const hero = h ? `<section class="hero"><a class="scr" href="#/v/${h.id}" ${h.thumb ? `style="background-image:url('${thumbUrl(h)}')"` : ''}>
      <video id="heroVid" muted loop playsinline preload="metadata" src="media/${h.id}${h.low ? '_360' : ''}.mp4#t=${h.pts && h.pts[0] ? Math.floor(h.pts[0].s) : 0}"></video></a>
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
  const quality = v.low && ls.get('quality', '720') === '360' ? '360' : '720', src = (q) => `media/${v.id}${q === '360' ? '_360' : ''}.mp4`;
  const player = v.status === 'ready' ? `<video id="player" controls autoplay playsinline src="${src(quality)}" ${v.thumb ? `poster="${thumbUrl(v)}"` : ''}>${v.subs ? `<track kind="subtitles" srclang="ko" label="한국어" src="subs/${v.id}.vtt">` : ''}</video>
    <div id="strip" class="strip" title="파란 부분이 핵심 구간이에요" hidden></div>
    <div class="pbar"><button class="small" id="coreBtn" title="핵심 구간만 이어서 보기 (H)" hidden></button><button class="small" id="back10" title="10초 뒤로 (J)">⏪ 10초</button><button class="small" id="fwd10" title="10초 앞으로 (L)">10초 ⏩</button>
      <select id="speed" title="재생 속도 (&lt; &gt;)">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => `<option value="${s}">${s}배</option>`).join('')}</select>
      ${v.low ? `<select id="quality" title="화질"><option value="720">720p</option><option value="360">360p (느린 망)</option></select>` : ''}
      <span class="sp"></span><label><input type="checkbox" id="autoplay"> 자동 다음 영상</label><button class="small" id="theater" title="극장 모드 (T)">극장 모드</button><button class="small" id="pip" title="작은 창으로 보기">작은 창</button><button class="small" id="full" title="전체 화면 (F)">전체 화면</button></div>`
    : `<div class="thumb"><span class="state">${v.status === 'processing' ? '⏳ 영상을 줄이는 중이에요. 잠시 뒤 자동으로 열려요.' : '⚠ ' + esc(v.note || '변환 실패')}</span></div>`;
  const liked = ls.get('liked', {})[v.id] || 0, later = ls.get('later', []).includes(v.id);
  const plBox = pl ? `<div class="plbox"><header><b>${esc(pl.title)}</b><div class="meta">${pl.videos.findIndex((x) => x.id === v.id) + 1} / ${pl.videos.length}</div></header><div class="items">${pl.videos.map((x) => card(x, { list: pl.id, cur: x.id === v.id })).join('')}</div></div>` : '';
  $('#view').innerHTML = `<div class="watch"><section>${player}
    <h1>${esc(v.title)}</h1><div class="meta">${esc(v.category)} · 조회수 <span id="views">${v.views}</span>회 · ${ago(v.created)}${v.bytes ? ' · ' + mb(v.bytes) : ''}${v.visibility === 'unlisted' ? ' · 링크로만 공개' : ''}${v.hidden ? ' · 관리자가 숨김' : ''}</div>
    <div class="actions"><button id="like" class="${liked === 1 ? 'on' : ''}">👍 <b id="likes">${v.likes}</b></button><button id="dislike" class="${liked === -1 ? 'on' : ''}">👎 <b id="dislikes">${v.dislikes}</b></button>
      <button id="share">↗ 공유</button><button id="later" class="${later ? 'on' : ''}">⏰ ${later ? '담김' : '나중에 보기'}</button><button id="addPl">📚 재생 목록에 담기</button><span class="sp"></span>
      <button id="edit" class="ghost">고치기</button><button id="thumbBtn" class="ghost">썸네일</button><button id="trimBtn" class="ghost">자르기</button><button id="report" class="ghost">신고</button><button id="del" class="ghost">지우기</button></div>
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
  $('#trimBtn').onclick = () => { if (!P) return toast('영상 변환이 끝난 뒤에 자를 수 있어요');
    const dg = dialog(`<h2>앞뒤 잘라내기</h2><p class="meta">남길 구간의 시작과 끝을 정하세요. 영상을 원하는 곳에 두고 "지금 위치"를 누르면 돼요. 잘라낸 부분은 되돌릴 수 없어요.</p>
      <div class="row" style="justify-content:flex-start"><label style="margin:0">시작(초) <input id="tS" type="number" min="0" step="0.1" value="0" style="width:110px"></label><button id="tSNow" class="small">지금 위치</button>
      <label style="margin:0">끝(초) <input id="tE" type="number" min="0" step="0.1" value="${(v.duration || 0).toFixed(1)}" style="width:110px"></label><button id="tENow" class="small">지금 위치</button></div><p id="tMsg" class="msg bad"></p><div class="row"><button data-close class="ghost">취소</button><button id="tGo" class="primary">잘라내기</button></div>`);
    $('#tSNow', dg).onclick = () => { $('#tS', dg).value = P.currentTime.toFixed(1); }; $('#tENow', dg).onclick = () => { $('#tE', dg).value = P.currentTime.toFixed(1); };
    $('#tGo', dg).onclick = async () => { try { await api(`api/videos/${id}/trim`, send('POST', { start: +$('#tS', dg).value, end: +$('#tE', dg).value })); const pos = ls.get('pos', {}); delete pos[v.id]; ls.set('pos', pos); dg.close(); route(); } catch (e) { $('#tMsg', dg).textContent = e.message; } }; };
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
      ${meta.stt ? '<div class="row" style="justify-content:flex-start;margin-top:8px"><button id="insAll" class="small">핵심이 없는 영상 모두 만들기</button></div>' : '<p class="meta">서버에서 tools/install_stt.sh 를 한 번 실행하면 켜져요. 꺼져 있어도 자막 파일을 올리거나 직접 고를 수 있어요.</p>'}${meta.llm ? '' : '<p class="meta">AI 는 서버 환경변수 SUNSUTUBE_LLM_URL 에 주소를 넣으면 켜져요.</p>'}</div>
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
function renderUp() { $('#upList').innerHTML = files.map((f, i) => `<div class="uprow" data-i="${i}"><input class="t" maxlength="100" value="${esc(f.title)}" placeholder="제목" ${uploading ? 'disabled' : ''}><span class="st ${f.cls || ''}">${f.st || mb(f.file.size)}</span><div class="bar"><div style="width:${f.pct || 0}%"></div></div></div>`).join('');
  $$('#upList .t').forEach((inp, i) => inp.oninput = () => { files[i].title = inp.value; }); }
function addFiles(list) { for (const file of list) { if (files.some((f) => fkey(f.file) === fkey(file))) continue; files.push({ file, title: file.name.replace(/\.[^.]+$/, '') }); } renderUp(); }
function setRow(i, st, pct, cls) { Object.assign(files[i], { st, pct, cls }); const row = $(`#upList [data-i="${i}"]`); if (!row) return; $('.st', row).textContent = st; $('.st', row).className = 'st ' + (cls || ''); $('.bar div', row).style.width = pct + '%'; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function uploadOne(i, common) {
  const f = files[i].file, key = fkey(f), saved = ls.get('uploads', {});
  if (meta.maxBytes && f.size > meta.maxBytes) throw new Error(`너무 커요 (최대 ${gb(meta.maxBytes)})`);
  let uid = saved[key], received = 0;
  if (uid) try { received = (await api('api/uploads/' + uid)).received; setRow(i, `이어서 올리는 중 ${(received / f.size * 100).toFixed(0)}%`, received / f.size * 100); } catch { uid = null; }
  if (!uid) { uid = (await api('api/uploads', send('POST', { filename: f.name, size: f.size, title: files[i].title.trim() || f.name, ...common }))).uploadId; saved[key] = uid; ls.set('uploads', saved); }
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
  const common = { cat: $('#upCat').value, desc: $('#upDesc').value, tags: $('#upTags').value, visibility: $('#upVis').value }; let okN = 0, badN = 0;
  for (const i of todo) { try { setRow(i, '올리는 중 0%', 0); lastUploaded = await uploadOne(i, common); setRow(i, '올림 ✓', 100, 'ok'); okN++; } catch (er) { setRow(i, er.message, files[i].pct || 0, 'bad'); badN++; if (cancelled) break; } }
  uploading = false; $('#upGo').disabled = false; $('#upCancel').textContent = '닫기'; renderUp(); refreshMeta();
  msg.textContent = `${okN}개 올림${badN ? `, ${badN}개 실패` : ''}`; msg.className = badN ? 'msg bad' : 'msg';
  if (okN && !badN) { dlg.close(); files = []; $('#upDesc').value = ''; $('#upTags').value = ''; if (okN === 1 && lastUploaded) location.hash = '#/v/' + lastUploaded.id; else { location.hash = '#/'; route(); } }
};

refreshMeta().then(() => route()).catch((e) => { $('#view').innerHTML = `<div class="empty"><b>서버에 연결하지 못했어요</b>${esc(e.message)}</div>`; });
