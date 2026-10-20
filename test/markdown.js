// Renders the assistant's Markdown with DOM nodes only (never innerHTML), so answer text can't inject markup.
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(\*[^*\s][^*\n]*\*)|(~~[^~\n]+~~)/;

function inline(parent, text) {
  while (text) {
    const m = INLINE.exec(text);
    if (!m) { parent.append(text); return; }
    if (m.index) parent.append(text.slice(0, m.index));
    const t = m[0];
    if (m[1]) parent.append(el('code', '', t.slice(1, -1)));
    else if (m[2]) inline(parent.appendChild(el('strong')), t.slice(2, -2));
    else if (m[3]) { const [, label, href] = /^\[([^\]]+)\]\((.+)\)$/.exec(t); const a = el('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; inline(a, label); parent.append(a); }
    else if (m[4]) inline(parent.appendChild(el('em')), t.slice(1, -1));
    else inline(parent.appendChild(el('del')), t.slice(2, -2));
    text = text.slice(m.index + t.length);
  }
}

function lines(parent, rows) { rows.forEach((row, i) => { if (i) parent.append(el('br')); inline(parent, row); }); }

function codeBlock(lang, code) {
  const plain = !lang || /^(text|plain|txt|plaintext)$/i.test(lang), label = plain ? '复制文本' : '复制代码';
  const wrap = el('div', 'code-block'), bar = el('div', 'code-bar'), copy = el('button', 'code-copy', label);
  copy.type = 'button';
  copy.onclick = async () => { try { await navigator.clipboard.writeText(code); copy.textContent = '已复制'; } catch { copy.textContent = '请手动选择'; } setTimeout(() => copy.textContent = label, 1600); };
  bar.append(el('span', '', plain ? '文本' : lang), copy);
  const pre = el('pre'); pre.append(el('code', '', code));
  wrap.append(bar, pre); return wrap;
}

const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function renderMarkdown(target, source) {
  const out = document.createDocumentFragment(), rows = source.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < rows.length;) {
    const row = rows[i];
    let m;
    if ((m = /^\s*(```|~~~)\s*([\w+-]*)/.exec(row))) {
      const fence = m[1], body = []; i++;
      while (i < rows.length && !rows[i].trim().startsWith(fence)) body.push(rows[i++]);
      i++; out.append(codeBlock(m[2], body.join('\n'))); continue;
    }
    if (!row.trim()) { i++; continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(row))) { const h = el(m[1].length <= 2 ? 'h3' : 'h4'); inline(h, m[2]); out.append(h); i++; continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(row)) { out.append(el('hr')); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(row) && /^\s*\|?\s*:?-{2,}/.test(rows[i + 1] || '')) {
      const table = el('table'), head = el('tr'); cells(row).forEach(c => inline(head.appendChild(el('th')), c));
      table.appendChild(el('thead')).append(head); const body = table.appendChild(el('tbody')); i += 2;
      while (i < rows.length && /^\s*\|/.test(rows[i])) { const tr = el('tr'); cells(rows[i++]).forEach(c => inline(tr.appendChild(el('td')), c)); body.append(tr); }
      const scroll = el('div', 'table-scroll'); scroll.append(table); out.append(scroll); continue;
    }
    if (/^\s*>/.test(row)) {
      const quote = [], q = el('blockquote');
      while (i < rows.length && /^\s*>/.test(rows[i])) quote.push(rows[i++].replace(/^\s*>\s?/, ''));
      renderMarkdown(q, quote.join('\n')); out.append(q); continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/, number = /^\s*(\d+)[.)]\s+(.*)$/;
    if (bullet.test(row) || number.test(row)) {
      const ordered = number.test(row), pattern = ordered ? number : bullet, list = el(ordered ? 'ol' : 'ul');
      if (ordered) list.start = Number(number.exec(row)[1]);
      while (i < rows.length && (pattern.test(rows[i]) || (/^\s{2,}\S/.test(rows[i]) && list.lastChild))) {
        const r = rows[i++], item = pattern.exec(r);
        if (item) inline(list.appendChild(el('li')), item[ordered ? 2 : 1]);
        else { list.lastChild.append(el('br')); inline(list.lastChild, r.trim()); }
        if (i < rows.length && !rows[i].trim() && (pattern.test(rows[i + 1] || ''))) i++;
      }
      out.append(list); continue;
    }
    const para = [];
    while (i < rows.length && rows[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|)/.test(rows[i])) para.push(rows[i++]);
    if (!para.length) para.push(rows[i++]);
    lines(out.appendChild(el('p')), para);
  }
  target.replaceChildren(out);
}
