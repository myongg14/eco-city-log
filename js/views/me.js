import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast, formatDateTime } from '../ui.js';
import { passwordFormMarkup, bindPasswordForm } from './password.js';

export function meView(el, ctx) {
  const { me, team } = ctx.state;
  const isStudent = me.role === 'student';

  render(el, html`
    <section class="card narrow">
      <h1 class="title">내 정보</h1>
      <dl class="info">
        <dt>아이디</dt><dd>${me.login_id}</dd>
        <dt>팀</dt><dd>${team ? team.name : me.role === 'admin' ? '관리자' : '선생님'}</dd>
        <dt>마지막 로그인</dt><dd>${formatDateTime(me.last_login_at)}</dd>
      </dl>
      <form id="me-form" novalidate>
        <label for="me-name">이름 <span class="req">*</span></label>
        <input id="me-name" name="name" value="${me.display_name || ''}" required>
        ${isStudent ? html`
          <label for="me-role">맡은 역할</label>
          <input id="me-role" name="roleDesc" value="${me.role_desc || ''}">
          <label for="me-career">희망 진로</label>
          <input id="me-career" name="career" value="${me.career_goal || ''}">
        ` : ''}
        <p class="message" id="me-msg" hidden></p>
        <button type="submit" class="primary" id="me-btn">정보 저장</button>
      </form>
    </section>

    <section class="card narrow">
      <h2 class="subtitle">${isStudent ? '내 기록 내려받기' : '전체 백업'}</h2>
      <p class="muted">${isStudent ? '활동 일지, 이론 조사, 성찰을 엑셀 파일이나 PDF로 받아요.' : '모든 학생의 기록을 엑셀(CSV)과 백업 파일로 받아요.'}</p>
      <a class="secondary button-link" href="#/backup">${isStudent ? '내려받기 화면으로' : '백업 화면으로'}</a>
    </section>

    <section class="card narrow">
      <h2 class="subtitle">비밀번호 바꾸기</h2>
      ${passwordFormMarkup()}
    </section>
  `);

  const form = el.querySelector('#me-form');
  const msg = el.querySelector('#me-msg');
  const btn = el.querySelector('#me-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(msg, '');
    const name = form.name.value.trim();
    if (!name) return showMessage(msg, '이름을 입력해 주세요.');
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('complete_my_profile', {
        p_display_name: name,
        p_role_desc: form.roleDesc?.value ?? '',
        p_career_goal: form.career?.value ?? '',
      });
      await ctx.refreshMe();
      showMessage(msg, '저장했어요.', 'success');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  bindPasswordForm(el, async () => {
    await ctx.refreshMe();
    toast('비밀번호를 바꿨어요.');
  });
}
