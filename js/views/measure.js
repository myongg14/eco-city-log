import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchMeasurements, fetchLogs, fetchJoinedLogs, fetchPeople, personName, formatDate, shortDate, todayKst } from '../records.js';
import { field, selectField, bindVagueHints } from '../form.js';
import { lineChart, bindCharts } from '../chart.js';

export function measureCard(m, { people, teams, meId, showAuthor = true }) {
  const team = teams.find((t) => t.id === m.team_id);
  return html`
    <article class="rec" data-kind="measure">
      <div class="rec-head">
        <span class="badge kind-measure">측정 기록</span>
        <span class="rec-date">${formatDate(m.measured_on)} · ${(m.points || []).length}번 측정</span>
      </div>
      <h3 class="rec-title">${m.title}</h3>
      ${showAuthor ? html`<p class="muted small">${personName(people, m.author_id)}${team ? ` · ${team.name}` : ''}</p>` : ''}
      ${lineChart(m)}
      ${m.conclusion ? html`<div class="rec-part"><h4>결과 해석</h4><p class="pre">${m.conclusion}</p></div>` : ''}
      ${m.author_id === meId ? html`
        <div class="rec-actions">
          <a class="secondary" href="#/measure/${m.id}">고치기</a>
          <button type="button" class="danger" data-del-measure="${m.id}">지우기</button>
        </div>` : ''}
    </article>`;
}

// 실험·측정 기록장 목록 (?f=mine|team|all)
export async function measureView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  const isStudent = me.role === 'student';
  const filter = params.get('f') || (isStudent ? 'mine' : 'all');
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let list, people;
  try {
    [list, people] = await Promise.all([fetchMeasurements(), fetchPeople()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const shown = list.filter((m) => (filter === 'mine' ? m.author_id === me.user_id : filter === 'team' ? m.team_id === me.team_id : true));
  const tab = (f, label) => html`<a href="#/measure?f=${f}" class="${filter === f ? 'active' : ''}">${label}</a>`;

  render(el, html`
    <section class="card">
      <div class="title-row">
        <h1 class="title">실험·측정 기록장</h1>
        ${isStudent ? html`<div class="title-actions"><a class="primary button-link" href="#/measure/new">+ 측정 기록</a></div>` : ''}
      </div>
      <p class="muted">측정값을 표로 넣으면 그래프로 그려져요. 같은 조건에서 여러 번 재고, 결과 해석까지 쓰면 동아리 영역의 좋은 근거가 돼요.</p>
      <div class="tabs">
        ${isStudent ? tab('mine', '내 기록') : ''}${isStudent ? tab('team', '우리 팀') : ''}${tab('all', '전체')}
      </div>
    </section>
    <div class="timeline" id="ms-list">
      ${shown.length ? shown.map((m) => html`<section class="card">${measureCard(m, { people, teams, meId: me.user_id })}</section>`)
        : html`<section class="card"><p class="muted">${filter === 'mine' ? '아직 측정 기록이 없어요. 실험한 날 ‘+ 측정 기록’으로 남겨 보세요.' : '아직 측정 기록이 없어요.'}</p></section>`}
    </div>
  `);
  bindCharts(el);
  el.querySelector('#ms-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-measure]');
    if (!del || !window.confirm('이 측정 기록을 지울까요?')) return;
    try {
      await rpc('delete_measurement', { p_id: Number(del.dataset.delMeasure) });
      toast('지웠어요.');
      measureView(el, ctx, params);
    } catch (err) {
      toast(err.message);
    }
  });
}

function rowMarkup(p = {}) {
  return html`
    <tr>
      <td><input name="px" value="${p.x ?? ''}" placeholder="1" aria-label="가로축 값"></td>
      <td><input name="py" value="${p.y ?? ''}" inputmode="decimal" placeholder="5.02" aria-label="측정값"></td>
      <td><input name="pn" value="${p.note ?? ''}" placeholder="" aria-label="메모"></td>
      <td><button type="button" class="link-button danger-text small" data-del-row aria-label="줄 지우기">✕</button></td>
    </tr>`;
}

