const formatDate = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '暂未获取';
export function renderUsage(element, data) {
  element.replaceChildren();
  const line = (text, className = '') => { const p = document.createElement('p'); p.textContent = text; if (className) p.className = className; element.append(p); };
  if (data.message) line(data.message, 'fine');
  for (const w of (data.windows || []).filter(w => ['session', 'weekly'].includes(w.id))) {
    line(`${w.label}还剩 ${w.remainingPercent}%`);
    if (w.resetsAt) line(`${formatDate(w.resetsAt)} 恢复满额`, 'fine');
  }
  if (data.subscription?.expiresAt) line('订阅到期：' + formatDate(data.subscription.expiresAt), 'fine');
}

export function modelLabel(model) {
  return typeof model === 'string' ? model.replace(/^claude-/, '').replace(/^(sonnet|opus|haiku|fable)-/i, (_, name) => name[0].toUpperCase() + name.slice(1) + ' ').replace(/(\d)-(\d)(?:-\d{8})?$/, '$1.$2') : 'Claude';
}
