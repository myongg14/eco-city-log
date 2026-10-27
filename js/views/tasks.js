import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { fetchTasks, fetchPeople, personName, TASK_STATUSES, formatDate, todayKst } from '../records.js';
import { field, selectField } from '../form.js';

export function dueLabel(due, status) {
  if (!due) return '';
  const days = Math.round((new Date(`${due}T00:00:00+09:00`) - new Date(`${todayKst()}T00:00:00+09:00`)) / 86400000);
  if (status === '완료') return html`<span class="muted small">마감 ${formatDate(due)}</span>`;
  const cls = days < 0 ? 'danger' : days <= 3 ? 'warn' : '';
  const text = days < 0 ? `${-days}일 지남` : days === 0 ? '오늘 마감' : `D-${days}`;
  return html`<span class="badge ${cls}">${text}</span> <span class="muted small">${formatDate(due)}</span>`;
}

export function taskCard(t, { people, teams, me, compact = false }) {
  const team = teams.find((x) => x.id === t.team_id);
  const canMove = me.role !== 'student' || t.assignee_id === me.user_id;
  const i = TASK_STATUSES.indexOf(t.status);
  return html`
    <article class="task ${t.assignee_id === me.user_id ? 'mine' : ''}" data-id="${t.id}">
      <h3 class="task-title">${t.title}</h3>
      ${t.detail && !compact ? html`<p class="pre small">${t.detail}</p>` : ''}
      <p class="muted small">${team ? team.name : '전체'} · ${t.assignee_id ? personName(people, t.assignee_id) : '담당자 없음'}</p>
      <p>${dueLabel(t.due_date, t.status)}</p>
      ${canMove && !compact ? html`
        <div class="row-actions">
          ${i > 0 ? html`<button type="button" class="secondary" data-move="${TASK_STATUSES[i - 1]}">← ${TASK_STATUSES[i - 1]}</button>` : ''}
          ${i < 2 ? html`<button type="button" class="secondary" data-move="${TASK_STATUSES[i + 1]}">${TASK_STATUSES[i + 1]} →</button>` : ''}
          ${me.role !== 'student' ? html`
            <button type="button" class="link-button" data-edit>고치기</button>
            <button type="button" class="link-button danger-text" data-del>지우기</button>` : ''}
        </div>` : ''}
    </article>`;
}

