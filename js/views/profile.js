import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';

export function profileView(el, ctx) {
  const me = ctx.state.me;
  const isStudent = me.role === 'student';

  render(el, html`
    <section class="card narrow">
      <h1 class="title">내 정보 입력</h1>
      <p class="muted">아이디 <strong>${me.login_id}</strong>${ctx.state.team ? html` · ${ctx.state.team.name} 팀` : ''}의 주인이 누구인지 알려 주세요.
        나중에 내 정보에서 바꿀 수 있어요.</p>
      <form id="profile-form" novalidate>
        <label for="pf-name">이름 <span class="req">*</span></label>
        <input id="pf-name" name="name" autocomplete="name" value="${me.display_name || ''}" required>
        ${isStudent ? html`
          <label for="pf-role">맡은 역할</label>
          <input id="pf-role" name="roleDesc" placeholder="예: 태양광 패널 배치 설계, 배선" value="${me.role_desc || ''}">
          <label for="pf-career">희망 진로</label>
          <input id="pf-career" name="career" placeholder="예: 전기공학자, 환경공학 연구원" value="${me.career_goal || ''}">
          <p class="hint">희망 진로는 나중에 생기부 진로 영역을 정리할 때 쓰여요.</p>
        ` : ''}
        <p class="message" id="pf-msg" hidden></p>
        <button type="submit" class="primary" id="pf-btn">저장하고 시작하기</button>
      </form>
    </section>
  `);

  const form = el.querySelector('#profile-form');
  const msg = el.querySelector('#pf-msg');
  const btn = el.querySelector('#pf-btn');

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
      toast('저장했어요. 환영해요!');
      ctx.go('/home');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  form.name.focus();
}
