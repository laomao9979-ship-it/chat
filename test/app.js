import { renderUsage, modelLabel } from './usage-view.js?v=41c793fc';
import { renderMarkdown } from './markdown.js?v=41c793fc';
const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer: coarse)').matches;
let currentId = sessionStorage.getItem('conversationId'), conversations = [], busy = false, paused = false, currentJob, pendingNode, timer, stream, follow = true;
// 页面固定在 Pages，只有接口 BASE 随隧道地址变化；本机主人预览仍走同源 cookie。
const remote = location.hostname === 'laomao9979-ship-it.github.io';
const test = new URLSearchParams(location.search).get('i') === 'test';
const KEY = test ? 'friend-chat-key-test' : 'friend-chat-key';
const NAME = test ? 'url-test.txt' : 'url.txt';
const SRC = 'https://laomao9979-ship-it.github.io/chat/' + NAME;
const GH = 'https://api.github.com/repos/laomao9979-ship-it/chat/contents/' + NAME + '?ref=main';
const store = (fn, fallback) => { try { return fn(localStorage); } catch { return fallback; } };
let BASE = '', deviceKey = remote ? store(s => s.getItem(KEY), '') || '' : '', fresh = false;
let ready = false, sending = null, linkDown = false, stopping = null, shown = null, currentPrompt = '';
const valid = u => /^https:\/\/[a-z0-9-]+\.(lhr\.life|localhost\.run)$/i.test(u || '');
async function alive(base = BASE) {
  if (remote && !valid(base)) return false;
  try { const r = await fetch(base + '/api/health', { cache: 'no-store', credentials: remote ? 'omit' : 'same-origin', signal: AbortSignal.timeout(8000) }); return r.ok && (await r.json()).app === 'friend-chat'; } catch { return false; }
}
function boot(message = '聊天暂时没开，开了会自动进入。') {
  $('boot-message').textContent = navigator.onLine === false ? '你的网络好像断了，连上后会自动进入。' : message;
}
// 地址读取不带钥匙；Pages 还没部署最新地址时，直接问 GitHub 内容接口。
let ghAt = 0, ghBlockedUntil = 0, reconnecting = null;
async function read(url, gh) {
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
    if (gh && (r.status === 403 || r.status === 429)) ghBlockedUntil = Math.max(Date.now() + 60000, Number(r.headers.get('x-ratelimit-reset') || 0) * 1000);
    if (!r.ok) return null;
    return gh ? atob((await r.json()).content.replace(/\s/g, '')).trim() : (await r.text()).trim();
  } catch { return null; }
}
function reconnect() {
  if (reconnecting) return reconnecting;
  link(false); boot();
  reconnecting = new Promise(resolve => {
    let done = false, pageBusy = false, ghBusy = false, oldBusy = false;
    const probing = new Set();
    async function probe(u) {
      if (done || (remote && !valid(u)) || probing.has(u)) return;
      probing.add(u);
      try { if (await alive(u) && !done) { done = true; BASE = u; clearInterval(pagesTimer); clearInterval(githubTimer); clearInterval(oldTimer); link(true); resolve(); } }
      finally { probing.delete(u); }
    }
    async function pages() { if (pageBusy || done) return; pageBusy = true; try { void probe(await read(SRC + '?t=' + Date.now())); } finally { pageBusy = false; } }
    async function github() {
      if (ghBusy || done || Date.now() < ghAt || Date.now() < ghBlockedUntil) return;
      ghBusy = true; ghAt = Date.now() + 20000;
      try { void probe(await read(GH, true)); } finally { ghBusy = false; }
    }
    async function old() { if (oldBusy || done) return; oldBusy = true; try { boot(); await probe(BASE); } finally { oldBusy = false; } }
    // 独立计时，失效地址的健康检查不会拖慢每 3 秒一次的 Pages 查询。
    const pagesTimer = remote ? setInterval(pages, 3000) : null;
    const githubTimer = remote ? setInterval(github, 1000) : null;
    const oldTimer = setInterval(old, 3000);
    ghAt = 0;
    if (remote) { void github(); void pages(); }
    void old();
  }).finally(() => { reconnecting = null; });
  return reconnecting;
}
const requestHeaders = data => ({ ...(remote && deviceKey ? { Authorization: 'Bearer ' + deviceKey } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) });
async function api(url, data) {
  for (;;) {
    if (remote && !BASE) await reconnect();
    const base = BASE;
    let r, x;
    try {
      r = await fetch(base + url, { credentials: remote ? 'omit' : 'same-origin', headers: requestHeaders(data), signal: AbortSignal.timeout(45000), ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
      x = await r.json();
      if (r.status >= 500 && !(await alive(base))) { await reconnect(); continue; }
    } catch {
      // 原请求号、草稿和回答都留在本页，接好后重试同一请求。
      if (await alive(base)) throw Object.assign(new Error('网络暂时连不上，正在重试。'), { retry: true });
      await reconnect(); continue;
    }
    link(true);
    if (r.status === 401 && url !== '/api/login') {
      if (remote) { deviceKey = ''; store(s => s.removeItem(KEY)); }
      ready = false; clearTimeout(timer); stream?.abort(); stream = null; currentJob = null; setBusy(false); screen(false);
    }
    if (!r.ok) { const e = new Error(x.error); e.status = r.status; e.retry = x.retry; throw e; }
    return x;
  }
}
function screen(loggedIn) { $('booting').hidden = true; $('login-screen').hidden = loggedIn; $('chat-screen').hidden = !loggedIn; if (!loggedIn) $('access-code').focus(); }
function drawer(open) { $('chat-screen').classList.toggle('drawer-open', open); $('scrim').hidden = !open; $('menu').setAttribute('aria-expanded', String(open)); }
function grow() { const t = $('message-input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, innerHeight * 0.35) + 'px'; $('send').disabled = busy || !t.value.trim(); }
function setBusy(value) {
  busy = value; $('send').hidden = value; $('stop').hidden = !value;
  // 模型和思考强度答题时也能改，管的是下一条。
  for (const id of ['new-chat', 'new-chat-mobile']) $(id).disabled = value;
  $('chat-screen').classList.toggle('is-busy', value); grow();
}

// Scroll: stay pinned to the newest text unless the reader scrolled up.
const nearBottom = () => { const m = $('messages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 80; };
function toBottom(force) { if (force) follow = true; if (follow) $('messages').scrollTop = $('messages').scrollHeight; $('to-bottom').hidden = follow; }
$('messages').addEventListener('scroll', () => { follow = nearBottom(); $('to-bottom').hidden = follow; }, { passive: true });
$('to-bottom').onclick = () => toBottom(true);

// 思考过程：夹在名字和回答中间，平时折叠，点开看全文；正在想时折叠行里滚动显示最新一句。
function setThought(article, thinking, seconds, live) {
  let box = article.querySelector('.thought');
  if (!thinking) { box?.remove(); return; }
  if (!box) {
    box = document.createElement('details'); box.className = 'thought';
    const summary = document.createElement('summary');
    const row = document.createElement('span'); row.className = 'thought-row';
    const dot = document.createElement('i'); dot.className = 'thought-dot'; dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'thought-label';
    const hint = document.createElement('span'); hint.className = 'thought-hint';
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); chevron.setAttribute('viewBox', '0 0 24 24'); chevron.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M9 6l6 6-6 6'); chevron.append(path);
    row.append(dot, label, hint, chevron);
    const preview = document.createElement('span'); preview.className = 'thought-preview';
    summary.append(row, preview);
    const body = document.createElement('div'); body.className = 'thought-body content';
    box.append(summary, body);
    box.addEventListener('toggle', () => { box.querySelector('.thought-hint').textContent = box.open ? '收起' : '展开'; if (box.open && box.classList.contains('live')) box.querySelector('.thought-body').scrollTop = 1e9; });
    article.querySelector('.sender').after(box);
  }
  box.classList.toggle('live', live);
  box.querySelector('.thought-label').textContent = live ? `正在思考 · ${seconds || 0} 秒` : `思考了 ${seconds || 1} 秒`;
  box.querySelector('.thought-hint').textContent = box.open ? '收起' : '展开';
  // 折叠时露出最新的一句，看得到它在想什么、没卡住。
  const lines = thinking.trim().split(/\n+/);
  const last = lines.at(-1).replace(/[*#`>_]/g, '').trim();
  box.querySelector('.thought-preview').textContent = live ? (last.length > 70 ? '…' + last.slice(-70) : last) : '';
  const body = box.querySelector('.thought-body');
  if (body.dataset.raw !== thinking) {
    const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    body.dataset.raw = thinking; renderMarkdown(body, thinking);
    if (stick) body.scrollTop = body.scrollHeight;
  }
}
function message(role, text, model, unfinished, thought) {
  const article = document.createElement('article'); article.className = 'message ' + role;
  const content = document.createElement('div'); content.className = 'content';
  if (role === 'user') { content.textContent = text; article.append(content); }
  else {
    const sender = document.createElement('p'); sender.className = 'sender';
    const mark = document.createElement('span'); mark.className = 'avatar'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '✳';
    sender.append(mark, (model ? modelLabel(model) : $('model-select').selectedOptions[0]?.textContent || 'Claude') + (unfinished ? ' · 未答完' : ''));
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy text-button'; copy.textContent = '复制回答';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(content.dataset.raw || content.textContent); copy.textContent = '已复制'; } catch { copy.textContent = '请长按选择文字'; } setTimeout(() => copy.textContent = '复制回答', 1800); };
    actions.append(copy); article.append(sender, content, actions); setAnswer(content, text);
    if (thought?.thinking) setThought(article, thought.thinking, thought.thinkingSeconds, false);
  }
  $('thread').append(article); return content;
}
function setAnswer(node, text, status) {
  node.dataset.raw = text || '';
  node.closest('.message')?.classList.toggle('waiting', !text);
  if (text) renderMarkdown(node, text);
  else { const dots = document.createElement('div'); dots.className = 'typing'; dots.append(...[0, 1, 2].map(() => document.createElement('i'))); const s = document.createElement('span'); s.className = 'typing-status'; s.textContent = status || ''; node.replaceChildren(dots, s); }
}
function empty() {
  const e = document.createElement('div'); e.className = 'empty';
  const mark = document.createElement('span'); mark.className = 'logo'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '✳';
  const h = document.createElement('h2'); h.textContent = '今天想聊些什么？';
  const p = document.createElement('p'); p.textContent = '在下面输入，随便聊。';
  e.append(mark, h, p); $('thread').append(e);
}
const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function renderList() {
  $('conversation-list').replaceChildren();
  if (!conversations.length) { const p = document.createElement('p'); p.className = 'list-empty'; p.textContent = '还没有对话'; $('conversation-list').append(p); }
  for (const c of [...conversations].reverse()) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'conversation'; b.title = c.title; b.setAttribute('aria-current', String(c.id === currentId));
    const t = document.createElement('span'); t.textContent = c.title; b.append(t);
    if (c.touched) { const d = document.createElement('small'); d.textContent = when(c.touched); b.append(d); }
    b.onclick = () => { if (busy) return; drawer(false); currentId = c.id; sessionStorage.setItem('conversationId', c.id); render(); if (c.pending) void watch(c.pending.id, c.pending.text); };
    $('conversation-list').append(b);
  }
}
function render() {
  renderList();
  const c = conversations.find(c => c.id === currentId);
  $('conversation-title').textContent = c?.title || '新对话';
  status();
  $('thread').replaceChildren();
  if (!c?.messages.length && !c?.pending) empty();
  for (const m of c?.messages || []) message(m.role, m.content, m.model, m.interrupted, m);
  toBottom(true);
}
// 顶栏状态：断网或连不上时如实写，接上后恢复。
function status() {
  const used = conversations.find(c => c.id === currentId)?.messages.findLast(m => m.role === 'assistant')?.model;
  $('availability').textContent = linkDown ? '正在重新连接…记录都在' : paused ? '聊天已暂停，等待恢复' : used ? `在线 · 本对话用 ${modelLabel(used)}` : '在线，可以开始聊天';
  $('availability').classList.toggle('warning', linkDown);
}
function link(ok) { if (linkDown === !ok) return; linkDown = !ok; if (ready) status(); }
addEventListener('offline', () => { boot(); void reconnect(); });
addEventListener('online', () => { boot(); void reconnect(); });
async function load() {
  const s = await api('/api/session'); conversations = s.conversations;
  // 上次的选择以服务那边记的为准，没有再看本机。
  for (const [id, items, fallback] of [['model', s.models, 'sonnet'], ['effort', s.efforts, 'auto']]) {
    const select = $(id + '-select'); let saved = s.prefs?.[id]; try { if (!items.some(x => x.id === saved)) saved = localStorage.getItem('friend-chat-' + id); } catch {}
    select.replaceChildren(...items.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; return option; }));
    select.value = items.some(x => x.id === saved) ? saved : fallback;
  }
  screen(true); paused = !!s.paused;
  $('chat-screen').classList.toggle('is-paused', !!s.paused);
  if (currentId && !conversations.some(c => c.id === currentId)) { currentId = null; sessionStorage.removeItem('conversationId'); }
  // 没选对话时，先打开正在回答的那段，否则接着上次最近的一段。
  if (!currentId && !fresh) { currentId = (conversations.find(c => c.pending) ?? conversations.at(-1))?.id ?? null; if (currentId) sessionStorage.setItem('conversationId', currentId); }
  ready = true; render(); void refreshUsage();
  const pending = conversations.find(c => c.id === currentId)?.pending;
  if (pending && !busy) void watch(pending.id, pending.text);
}

function statusText(j) {
  if (j.state === 'queued') return `排队中，前面还有 ${Math.max(0, j.position - 1)} 条`;
  return j.phase ? '已接上模型，等它开始想' : '正在连接';
}
function finish(j, prompt) {
  clearTimeout(timer); stream?.abort(); stream = null; currentJob = null;
  const done = j.state === 'done', text = done ? j.text : j.text || (j.state === 'cancelled' ? '（已停止回答。）' : '（这次没有完成回答。）');
  const c = conversations.find(c => c.id === j.conversationId);
  const thought = j.thinking ? { thinking: j.thinking, thinkingSeconds: j.thinkingSeconds } : {};
  if (c) { c.messages.push({ role: 'user', content: prompt }, { role: 'assistant', content: text, model: j.actualModel, ...thought, ...(done ? {} : { interrupted: true }) }); c.pending = null; c.touched = Date.now(); }
  setAnswer(pendingNode, text); setThought(pendingNode.closest('.message'), j.thinking, j.thinkingSeconds, false);
  const sender = pendingNode.closest('.message').querySelector('.sender').lastChild; sender.textContent = (j.actualModel ? modelLabel(j.actualModel) : sender.textContent) + (done ? '' : ' · 未答完');
  setBusy(false); renderList(); status();
  if (j.state === 'error') { $('request-error').textContent = j.error || ''; if (!$('message-input').value) { $('message-input').value = prompt; grow(); } }
  else if (!touch) $('message-input').focus();
}
function update(j, prompt) {
  if (j.id !== currentJob) return true; shown = j;
  if (j.actualModel) pendingNode.closest('.message').querySelector('.sender').lastChild.textContent = modelLabel(j.actualModel);
  setThought(pendingNode.closest('.message'), j.thinking, j.thinkingSeconds, j.state === 'running' && !j.text);
  setAnswer(pendingNode, j.text, statusText(j) + (j.elapsedSeconds ? ` · ${j.elapsedSeconds} 秒` : ''));
  toBottom();
  if (['done', 'error', 'cancelled'].includes(j.state)) { void finish(j, prompt); return true; }
}
async function watch(id, prompt, existingNode) {
  currentJob = id; currentPrompt = prompt; shown = null; setBusy(true); $('request-error').textContent = '';
  if (!existingNode) { $('thread').querySelector('.empty')?.remove(); message('user', prompt); }
  pendingNode = existingNode || message('assistant', ''); toBottom(true);
  // fetch 流可以带 Bearer；无首帧、流停住或断开时，都回落到同一任务的轮询。
  const controller = stream = new AbortController();
  let idle = setTimeout(() => controller.abort(), 8000), reader;
  try {
    const r = await fetch(BASE + '/api/jobs/' + id + '/events', { headers: requestHeaders(), credentials: remote ? 'omit' : 'same-origin', signal: controller.signal });
    if (!r.ok || !r.headers.get('content-type')?.startsWith('text/event-stream') || !r.body) throw new Error('流式连接没有接上。');
    reader = r.body.getReader();
    const decoder = new TextDecoder(); let buffer = '';
    while (currentJob === id) {
      const { value, done } = await reader.read();
      if (done) break;
      clearTimeout(idle); idle = setTimeout(() => controller.abort(), 25000);
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data && update(JSON.parse(data), prompt)) return;
      }
    }
  } catch { /* 任务仍在服务端继续，下面用轮询接上。 */ }
  finally {
    clearTimeout(idle); await reader?.cancel().catch(() => {}); controller.abort();
    if (stream === controller) stream = null;
    if (currentJob === id) void poll(id, prompt, 0);
  }
}
async function poll(id, prompt, failures) {
  if (currentJob !== id) return;
  try {
    const j = await api('/api/jobs/' + id);
    if (!update(j, prompt)) timer = setTimeout(() => poll(id, prompt, 0), 700);
  } catch (e) {
    if (currentJob !== id) return;
    if (e.status === 401) { setBusy(false); screen(false); return; }
    if (e.status === 404) {
      // 服务重启后任务内存已清空，回读落盘结果，保留输入框和当前对话。
      try {
        const s = await api('/api/session'), c = s.conversations.find(c => c.id === currentId);
        const last = c?.messages.at(-1);
        const result = c?.messages.at(-2)?.content === prompt && last?.role === 'assistant' ? last : null;
        finish({ id, conversationId: currentId, state: result && !result.interrupted ? 'done' : 'error', text: result?.content || pendingNode.dataset.raw, actualModel: result?.model, thinking: result?.thinking, thinkingSeconds: result?.thinkingSeconds, error: result && !result.interrupted ? '' : '这条回答被中断了，请重新发送。' }, prompt);
        return;
      } catch (x) { if (x.status === 401) return; }
    }
    // 网络一时断了就一直重试，接上后回答接着显示。
    if (!pendingNode.dataset.raw) setAnswer(pendingNode, '', '连接暂时中断，正在重新连接…');
    timer = setTimeout(() => poll(id, prompt, failures + 1), failures < 5 ? 2500 : 6000);
  }
}

$('login-form').onsubmit = async e => {
  e.preventDefault(); const b = e.submitter; $('login-error').textContent = '';
  if (!$('access-code').value.trim()) { $('login-error').textContent = '请先输入口令。'; $('access-code').focus(); return; }
  b.disabled = true;
  try {
    const x = await api('/api/login', { code: $('access-code').value }); $('access-code').value = '';
    if (x.key && remote) { deviceKey = x.key; store(s => s.setItem(KEY, x.key)); }
    await load();
  } catch (x) { $('login-error').textContent = x.message; } finally { b.disabled = false; }
};
$('new-chat').onclick = $('new-chat-mobile').onclick = () => { if (busy) return; drawer(false); currentId = null; sessionStorage.removeItem('conversationId'); $('request-error').textContent = ''; $('message-input').value = ''; grow(); render(); if (!touch) $('message-input').focus(); };
$('logout').onclick = async () => {
  if (!confirm('退出后，这台设备下次要重新输入口令。确定退出吗？')) return;
  try { await api('/api/logout', {}); }
  catch (e) { $('request-error').textContent = e.message; return; }
  clearTimeout(timer); stream?.abort(); stream = null; currentJob = null; drawer(false); ready = false;
  deviceKey = ''; store(s => s.removeItem(KEY)); currentId = null; conversations = []; sessionStorage.removeItem('conversationId'); setBusy(false); screen(false);
};
async function send(prompt, requestId = crypto.randomUUID()) {
  setBusy(true); $('request-error').textContent = '';
  $('thread').querySelector('.empty')?.remove(); message('user', prompt); const node = message('assistant', ''); setAnswer(node, '', '正在发送');
  $('message-input').value = ''; grow(); toBottom(true);
  sending = { text: prompt, requestId };
  try {
    const request = { requestId, conversationId: currentId, text: prompt, model: $('model-select').value, effort: $('effort-select').value };
    let j;
    // 服务正在更新时先等着，接好后用原请求号自动发出。
    for (let i = 0; ; i++) {
      try { await stopping; j = await api('/api/chat', request); break; }
      catch (x) { if (!x.retry || i > 80) throw x; setAnswer(node, '', '正在重新连接，马上好…'); await new Promise(r => setTimeout(r, 3000)); }
    }
    sending = null; setAnswer(node, '', statusText(j));
    currentId = j.conversationId; sessionStorage.setItem('conversationId', currentId);
    if (!conversations.some(c => c.id === currentId)) { conversations.push({ id: currentId, title: prompt.slice(0, 22), messages: [], touched: Date.now() }); $('conversation-title').textContent = prompt.slice(0, 22); }
    await watch(j.id, prompt, node);
  } catch (x) {
    sending = null; setBusy(false); node.closest('.message').remove(); $('thread').lastElementChild?.remove();
    if (!$('thread').children.length) empty();
    $('message-input').value = prompt; grow(); $('request-error').textContent = x.message; if (x.status === 401) screen(false);
  }
}
$('chat-form').onsubmit = e => { e.preventDefault(); const prompt = $('message-input').value.trim(); if (prompt && !busy) void send(prompt); };
$('message-input').addEventListener('input', grow);
$('message-input').addEventListener('keydown', e => { if (!touch && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chat-form').requestSubmit(); } });
if (touch) { $('message-input').placeholder = '输入想聊的，点右下角箭头发送'; $('message-input').setAttribute('enterkeyhint', 'enter'); }
$('menu').onclick = () => drawer(!$('chat-screen').classList.contains('drawer-open'));
$('close-menu').onclick = $('scrim').onclick = () => drawer(false);
addEventListener('keydown', e => { if (e.key === 'Escape') drawer(false); });
$('stop').onclick = () => {
  if (!currentJob) return;
  const node = pendingNode, conv = conversations.find(c => c.id === currentId);
  // 停止请求送到前服务器多收的几句也补上屏，和刷新后、模型看到的一致。
  stopping = api('/api/jobs/' + currentJob + '/cancel', {}).then(j => { if (!j?.text || j.text === node.dataset.raw) return; setAnswer(node, j.text); const m = conv?.messages.at(-1); if (m?.role === 'assistant') m.content = j.text; }).catch(e => { $('request-error').textContent = e.message; }).finally(() => { stopping = null; });
  finish({ ...shown, conversationId: currentId, state: 'cancelled', text: pendingNode.dataset.raw }, currentPrompt);
};
for (const id of ['model', 'effort']) $(id + '-select').onchange = () => {
  try { localStorage.setItem('friend-chat-' + id, $(id + '-select').value); } catch {}
  void api('/api/prefs', { model: $('model-select').value, effort: $('effort-select').value }).catch(() => {});
};
async function refreshUsage() {
  if ($('chat-screen').hidden) return;
  try { renderUsage($('account-usage'), await api('/api/account')); }
  catch { renderUsage($('account-usage'), { state: 'unavailable', message: '暂时无法读取额度，请稍后刷新。' }); }
}
setInterval(refreshUsage, 60_000);
// 空闲时也探测入口，换地址只换 BASE，页面与草稿原地保留。
setInterval(async () => { if (ready && !document.hidden && !linkDown && !(await alive())) void reconnect(); }, 15_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void refreshUsage(); if (ready) void alive().then(ok => { if (!ok) void reconnect(); }); } });
async function start() {
  if (remote) await reconnect();
  for (;;) {
    try { await load(); return; }
    catch (e) {
      if (e.status === 401) { screen(false); return; }
      boot('不用刷新，接上会自动进入。');
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
void start();
