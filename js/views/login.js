import { sb, rpc, loginEmail, normalizeLoginId, friendlyError } from '../api.js';
import { html, render, showMessage, setBusy } from '../ui.js';
import { INITIAL_PASSWORD } from '../config.js';

export function loginView(el, ctx) {
  render(el, html`
    <section class="card narrow">
      <h1 class="title">로그인</h1>
      <p class="muted">아이디는 팀 번호와 내 번호예요. 예: <strong>team1-1</strong></p>
      <form id="login-form" novalidate>
        <label for="login-id">아이디</label>
        <input id="login-id" name="loginId" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="team1-1" required>
        <label for="login-pw">비밀번호</label>
        <input id="login-pw" name="password" type="password" autocomplete="current-password" required>
        <p class="message" id="login-msg" hidden></p>
        <button type="submit" class="primary" id="login-btn">로그인</button>
      </form>
      <p class="hint">처음 로그인할 때 비밀번호는 <strong>${INITIAL_PASSWORD}</strong> 이고, 로그인하면 바로 새 비밀번호로 바꿔야 해요.
        비밀번호를 잊었으면 관리자에게 초기화를 부탁하세요.</p>
      <p class="hint"><a class="link" href="#/showcase">로그인 없이 프로젝트 소개 보기</a></p>
    </section>
  `);

  const form = el.querySelector('#login-form');
  const msg = el.querySelector('#login-msg');
  const btn = el.querySelector('#login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const loginId = normalizeLoginId(form.loginId.value);
    const password = form.password.value;
    showMessage(msg, '');
    if (!loginId || !password) {
      showMessage(msg, '아이디와 비밀번호를 모두 입력해 주세요.');
      return;
    }

    setBusy(btn, true, '로그인 중…');
    try {
      const check = await rpc('login_precheck', { p_login_id: loginId });
      if (check === 'locked') {
        showMessage(msg, '비밀번호를 5번 틀려서 10분 동안 잠겼어요. 10분 뒤에 다시 하거나 관리자에게 잠금 해제를 부탁하세요.');
        return;
      }
      if (check === 'inactive') {
        showMessage(msg, '아직 열리지 않은 예비 팀 계정이에요. 관리자에게 문의하세요.');
        return;
      }

      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(loginId), password });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) {
          const left = await rpc('record_login_failure', { p_login_id: loginId });
          showMessage(msg, left > 0
            ? `아이디나 비밀번호가 맞지 않아요. (남은 기회 ${left}번)`
            : '비밀번호를 5번 틀려서 10분 동안 잠겼어요. 관리자에게 잠금 해제를 부탁할 수 있어요.');
        } else {
          showMessage(msg, friendlyError(error));
        }
        return;
      }

      const status = await rpc('record_login_success');
      if (!status.team_active) {
        await sb.auth.signOut();
        showMessage(msg, '아직 열리지 않은 예비 팀 계정이에요. 관리자에게 문의하세요.');
        return;
      }
      ctx.state.previousLoginAt = status.previous_login_at;
      await ctx.refreshMe();
      ctx.go('/home');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  form.loginId.focus();
}