export async function measureFormView(el, ctx, id) {
  const me = ctx.state.me;
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let m = {};
  let logs = [];
  try {
    const [mine, joined, found] = await Promise.all([
      fetchLogs({ authorId: me.user_id }), fetchJoinedLogs(me.user_id), id ? fetchMeasurements({ id }) : [],
    ]);
    logs = [...mine, ...joined.filter((l) => l.author_id !== me.user_id)].sort((a, b) => (a.log_date < b.log_date ? 1 : -1));
    if (id) {
      m = found[0];
      if (!m || m.author_id !== me.user_id) {
        render(el, html`<section class="card"><p class="message error">내가 쓴 측정 기록만 고칠 수 있어요.</p></section>`);
        return;
      }
    }
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const rows = m.points?.length ? m.points : [{}, {}, {}];

  render(el, html`
    <section class="card form-card">
      <h1 class="title">${id ? '측정 기록 고치기' : '실험·측정 기록'}</h1>
      <p class="muted">한 번의 실험에서 잰 값을 한 묶음으로 써요. 아래 표를 채우면 그래프가 바로 그려져요.</p>
      <form id="ms-form" novalidate>
        ${field({ name: 'title', label: '측정 이름', required: true, placeholder: '예: 태양광 패널 각도별 출력 전압', value: m.title })}
        <div class="field-row">
          ${field({ name: 'measured_on', label: '측정한 날', required: true, type: 'date', value: m.measured_on || todayKst(), attrs: `max="${todayKst()}"` })}
          ${field({ name: 'x_label', label: '가로축 (무엇에 따라)', required: true, placeholder: '예: 각도(°), 회차', value: m.x_label })}
        </div>
        <div class="field-row">
          ${field({ name: 'y_label', label: '측정한 것', required: true, placeholder: '예: 전압', value: m.y_label })}
          ${field({ name: 'unit', label: '단위', placeholder: '예: V', value: m.unit })}
        </div>
        <fieldset class="field">
          <legend>측정값 <span class="req">*</span></legend>
          <div class="table-wrap">
            <table class="table points"><thead><tr><th>가로축 값</th><th>측정값</th><th>메모</th><th></th></tr></thead>
              <tbody id="ms-rows">${rows.map((p) => rowMarkup(p))}</tbody></table>
          </div>
          <button type="button" class="secondary small" id="ms-add" data-draft-grow="px">+ 줄 추가</button>
          <p class="hint">숫자만 써요. 단위는 위 ‘단위’ 칸에 한 번만 쓰면 돼요.</p>
        </fieldset>
        <div id="ms-preview"></div>
        ${field({ name: 'conclusion', label: '결과 해석', type: 'textarea', rows: 3,
          placeholder: '예: 각도가 30°일 때 전압이 가장 높았고(5.1V), 60° 이상에서는 20% 넘게 떨어짐', value: m.conclusion })}
        ${selectField({ name: 'log_id', label: '관련 활동 일지 (고르지 않아도 돼요)', value: m.log_id, empty: '고르지 않음',
          options: logs.map((l) => ({ value: l.id, label: `${shortDate(l.log_date)} ${l.activity_type} · ${String(l.did).split('\n')[0].slice(0, 30)}` })) })}
        <p class="message" id="ms-msg" hidden></p>
        <button type="submit" class="primary" id="ms-btn">저장</button>
      </form>
    </section>
  `);

  const form = el.querySelector('#ms-form');
  const body = el.querySelector('#ms-rows');
  const msg = el.querySelector('#ms-msg');
  const btn = el.querySelector('#ms-btn');
  bindVagueHints(form);

  const readPoints = () => [...body.querySelectorAll('tr')].map((tr) => ({
    x: tr.querySelector('[name="px"]').value.trim(),
    y: tr.querySelector('[name="py"]').value.trim(),
    note: tr.querySelector('[name="pn"]').value.trim(),
  })).filter((p) => p.x || p.y);
  const v = (n) => form.elements[n].value.trim();

  function preview() {
    const pts = readPoints().filter((p) => p.x && p.y !== '' && !Number.isNaN(Number(p.y)));
    const box = el.querySelector('#ms-preview');
    if (pts.length < 2) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = String(lineChart({ title: v('title') || '미리 보기', x_label: v('x_label') || '가로축', y_label: v('y_label') || '측정값', unit: v('unit'), points: pts }));
    bindCharts(box);
  }

  el.querySelector('#ms-add').addEventListener('click', () => {
    body.insertAdjacentHTML('beforeend', String(rowMarkup()));
    body.lastElementChild.querySelector('input').focus();
  });
  body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-del-row]')) return;
    e.target.closest('tr').remove();
    if (!body.children.length) body.insertAdjacentHTML('beforeend', String(rowMarkup()));
    preview();
  });
  form.addEventListener('input', preview);
  preview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const points = readPoints();
    const data = {
      title: v('title'), measured_on: v('measured_on'), x_label: v('x_label'), y_label: v('y_label'), unit: v('unit'),
      conclusion: v('conclusion'), log_id: v('log_id'), points,
    };
    if (!data.title || !data.measured_on || !data.x_label || !data.y_label) return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    if (!points.length) return showMessage(msg, '측정값을 한 줄 이상 입력해 주세요.');
    const bad = points.find((p) => p.y === '' || Number.isNaN(Number(p.y)));
    if (bad) return showMessage(msg, `측정값은 숫자로 입력해 주세요. (${bad.x || '빈칸'} 줄)`);
    if (points.some((p) => !p.x)) return showMessage(msg, '가로축 값(회차, 시간 등)을 모두 채워 주세요.');
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_measurement', { p_id: id ? Number(id) : null, p_data: data });
      toast(id ? '측정 기록을 고쳤어요.' : '측정 기록을 저장했어요.');
      ctx.go('/measure');
    } catch (err) {
      showMessage(msg, err.message);
      setBusy(btn, false);
    }
  });
}