export async function tasksView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  const isStaff = me.role !== 'student';
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let tasks;
  let people;
  try {
    [tasks, people] = await Promise.all([fetchTasks(), fetchPeople()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const filter = params.get('f') || (isStaff ? 'all' : 'mine');
  let editing = null;
  const students = [...people.values()].filter((p) => p.role === 'student');

  function shown() {
    if (filter === 'mine') return tasks.filter((t) => t.assignee_id === me.user_id);
    if (filter === 'team') return tasks.filter((t) => t.team_id === me.team_id || t.team_id === null);
    if (filter.startsWith('t')) return tasks.filter((t) => String(t.team_id) === filter.slice(1));
    return tasks;
  }

  function formMarkup() {
    const t = tasks.find((x) => x.id === editing) || {};
    return html`
      <details class="field" id="task-new" ${editing ? 'open' : ''}>
        <summary>${editing ? '할 일 고치기' : '+ 할 일 만들기'}</summary>
        <form id="task-form" novalidate>
          ${field({ name: 'title', label: '할 일', required: true, placeholder: '예: 배터리 팀과 전압 맞추기 (5V)', value: t.title })}
          ${field({ name: 'detail', label: '자세한 내용', type: 'textarea', rows: 2, value: t.detail })}
          <div class="field-row">
            ${selectField({ name: 'team_id', label: '팀', options: teams.map((x) => ({ value: x.id, label: x.name })), value: t.team_id, empty: '전체 (담당자 팀으로 자동)' })}
            ${selectField({ name: 'assignee_id', label: '담당자', value: t.assignee_id, empty: '담당자 없음',
              options: students.map((p) => ({ value: p.user_id, label: `${p.display_name || '(이름 없음)'} · ${p.login_id}` })) })}
            ${field({ name: 'due_date', label: '마감일', type: 'date', value: t.due_date })}
          </div>
          ${selectField({ name: 'status', label: '상태', options: TASK_STATUSES, value: t.status || '예정', empty: '예정' })}
          <p class="message" id="task-msg" hidden></p>
          <div class="row-actions">
            <button type="submit" class="primary" id="task-btn">${editing ? '고친 내용 저장' : '할 일 추가'}</button>
            ${editing ? html`<button type="button" class="secondary" id="task-cancel">취소</button>` : ''}
          </div>
        </form>
      </details>`;
  }

  function draw() {
    const list = shown();
    const done = list.filter((t) => t.status === '완료').length;
    const link = (f) => `#/tasks?f=${f}`;
    render(el, html`
      <section class="card">
        <h1 class="title">할 일 보드</h1>
        <p class="muted">${isStaff ? '할 일을 만들고 담당자를 정해요. 담당 학생은 상태만 바꿀 수 있어요.' : '나에게 맡겨진 할 일은 버튼으로 진행 상태를 바꿔요.'}</p>
        <div class="tabs scroll">
          ${isStaff ? '' : html`<a href="${link('mine')}" class="${filter === 'mine' ? 'active' : ''}">내 할 일</a>`}
          ${isStaff ? '' : html`<a href="${link('team')}" class="${filter === 'team' ? 'active' : ''}">우리 팀</a>`}
          <a href="${link('all')}" class="${filter === 'all' ? 'active' : ''}">전체</a>
          ${isStaff ? teams.map((t) => html`<a href="${link(`t${t.id}`)}" class="${filter === `t${t.id}` ? 'active' : ''}">team${t.id}</a>`) : ''}
        </div>
        <p class="hint">${list.length ? `${list.length}개 중 ${done}개 완료 (${Math.round((done / list.length) * 100)}%)` : ''}</p>
        ${isStaff ? formMarkup() : ''}
      </section>
      <div class="board">
        ${TASK_STATUSES.map((s) => {
          const col = list.filter((t) => t.status === s);
          return html`
            <section class="card board-col" data-status="${s}">
              <h2 class="subtitle">${s} <span class="muted small">${col.length}</span></h2>
              ${col.length ? col.map((t) => taskCard(t, { people, teams, me })) : html`<p class="muted small">없음</p>`}
            </section>`;
        })}
      </div>
    `);
    bind();
  }

  function bind() {
    el.querySelector('.board').addEventListener('click', async (e) => {
      const card = e.target.closest('.task');
      if (!card) return;
      const id = Number(card.dataset.id);
      const move = e.target.closest('[data-move]');
      if (move) {
        move.disabled = true;
        try {
          await rpc('set_task_status', { p_id: id, p_status: move.dataset.move });
          tasks.find((t) => t.id === id).status = move.dataset.move;
          draw();
        } catch (err) {
          toast(err.message);
          move.disabled = false;
        }
      }
      if (e.target.closest('[data-edit]')) {
        editing = id;
        draw();
        el.querySelector('#task-new').scrollIntoView({ behavior: 'smooth' });
      }
      if (e.target.closest('[data-del]') && window.confirm('이 할 일을 지울까요?')) {
        try {
          await rpc('delete_task', { p_id: id });
          tasks = tasks.filter((t) => t.id !== id);
          toast('지웠어요.');
          draw();
        } catch (err) {
          toast(err.message);
        }
      }
    });

    const form = el.querySelector('#task-form');
    if (!form) return;
    el.querySelector('#task-cancel')?.addEventListener('click', () => { editing = null; draw(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = el.querySelector('#task-msg');
      const btn = el.querySelector('#task-btn');
      showMessage(msg, '');
      const v = (n) => form.elements[n].value;
      if (!v('title').trim()) return showMessage(msg, '할 일을 입력해 주세요.');
      setBusy(btn, true, '저장 중…');
      try {
        await rpc('save_task', {
          p_id: editing,
          p_data: { title: v('title'), detail: v('detail'), team_id: v('team_id'), assignee_id: v('assignee_id'), due_date: v('due_date'), status: v('status') || '예정' },
        });
        toast(editing ? '할 일을 고쳤어요.' : '할 일을 추가했어요.');
        editing = null;
        tasks = await fetchTasks();
        draw();
        el.querySelector('#task-new').open = true;
      } catch (err) {
        showMessage(msg, err.message);
        setBusy(btn, false);
      }
    });
  }

  draw();
}
