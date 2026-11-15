/* 순수튜브 화면. 경로는 모두 상대 경로(런처의 /module/sunsutube/ 아래에서도 동작). */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opt) => { const r = await fetch(url, opt); const j = await r.json().catch(() => ({ ok: false, message: r.statusText })); if (!r.ok || j.ok === false) throw new Error(j.message || '요청 실패'); return j; };
const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
const ago = (iso) => { const d = (Date.now() - new Date(iso)) / 1000; if (d < 60) return '방금'; if (d < 3600) return Math.floor(d / 60) + '분 전'; if (d < 86400) return Math.floor(d / 3600) + '시간 전'; if (d < 86400 * 30) return Math.floor(d / 86400) + '일 전'; return new Date(iso).toLocaleDateString('ko-KR'); };
const gb = (b) => (b / 1024 ** 3).toFixed(b > 10 * 1024 ** 3 ? 0 : 1) + ' GB';
let meta = { categories: [] }, state = { q: '', cat: '', sort: 'new' }, poll = null;

function card(v) {
  const bg = v.thumb ? `style="background-image:url('thumb/${v.id}.jpg')"` : '';
  const st = v.status === 'processing' ? '<span class="state">⏳ 변환 중…</span>' : v.status === 'failed' ? '<span class="state">⚠ 변환 실패</span>' : (v.thumb ? '' : '<span class="state">▶</span>');
  return `<a class="card" href="#/v/${v.id}"><div class="thumb" ${bg}>${st}${v.duration ? `<span class="dur">${dur(v.duration)}</span>` : ''}</div>
    <div><h3>${esc(v.title)}</h3><div class="meta">${esc(v.category)} · 조회수 ${v.views}회 · ${ago(v.created)}</div></div></a>`;
}

async function home() {
  clearInterval(poll);
  const p = new URLSearchParams(); if (state.q) p.set('q', state.q); if (state.cat) p.set('cat', state.cat); p.set('sort', state.sort);
  const { videos } = await api('api/videos?' + p);
  const chips = ['', ...meta.categories].map((c) => `<button data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${c || '전체'}</button>`).join('');
  $('#view').innerHTML = `<div class="chips">${chips}<span class="sp"></span><select id="sort"><option value="new">최신순</option><option value="views">조회순</option><option value="likes">좋아요순</option></select></div>` +
    (videos.length ? `<div class="grid">${videos.map(card).join('')}</div>` :
      `<div class="empty"><b>${state.q || state.cat ? '찾는 영상이 없어요' : '아직 영상이 없어요'}</b>${state.q || state.cat ? '다른 말로 찾아 보세요.' : '첫 영상을 올려 보세요.'}</div>`);
  $('#sort').value = state.sort; $('#sort').onchange = (e) => { state.sort = e.target.value; home(); };
  $('#view').querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { state.cat = b.dataset.cat; home(); });
  if (videos.some((v) => v.status === 'processing')) poll = setInterval(() => { if (location.hash.startsWith('#/v/')) return; home(); }, 4000);
}

