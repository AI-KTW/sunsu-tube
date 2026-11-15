/* 순수TV 아이콘: 글자 속 그림 문자(이모지)를 선으로 그린 아이콘으로 바꿔 화면을 한결같게 보이게 한다.
   화면 코드는 그대로 두고, 화면에 글자가 나타날 때마다 이 파일이 알아서 바꾼다. 사용자가 쓴 글(제목, 댓글, 채팅)은 건드리지 않는다. */
(() => {
  const P = {   // 24x24, 선 굵기 1.8. f = 채워 그리는 아이콘
    home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10', flame: 'M12 3c1 3.2 4.5 5.2 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.6.6-2.8 1.5-3.9.3 1.2.9 1.9 1.6 2.3C10.4 8.6 11 6 12 3z',
    list: 'M4 6h11M4 12h11M4 18h7M17 14l4.5 3-4.5 3z', clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7.5V12l3 2', later: 'M6 4h12v17l-6-4-6 4z', sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
    play: { d: 'M7 4.5l12.5 7.5L7 19.5z', f: 1 }, bolt: { d: 'M13.5 2L4.5 13.5h6.2L9.5 22l9.5-12h-6.4z', f: 1 }, pin: 'M9 3h6l-1 6 4 4H6l4-4zM12 13v8',
    up: 'M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7', down: { d: 'M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7', r: 1 },
    share: 'M14 5l6 6-6 6M20 11H9.5A5.5 5.5 0 0 0 4 16.5V19', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z', download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
    scissors: 'M6 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM8.3 8.2L20 20M8.3 15.8L20 4', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.6h.01', mosaic: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    volume: 'M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11', mute: 'M4 10v4h4l5 4V6L8 10zM17 9.5l4 5M21 9.5l-4 5', plus: 'M12 5v14M5 12h14', tag: 'M4 4h8l8 8-8 8-8-8zM8.5 8.5h.01',
    hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6c-2.8 0-4.3-1.4-5.8-3.9L3.4 14a1.5 1.5 0 0 1 2.5-1.6z', chart: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
    flag: 'M5 21V4h11l-2 4 2 4H5', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6', chat: 'M4 5h16v11H9l-5 4z', bot: 'M12 3v3M6 6h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM9 12h.01M15 12h.01M9 16h6',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', rec: { d: 'M12 6a6 6 0 1 0 0 12a6 6 0 0 0 0-12z', f: 1 }, search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM16 16l4.5 4.5',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z', rew: { d: 'M11 6l-7.5 6 7.5 6zM20.5 6L13 12l7.5 6z', f: 1 }, fwd: { d: 'M13 6l7.5 6-7.5 6zM3.5 6l7.5 6-7.5 6z', f: 1 },
    check: 'M5 12.5l4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6L6 18', eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z',
    mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4', hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9', alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
    stop: { d: 'M7 7h10v10H7z', f: 1 }, cup: 'M6 15l6-6 6 6', cdown: 'M6 9l6 6 6-6', cleft: 'M15 6l-6 6 6 6', cright: 'M9 6l6 6-6 6', menu: 'M4 7h16M4 12h16M4 17h16', arrowL: 'M19 12H5M11 6l-6 6 6 6', calendar: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4', pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'
  };
  const MAP = { '🏠': 'home', '🔥': 'flame', '📚': 'list', '🕘': 'clock', '⏰': 'later', '⚙': 'sliders', '▶': 'play', '⚡': 'bolt', '📌': 'pin', '👍': 'up', '👎': 'down', '↗': 'share', '📷': 'camera', '⬇': 'download', '✂': 'scissors', '🖼': 'image',
    '▦': 'mosaic', '🔊': 'volume', '🔇': 'mute', '➕': 'plus', '＋': 'plus', '🏷': 'tag', '✋': 'hand', '📊': 'chart', '🚩': 'flag', '🗑': 'trash', '💬': 'chat', '🤖': 'bot', '🔗': 'link', '⏺': 'rec', '🔍': 'search', '✨': 'sparkle', '⏪': 'rew', '⏩': 'fwd',
    '✓': 'check', '✕': 'x', '👀': 'eye', '🎙': 'mic', '⏳': 'hourglass', '⚠': 'alert', '■': 'stop', '▲': 'cup', '▼': 'cdown', '‹': 'cleft', '›': 'cright', '←': 'arrowL', '✎': 'pencil', '🔴': 'live' };
  const RE = new RegExp('(' + Object.keys(MAP).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?', 'u');
  // 사용자가 쓴 글과, 매 순간 글자가 바뀌는 곳은 건드리지 않는다
  const SKIP = '.comment > div:not(.ops), .cm, .desc, .watch h1, .card h3, .hero h1, .hero p, #shT, #shP, .pt, .ln, .sum, .hitline, .mgrow span, .atttable, .edrow, #edPlay, #blPlay, textarea, input, script, style, svg, .ic, .adm td:nth-child(3), .plrow b, .uprow';
  const svg = (name) => { if (name === 'live') return '<span class="ic livemark" aria-hidden="true"></span>'; const p = P[name], d = p.d || p;
    return `<svg class="ic${p.f ? ' fill' : ''}" viewBox="0 0 24 24" aria-hidden="true"${p.r ? ' style="transform:rotate(180deg)"' : ''}><path d="${d}"/></svg>`; };
  window.icon = svg;
  function fix(node) {
    if (!node.parentElement || node.parentElement.closest(SKIP)) return;
    let m, n = node;
    while ((m = RE.exec(n.nodeValue))) { const rest = n.splitText(m.index); rest.nodeValue = rest.nodeValue.slice(m[0].length); const t = document.createElement('template'); t.innerHTML = svg(MAP[m[1]]); rest.parentNode.insertBefore(t.content.firstChild, rest); n = rest; }
  }
  function scan(root) {
    if (root.nodeType === 3) return fix(root); if (root.nodeType !== 1) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = []; while (w.nextNode()) if (RE.test(w.currentNode.nodeValue)) list.push(w.currentNode); list.forEach(fix);
  }
  const start = () => { scan(document.body); new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') fix(m.target); else m.addedNodes.forEach(scan); } }).observe(document.body, { childList: true, subtree: true, characterData: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
