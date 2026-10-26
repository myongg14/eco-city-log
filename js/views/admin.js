import { rpc, fetchTeams } from '../api.js';
import { html, render, showMessage, setBusy, toast, formatDateTime } from '../ui.js';
import { INITIAL_PASSWORD } from '../config.js';

const ROLE_LABEL = { admin: '관리자', teacher: '선생님', student: '학생' };

export async function adminView(el, ctx) {
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let accounts;
  let teams;
  try {
    [accounts, teams] = await Promise.all([rpc('admin_list_accounts'), fetchTeams()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  const myRole = ctx.state.me.role;
  let query = '';

  render(el, html`
    <section class="card">
      <h1 class="title">계정 관리</h1>
      <p class="muted">비밀번호를 초기화하면 ${INITIAL_PASSWORD}로 돌아가고, 다음 로그인 때 새 비밀번호를 만들어야 해요.</p>
      <input id="acc-search" type="search" placeholder="아이디, 이름, 팀으로 찾기">
      <p class="message" id="acc-msg" hidden></p>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>아이디</th><th>이름</th><th>팀</th><th>상태</th><th>마지막 로그인</th><th></th></tr>
          </thead>
          <tbody id="acc-body"></tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2 class="subtitle">학생 계정 추가</h2>
      <form id="new-form" class="inline-form" novalidate>
        <div>
          <label for="new-id">아이디</label>
          <input id="new-id" name="loginId" placeholder="team8-1" autocapitalize="off" spellcheck="false" required>
        </div>
        <div>
          <label for="new-team">팀</label>
          <select id="new-team" name="teamId">
            ${teams.map((t) => html`<option value="${t.id}">${t.name}${t.is_active ? '' : ' (꺼짐)'}</option>`)}
          </select>
        </div>
        <button type="submit" class="primary" id="new-btn">추가</button>
      </form>
      <p class="hint">처음 비밀번호는 ${INITIAL_PASSWORD}이에요.</p>
      <p class="message" id="new-msg" hidden></p>
    </section>

    <section class="card">
      <h2 class="subtitle">팀 관리</h2>
      <p class="muted">예비 팀(team8, team9)은 켜야 그 팀 아이디로 로그인할 수 있어요.</p>
      <div id="team-list" class="team-list">
        ${teams.map((t) => html`
          <form class="team-row" data-team="${t.id}" novalidate>
            <span class="team-code">team${t.id}</span>
            <input name="name" value="${t.name}" aria-label="팀 이름">
            <input name="topic" value="${t.topic || ''}" placeholder="주제" aria-label="팀 주제">
            <label class="switch"><input type="checkbox" name="active" ${t.is_active ? 'checked' : ''}> 켜짐</label>
            <button type="submit" class="secondary">저장</button>
          </form>
        `)}
      </div>
      <p class="message" id="team-msg" hidden></p>
    </section>
  `);

  const body = el.querySelector('#acc-body');
  const accMsg = el.querySelector('#acc-msg');

  function statusBadges(a) {
    const out = [];
    if (a.locked) out.push(html`<span class="badge danger">잠김</span>`);
    if (!a.team_active) out.push(html`<span class="badge">팀 꺼짐</span>`);
    if (a.must_change_password) out.push(html`<span class="badge">첫 로그인 전</span>`);
    else if (!a.profile_completed) out.push(html`<span class="badge">정보 입력 전</span>`);
    if (!out.length) out.push(html`<span class="badge ok">사용 중</span>`);
    return out;
  }

  function drawRows() {
    const q = query.trim().toLowerCase();
    const rows = accounts.filter((a) => !q
      || a.login_id.includes(q)
      || (a.display_name || '').toLowerCase().includes(q)
      || (a.team_name || ROLE_LABEL[a.role]).toLowerCase().includes(q));
    render(body, rows.length ? html`${rows.map((a) => {
      const canReset = a.role !== 'teacher' || myRole === 'teacher';
      return html`
        <tr>
          <td class="cell-id"><strong>${a.login_id}</strong></td>
          <td data-label="이름">${a.display_name || '-'}</td>
          <td data-label="팀">${a.team_name || ROLE_LABEL[a.role]}</td>
          <td data-label="상태">${statusBadges(a)}</td>
          <td class="nowrap" data-label="마지막 로그인">${a.last_login_at ? formatDateTime(a.last_login_at) : '-'}</td>
          <td class="actions">
            ${a.locked ? html`<button type="button" class="secondary" data-act="unlock" data-id="${a.login_id}">잠금 해제</button>` : ''}
            ${canReset ? html`<button type="button" class="secondary" data-act="reset" data-id="${a.login_id}">비번 초기화</button>` : ''}
            ${a.role === 'student' ? html`<button type="button" class="danger" data-act="delete" data-id="${a.login_id}">삭제</button>` : ''}
          </td>
        </tr>`;
    })}` : html`<tr><td colspan="6" class="muted">찾는 계정이 없어요.</td></tr>`);
  }

  async function reload() {
    accounts = await rpc('admin_list_accounts');
    drawRows();
  }

  drawRows();

  el.querySelector('#acc-search').addEventListener('input', (e) => {
    query = e.target.value;
    drawRows();
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const question = {
      reset: `${id} 비밀번호를 ${INITIAL_PASSWORD}로 초기화할까요?`,
      delete: `${id} 계정을 지울까요? 이 계정이 남긴 기록도 함께 지워지고 되돌릴 수 없어요.`,
    }[act];
    if (question && !window.confirm(question)) return;

    showMessage(accMsg, '');
    setBusy(btn, true, '…');
    try {
      if (act === 'unlock') await rpc('admin_unlock', { p_login_id: id });
      if (act === 'reset') await rpc('admin_reset_password', { p_login_id: id });
      if (act === 'delete') await rpc('admin_delete_account', { p_login_id: id });
      toast({ unlock: '잠금을 풀었어요.', reset: '비밀번호를 초기화했어요.', delete: '계정을 지웠어요.' }[act]);
      await reload();
    } catch (err) {
      showMessage(accMsg, err.message);
      setBusy(btn, false);
    }
  });

  const newForm = el.querySelector('#new-form');
  const newMsg = el.querySelector('#new-msg');
  const newBtn = el.querySelector('#new-btn');
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(newMsg, '');
    const loginId = newForm.loginId.value.trim().toLowerCase();
    if (!loginId) return showMessage(newMsg, '아이디를 입력해 주세요.');
    setBusy(newBtn, true, '추가 중…');
    try {
      await rpc('admin_create_account', { p_login_id: loginId, p_team_id: Number(newForm.teamId.value) });
      newForm.loginId.value = '';
      showMessage(newMsg, `${loginId} 계정을 만들었어요.`, 'success');
      await reload();
    } catch (err) {
      showMessage(newMsg, err.message);
    } finally {
      setBusy(newBtn, false);
    }
  });

  const teamMsg = el.querySelector('#team-msg');
  el.querySelectorAll('.team-row').forEach((row) => {
    row.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = row.querySelector('button');
      showMessage(teamMsg, '');
      setBusy(btn, true, '저장 중…');
      try {
        await rpc('admin_update_team', {
          p_team_id: Number(row.dataset.team),
          p_name: row.name.value,
          p_topic: row.topic.value,
          p_active: row.active.checked,
        });
        toast('팀 정보를 저장했어요.');
        await reload();
      } catch (err) {
        showMessage(teamMsg, err.message);
      } finally {
        setBusy(btn, false);
      }
    });
  });
}
