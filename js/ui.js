// 화면 그리기를 돕는 작은 함수들

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// html`<p>${name}</p>` 처럼 쓰면 값이 자동으로 안전하게 바뀝니다. raw()로 감싼 값만 그대로 들어갑니다.
// html`` 결과도 raw 값이라서 html`` 안에 html``을 넣어도 두 번 바뀌지 않습니다.
export function html(strings, ...values) {
  return raw(strings.reduce((out, str, i) => {
    if (i >= values.length) return out + str;
    const v = values[i];
    const text = Array.isArray(v) ? v.map(toHtml).join('') : toHtml(v);
    return out + str + text;
  }, ''));
}

function toHtml(v) {
  if (v && v.__raw) return v.value;
  return escapeHtml(v);
}

export function raw(value) {
  return { __raw: true, value: String(value), toString() { return this.value; } };
}

export function render(target, markup) {
  target.innerHTML = String(markup);
}

export function showMessage(el, text, kind = 'error') {
  if (!el) return;
  el.textContent = text || '';
  el.className = `message ${text ? kind : ''}`;
  el.hidden = !text;
}

export function setBusy(button, busy, busyText = '잠시만요…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

export function formatDateTime(value) {
  if (!value) return '기록 없음';
  const d = new Date(value);
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}