async function watch(id) {
  clearInterval(poll);
  let d; try { d = await api('api/videos/' + id); } catch (e) { $('#view').innerHTML = `<div class="empty"><b>${esc(e.message)}</b><a href="#/">처음으로</a></div>`; return; }
  const v = d.video;
  const player = v.status === 'ready' ? `<video id="player" controls autoplay playsinline src="media/${v.id}.mp4" ${v.thumb ? `poster="thumb/${v.id}.jpg"` : ''}></video>` :
    `<div class="thumb"><span class="state">${v.status === 'processing' ? '⏳ 영상을 줄이는 중이에요. 잠시 뒤 자동으로 열려요.' : '⚠ ' + esc(v.note || '변환 실패')}</span></div>`;
  $('#view').innerHTML = `<div class="watch"><section>${player}
    <h1>${esc(v.title)}</h1><div class="meta">${esc(v.category)} · 조회수 <span id="views">${v.views}</span>회 · ${ago(v.created)}${v.bytes ? ' · ' + (v.bytes / 1024 ** 2).toFixed(0) + ' MB' : ''}</div>
    <div class="actions"><button id="like">👍 좋아요 <b id="likes">${v.likes}</b></button><span class="sp"></span><button id="edit" class="ghost">고치기</button><button id="del" class="ghost">지우기</button></div>
    ${v.desc || v.tags.length ? `<div class="desc">${esc(v.desc)}${v.tags.length ? '\n' + v.tags.map((t) => `<a class="tag" href="#/" data-tag="${esc(t)}">#${esc(t)}</a>`).join('') : ''}</div>` : ''}
    <div class="comments"><h2>댓글 ${d.comments.length}개</h2>
      <form class="cform" id="cform"><input id="ctext" maxlength="1000" placeholder="댓글 추가"><label class="meta" style="white-space:nowrap;align-self:center"><input type="checkbox" id="cat" style="width:auto"> 지금 장면에</label><button class="primary">등록</button></form>
      <div id="clist">${d.comments.slice().reverse().map((c) => `<div class="comment"><button class="del ghost" data-cdel="${c.id}">삭제</button><span class="when" style="margin-left:0">${ago(c.created)}</span><div>${c.at != null ? `<a class="at" data-at="${c.at}">${dur(c.at)}</a>` : ''}${esc(c.text)}</div></div>`).join('')}</div></div>
    </section><aside class="side"><h2>관련 영상</h2>${d.related.map(card).join('') || '<div class="meta">아직 없어요</div>'}</aside></div>`;
  const pl = $('#player');
  if (pl) { let counted = false; pl.addEventListener('playing', async () => { if (counted) return; counted = true; const r = await api(`api/videos/${id}/view`, { method: 'POST' }).catch(() => null); if (r) $('#views').textContent = r.views; }); }
  else if (v.status === 'processing') poll = setInterval(async () => { const r = await api('api/videos/' + id).catch(() => null); if (r && r.video.status !== 'processing') watch(id); }, 3000);
  $('#like').onclick = async () => { const r = await api(`api/videos/${id}/like`, { method: 'POST' }); $('#likes').textContent = r.likes; };
  $('#del').onclick = async () => { if (!confirm(`'${v.title}' 영상을 지울까요? 되돌릴 수 없어요.`)) return; await api('api/videos/' + id, { method: 'DELETE' }); location.hash = '#/'; refreshMeta(); };
  $('#edit').onclick = async () => { const t = prompt('제목', v.title); if (t === null) return; const ds = prompt('설명', v.desc); if (ds === null) return; const tg = prompt('태그(쉼표로 구분)', v.tags.join(', ')); if (tg === null) return;
    try { await api('api/videos/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t, desc: ds, tags: tg }) }); watch(id); } catch (e) { alert(e.message); } };
  $('#cform').onsubmit = async (e) => { e.preventDefault(); const text = $('#ctext').value.trim(); if (!text) return;
    const body = { text }; if ($('#cat').checked && pl) body.at = Math.floor(pl.currentTime);
    try { await api(`api/videos/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); watch(id); } catch (err) { alert(err.message); } };
  $('#view').querySelectorAll('[data-at]').forEach((a) => a.onclick = () => { if (pl) { pl.currentTime = +a.dataset.at; pl.play(); pl.scrollIntoView({ block: 'center' }); } });
  $('#view').querySelectorAll('[data-cdel]').forEach((b) => b.onclick = async () => { if (confirm('댓글을 지울까요?')) { await api(`api/videos/${id}/comments/${b.dataset.cdel}`, { method: 'DELETE' }); watch(id); } });
  $('#view').querySelectorAll('[data-tag]').forEach((a) => a.onclick = () => { state.q = a.dataset.tag; $('#q').value = state.q; });
  window.scrollTo(0, 0);
}

function route() { const m = /^#\/v\/([0-9a-f]{12})$/.exec(location.hash); (m ? watch(m[1]) : home()).catch((e) => { $('#view').innerHTML = `<div class="empty"><b>${esc(e.message)}</b></div>`; }); }
window.addEventListener('hashchange', route);
$('#searchForm').onsubmit = (e) => { e.preventDefault(); state.q = $('#q').value.trim(); if (location.hash !== '#/' && location.hash !== '') location.hash = '#/'; else home(); };

async function refreshMeta() {
  meta = await api('api/meta');
  $('#upCat').innerHTML = meta.categories.map((c) => `<option>${esc(c)}</option>`).join('');
  const pct = meta.totalBytes ? 1 - meta.freeBytes / meta.totalBytes : 0;
  $('#disk').innerHTML = `영상 ${meta.videos}개 · ${meta.hours.toFixed(1)}시간 · ${gb(meta.usedBytes)} 사용` + (meta.freeBytes != null ? ` · <span class="${pct > 0.8 ? 'warn' : ''}">저장 공간 ${gb(meta.freeBytes)} 남음${pct > 0.8 ? ' (80% 넘게 찼어요)' : ''}</span>` : '') + (meta.compress ? '' : ' · <span class="warn">ffmpeg 없음: 압축 안 함</span>');
}

/* 올리기 */
const dlg = $('#uploadDlg'); let picked = null, xhr = null;
function pick(f) { picked = f || null; $('#fileName').textContent = f ? `${f.name} (${(f.size / 1024 ** 2).toFixed(0)} MB)` : '또는 여기에 끌어다 놓으세요'; if (f && !$('#upTitle').value) $('#upTitle').value = f.name.replace(/\.[^.]+$/, ''); }
$('#uploadBtn').onclick = () => { $('#upMsg').textContent = ''; $('#upMsg').className = 'msg'; $('.progress').hidden = true; dlg.showModal(); };
$('#upCancel').onclick = () => { if (xhr) xhr.abort(); dlg.close(); };
$('#file').onchange = (e) => pick(e.target.files[0]);
const drop = $('#drop'); ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
$('#uploadForm').onsubmit = (e) => {
  e.preventDefault(); const msg = $('#upMsg'); msg.className = 'msg';
  if (!picked) { msg.textContent = '영상 파일을 골라 주세요.'; msg.className = 'msg bad'; return; }
  if (meta.maxBytes && picked.size > meta.maxBytes) { msg.textContent = `영상이 너무 커요. 최대 ${gb(meta.maxBytes)} 까지예요.`; msg.className = 'msg bad'; return; }
  const p = new URLSearchParams({ filename: picked.name, title: $('#upTitle').value.trim(), cat: $('#upCat').value, desc: $('#upDesc').value, tags: $('#upTags').value });
  xhr = new XMLHttpRequest(); xhr.open('PUT', 'api/upload?' + p); $('.progress').hidden = false; $('#upGo').disabled = true;
  xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) { $('#bar').style.width = (ev.loaded / ev.total * 100).toFixed(1) + '%'; msg.textContent = `올리는 중 ${(ev.loaded / ev.total * 100).toFixed(0)}%`; } };
  const done = (ok, text, id) => { xhr = null; $('#upGo').disabled = false; msg.textContent = text; msg.className = ok ? 'msg' : 'msg bad'; if (ok) { $('#uploadForm').reset(); pick(null); $('#bar').style.width = '0'; dlg.close(); refreshMeta(); location.hash = '#/v/' + id; } };
  xhr.onload = () => { let j = {}; try { j = JSON.parse(xhr.responseText); } catch { } if (xhr.status === 200 && j.ok) done(true, '', j.video.id); else done(false, j.message || '올리지 못했어요.'); };
  xhr.onerror = () => done(false, '연결이 끊겼어요. 다시 시도해 주세요.'); xhr.onabort = () => done(false, '올리기를 취소했어요.');
  xhr.send(picked);
};

refreshMeta().then(route).catch((e) => { $('#view').innerHTML = `<div class="empty"><b>서버에 연결하지 못했어요</b>${esc(e.message)}</div>`; });
