import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast, formatDateTime } from '../ui.js';
import { fetchEvents, fetchChecks, fetchTasks, fetchPeople, personName, EVENT_KINDS, CHECK_STATUSES, formatDate, shortDate, addDays, todayKst } from '../records.js';
import { field, selectField } from '../form.js';

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

function monthOf(param) {
  return /^\d{4}-\d{2}$/.test(param || '') ? param : todayKst().slice(0, 7);
}

function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// 통합 일정(달력) + 통합 테스트 체크리스트
export async function scheduleView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  const isStaff = me.role !== 'student';
  const tab = params.get('t') === 'test' ? 'test' : 'cal';
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let events, checks, tasks, people;
  try {
    [events, checks, tasks, people] = await Promise.all([fetchEvents(), fetchChecks(), fetchTasks(), fetchPeople()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  const teamName = (id) => teams.find((t) => t.id === id)?.name || '전체';
  const redraw = () => scheduleView(el, ctx, params);
  const tabs = html`
    <div class="tabs">
      <a href="#/schedule" class="${tab === 'cal' ? 'active' : ''}">통합 일정</a>
      <a href="#/schedule?t=test" class="${tab === 'test' ? 'active' : ''}">통합 테스트</a>
    </div>`;

  if (tab === 'test') return drawChecks();
  return drawCalendar();

  // ------------------------------------------------------------------
  function drawCalendar() {
    const month = monthOf(params.get('m'));
    const first = `${month}-01`;
    const startOffset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const gridStart = addDays(first, -startOffset);
    const nextMonth = `${shiftMonth(month, 1)}-01`;
    const weeks = Math.ceil((startOffset + Math.round((new Date(`${nextMonth}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / 86400000)) / 7);
    const today = todayKst();

    // 그 날의 일정: 통합 일정 + 할 일 마감일
    const items = [
      ...events.map((e) => ({ day: e.event_date, end: e.end_date || e.event_date, kind: e.kind, title: e.title, team: e.team_id, e })),
      ...tasks.filter((t) => t.due_date && t.status !== '완료').map((t) => ({ day: t.due_date, end: t.due_date, kind: '할 일', title: t.title, team: t.team_id, t })),
    ];
    const on = (day) => items.filter((i) => i.day <= day && i.end >= day);
    const inMonth = items.filter((i) => i.end >= first && i.day < nextMonth).sort((a, b) => (a.day < b.day ? -1 : 1));
    const editing = Number(params.get('edit')) || null;
    const ev = events.find((e) => e.id === editing) || {};

    render(el, html`
      <section class="card">
        <h1 class="title">통합 일정</h1>
        <p class="muted">모든 팀의 마감과 모형을 합치는 날을 한 달력에 모았어요. 할 일 보드의 마감일도 함께 보여요.</p>
        ${tabs}
        <div class="cal-head">
          <a class="secondary small" href="#/schedule?m=${shiftMonth(month, -1)}" aria-label="이전 달">‹</a>
          <strong>${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월</strong>
          <a class="secondary small" href="#/schedule?m=${shiftMonth(month, 1)}" aria-label="다음 달">›</a>
        </div>
        <div class="cal" role="grid">
          ${DAY_NAMES.map((d) => html`<div class="cal-dow">${d}</div>`)}
          ${Array.from({ length: weeks * 7 }, (_, i) => {
            const day = addDays(gridStart, i);
            const list = on(day);
            return html`
              <div class="cal-day ${day.slice(0, 7) !== month ? 'other' : ''} ${day === today ? 'today' : ''}">
                <span class="cal-num">${Number(day.slice(8))}</span>
                ${list.slice(0, 2).map((x) => html`<span class="cal-chip k-${x.kind === '할 일' ? 'task' : x.kind}" title="${x.title}">${x.title}</span>`)}
                ${list.length > 2 ? html`<span class="cal-more">+${list.length - 2}</span>` : ''}
              </div>`;
          })}
        </div>
        <p class="hint">
          ${['통합', '마감', '발표', '회의', '기타'].map((k) => html`<span class="cal-chip k-${k}">${k}</span> `)}
          <span class="cal-chip k-task">할 일</span>
        </p>
      </section>

      <section class="card">
        <h2 class="subtitle">${Number(month.slice(5))}월 일정 ${inMonth.length}개</h2>
        ${inMonth.length ? html`<ul class="recent" id="ev-list">
          ${inMonth.map((x) => html`
            <li>
              <span class="badge ${x.kind === '통합' ? 'warn' : ''}">${x.kind}</span>
              <span class="recent-text"><strong>${x.title}</strong>${x.e?.detail ? html`<br><span class="small pre">${x.e.detail}</span>` : ''}</span>
              <span class="muted small">${formatDate(x.day)}${x.end !== x.day ? ` ~ ${shortDate(x.end)}` : ''} · ${teamName(x.team)}${x.t?.assignee_id ? ` · ${personName(people, x.t.assignee_id)}` : ''}</span>
              ${isStaff && x.e ? html`<span class="row-actions">
                <a class="link-button small" href="#/schedule?m=${month}&edit=${x.e.id}">고치기</a>
                <button type="button" class="link-button danger-text small" data-del-event="${x.e.id}">지우기</button></span>` : ''}
            </li>`)}
        </ul>` : html`<p class="muted">이 달에는 일정이 없어요.</p>`}
      </section>

      ${isStaff ? html`
        <section class="card">
          <details ${editing ? 'open' : ''} id="ev-new">
            <summary>${editing ? '일정 고치기' : '+ 일정 추가'}</summary>
            <form id="ev-form" novalidate>
              ${field({ name: 'title', label: '일정 이름', required: true, placeholder: '예: 모형 합치는 날 (1차)', value: ev.title })}
              <div class="field-row">
                ${selectField({ name: 'kind', label: '종류', options: EVENT_KINDS, value: ev.kind || '마감', empty: '마감' })}
                ${field({ name: 'event_date', label: '날짜', required: true, type: 'date', value: ev.event_date || today })}
                ${field({ name: 'end_date', label: '끝나는 날 (여러 날일 때)', type: 'date', value: ev.end_date })}
              </div>
              ${selectField({ name: 'team_id', label: '팀', options: teams.map((t) => ({ value: t.id, label: t.name })), value: ev.team_id, empty: '전체' })}
              ${field({ name: 'detail', label: '자세한 내용', type: 'textarea', rows: 2, placeholder: '예: 7교시 과학실, 각 팀 결과물 가져오기', value: ev.detail })}
              <p class="message" id="ev-msg" hidden></p>
              <div class="row-actions">
                <button type="submit" class="primary" id="ev-btn">${editing ? '고친 내용 저장' : '일정 추가'}</button>
                ${editing ? html`<a class="secondary" href="#/schedule?m=${month}">취소</a>` : ''}
              </div>
            </form>
          </details>
        </section>` : ''}
    `);

    el.querySelector('#ev-list')?.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del-event]');
      if (!del || !window.confirm('이 일정을 지울까요?')) return;
      try {
        await rpc('delete_event', { p_id: Number(del.dataset.delEvent) });
        toast('일정을 지웠어요.');
        redraw();
      } catch (err) {
        toast(err.message);
      }
    });

    const form = el.querySelector('#ev-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = el.querySelector('#ev-msg');
      const btn = el.querySelector('#ev-btn');
      const v = (n) => form.elements[n].value.trim();
      const data = { title: v('title'), kind: v('kind'), event_date: v('event_date'), end_date: v('end_date'), team_id: v('team_id'), detail: v('detail') };
      if (!data.title || !data.event_date) return showMessage(msg, '일정 이름과 날짜를 입력해 주세요.');
      if (data.end_date && data.end_date < data.event_date) return showMessage(msg, '끝나는 날은 시작하는 날보다 뒤여야 해요.');
      setBusy(btn, true, '저장 중…');
      try {
        await rpc('save_event', { p_id: editing, p_data: data });
        toast(editing ? '일정을 고쳤어요.' : '일정을 추가했어요.');
        ctx.go(`/schedule?m=${data.event_date.slice(0, 7)}`);
      } catch (err) {
        showMessage(msg, err.message);
        setBusy(btn, false);
      }
    });
  }

  // ------------------------------------------------------------------
  function drawChecks() {
    const editing = Number(params.get('edit')) || null;
    const ck = checks.find((c) => c.id === editing) || {};
    const count = (s) => checks.filter((c) => c.status === s).length;
    const canRecord = (c) => isStaff || !c.team_id || c.team_id === me.team_id;
    const pct = checks.length ? Math.round((count('통과') / checks.length) * 100) : 0;

    render(el, html`
      <section class="card">
        <h1 class="title">통합 테스트</h1>
        <p class="muted">모형을 합쳤을 때 확인할 항목이에요. 맡은 팀이 직접 확인하고 결과를 기록해요. 실패하면 원인을 메모에 남겨 주세요.</p>
        ${tabs}
        <div class="progress" role="img" aria-label="통과 ${pct}%"><span style="width:${pct}%"></span></div>
        <p class="hint">${checks.length ? `${checks.length}개 중 통과 ${count('통과')} · 실패 ${count('실패')} · 대기 ${count('대기')}` : ''}</p>
      </section>

      <section class="card">
        ${checks.length ? html`<ol class="checks-list" id="ck-list">
          ${checks.map((c) => html`
            <li class="check-item s-${c.status}" data-id="${c.id}">
              <div class="title-row">
                <strong>${c.title}</strong>
                <span class="badge ${c.status === '통과' ? 'ok' : c.status === '실패' ? 'danger' : ''}">${c.status}</span>
              </div>
              ${c.detail ? html`<p class="pre small">${c.detail}</p>` : ''}
              <p class="muted small">맡은 팀: ${teamName(c.team_id)}${c.checked_at ? ` · ${personName(people, c.checked_by)} · ${formatDateTime(c.checked_at)}` : ''}</p>
              ${c.note ? html`<p class="small">메모: ${c.note}</p>` : ''}
              ${canRecord(c) ? html`
                <form class="ck-form row-actions">
                  <input name="note" placeholder="측정값이나 메모 (실패하면 꼭)" value="${c.note || ''}" maxlength="1000">
                  ${CHECK_STATUSES.filter((s) => s !== c.status).map((s) => html`<button type="submit" class="${s === '통과' ? 'primary' : 'secondary'} small" value="${s}">${s === '대기' ? '대기로 되돌리기' : s}</button>`)}
                </form>` : ''}
              ${isStaff ? html`<p class="row-actions">
                <a class="link-button small" href="#/schedule?t=test&edit=${c.id}">고치기</a>
                <button type="button" class="link-button danger-text small" data-del-check="${c.id}">지우기</button></p>` : ''}
            </li>`)}
        </ol>` : html`<p class="muted">${isStaff ? '아래에서 확인할 항목을 추가해 주세요.' : '아직 통합 테스트 항목이 없어요.'}</p>`}
      </section>

      ${isStaff ? html`
        <section class="card">
          <details ${editing ? 'open' : ''}>
            <summary>${editing ? '항목 고치기' : '+ 확인할 항목 추가'}</summary>
            <form id="ckn-form" novalidate>
              ${field({ name: 'title', label: '확인할 항목', required: true, placeholder: '예: 발전 설비 → 배터리 충전 전압 5V 유지', value: ck.title })}
              ${field({ name: 'detail', label: '확인 방법', type: 'textarea', rows: 2, placeholder: '예: 멀티미터로 3번 재서 평균', value: ck.detail })}
              <div class="field-row">
                ${selectField({ name: 'team_id', label: '맡은 팀', options: teams.map((t) => ({ value: t.id, label: t.name })), value: ck.team_id, empty: '전체' })}
                ${field({ name: 'sort_order', label: '순서', type: 'number', value: ck.sort_order ?? checks.length + 1, attrs: 'inputmode="numeric"' })}
              </div>
              <p class="message" id="ckn-msg" hidden></p>
              <div class="row-actions">
                <button type="submit" class="primary" id="ckn-btn">${editing ? '고친 내용 저장' : '항목 추가'}</button>
                ${editing ? html`<a class="secondary" href="#/schedule?t=test">취소</a>` : ''}
              </div>
            </form>
          </details>
        </section>` : ''}
    `);

    el.querySelector('#ck-list')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const item = e.target.closest('.check-item');
      const status = e.submitter?.value;
      const note = e.target.elements.note.value.trim();
      if (status === '실패' && !note) return toast('실패했다면 원인이나 상황을 메모에 적어 주세요.');
      try {
        await rpc('set_check_result', { p_id: Number(item.dataset.id), p_status: status, p_note: note });
        toast(`‘${status}’로 기록했어요.`);
        redraw();
      } catch (err) {
        toast(err.message);
      }
    });
    el.querySelector('#ck-list')?.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del-check]');
      if (!del || !window.confirm('이 항목을 지울까요?')) return;
      try {
        await rpc('delete_check', { p_id: Number(del.dataset.delCheck) });
        redraw();
      } catch (err) {
        toast(err.message);
      }
    });

    const form = el.querySelector('#ckn-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = el.querySelector('#ckn-msg');
      const btn = el.querySelector('#ckn-btn');
      const v = (n) => form.elements[n].value.trim();
      if (!v('title')) return showMessage(msg, '확인할 항목을 입력해 주세요.');
      setBusy(btn, true, '저장 중…');
      try {
        await rpc('save_check', { p_id: editing, p_data: { title: v('title'), detail: v('detail'), team_id: v('team_id'), sort_order: v('sort_order') } });
        toast(editing ? '항목을 고쳤어요.' : '항목을 추가했어요.');
        ctx.go('/schedule?t=test');
      } catch (err) {
        showMessage(msg, err.message);
        setBusy(btn, false);
      }
    });
  }
}
