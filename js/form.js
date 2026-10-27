// 기록 양식에서 같이 쓰는 입력칸 만들기
import { html, raw } from './ui.js';
import { findVague } from './records.js';

let seq = 0;

// type: text | textarea | number | date | url
export function field({ name, label, required = false, hint = '', placeholder = '', value = '', type = 'text', rows = 4, attrs = '' }) {
  const id = `f-${name}-${++seq}`;
  const input = type === 'textarea'
    ? html`<textarea id="${id}" name="${name}" rows="${rows}" placeholder="${placeholder}" data-vague ${raw(attrs || '')}>${value ?? ''}</textarea>`
    : html`<input id="${id}" name="${name}" type="${type}" placeholder="${placeholder}" value="${value ?? ''}" ${raw(attrs || '')}>`;
  return html`
    <div class="field">
      <label for="${id}">${label}${required ? html` <span class="req">*</span>` : ''}</label>
      ${input}
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
      ${type === 'textarea' ? html`<p class="hint vague" hidden></p>` : ''}
    </div>`;
}

export function selectField({ name, label, required = false, options, value = '', hint = '', empty = '골라 주세요' }) {
  const id = `f-${name}-${++seq}`;
  return html`
    <div class="field">
      <label for="${id}">${label}${required ? html` <span class="req">*</span>` : ''}</label>
      <select id="${id}" name="${name}">
        <option value="">${empty}</option>
        ${options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const t = typeof o === 'object' ? o.label : o;
          return html`<option value="${v}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${t}</option>`;
        })}
      </select>
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
    </div>`;
}

// 여러 개 고르기. options: [{value, label}] 또는 글자 배열
export function checkGroup({ name, label, options, values = [], hint = '' }) {
  const chosen = new Set((values || []).map(String));
  return html`
    <fieldset class="field checks">
      <legend>${label}</legend>
      <div class="check-list">
        ${options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const t = typeof o === 'object' ? o.label : o;
          return html`<label class="check"><input type="checkbox" name="${name}" value="${v}" ${chosen.has(String(v)) ? 'checked' : ''}> ${t}</label>`;
        })}
      </div>
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
    </fieldset>`;
}

export function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
}

// 긴 글 칸에 "열심히", "많이" 같은 말이 들어가면 바로 아래에 안내를 띄웁니다.
export function bindVagueHints(root) {
  root.querySelectorAll('textarea[data-vague]').forEach((ta) => {
    const hintEl = ta.parentElement.querySelector('.hint.vague');
    const check = () => {
      const words = findVague(ta.value);
      hintEl.hidden = !words.length;
      hintEl.textContent = words.length
        ? `‘${words.join('’, ‘')}’ 대신 숫자나 구체적인 행동으로 써 보세요. 예: "3번 측정해 평균 12cm"`
        : '';
    };
    ta.addEventListener('input', check);
    check();
  });
}
