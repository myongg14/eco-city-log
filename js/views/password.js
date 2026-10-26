import { sb, rpc, friendlyError } from '../api.js';
import { html, render, showMessage, setBusy, toast } from '../ui.js';
import { INITIAL_PASSWORD } from '../config.js';

// forced: 첫 로그인처럼 바꾸기 전에는 다른 화면으로 못 가는 경우
export function passwordView(el, ctx, { forced = false } = {}) {
  render(el, html`
    <section class="card narrow">
      <h1 class="title">${forced ? '새 비밀번호 만들기' : '비밀번호 바꾸기'}</h1>
      ${forced
        ? html`<p class="muted">처음 비밀번호(${INITIAL_PASSWORD})는 모두가 알고 있어서, 새 비밀번호로 바꿔야 사이트를 쓸 수 있어요.</p>`
        : ''}
      ${passwordFormMarkup()}
      ${forced ? html`<button type="button" class="link-button" id="pw-logout">다른 아이디로 로그인</button>` : ''}
    </section>
  `);

  bindPasswordForm(el, async () => {
    await ctx.refreshMe();
    toast('비밀번호를 바꿨어요.');
    ctx.go(forced ? '/profile' : '/me');
  });

  el.querySelector('#pw-logout')?.addEventListener('click', ctx.logout);
}

export function passwordFormMarkup() {
  return html`
    <form id="pw-form" novalidate>
      <label for="pw-new">새 비밀번호</label>
      <input id="pw-new" name="pw" type="password" autocomplete="new-password" minlength="8" required>
      <label for="pw-confirm">새 비밀번호 한 번 더</label>
      <input id="pw-confirm" name="pw2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="hint">8자 이상, ${INITIAL_PASSWORD}은 쓸 수 없어요. 다른 사이트와 같은 비밀번호는 피하세요.</p>
      <p class="message" id="pw-msg" hidden></p>
      <button type="submit" class="primary" id="pw-btn">비밀번호 저장</button>
    </form>
  `;
}

export function bindPasswordForm(root, onDone) {
  const form = root.querySelector('#pw-form');
  const msg = root.querySelector('#pw-msg');
  const btn = root.querySelector('#pw-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = form.pw.value;
    const pw2 = form.pw2.value;
    showMessage(msg, '');
    if (pw.length < 8) return showMessage(msg, '비밀번호는 8자 이상이어야 해요.');
    if (pw === INITIAL_PASSWORD) return showMessage(msg, `처음 비밀번호(${INITIAL_PASSWORD})는 다시 쓸 수 없어요.`);
    if (pw !== pw2) return showMessage(msg, '두 비밀번호가 서로 달라요.');

    setBusy(btn, true, '저장 중…');
    try {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw new Error(friendlyError(error));
      await rpc('mark_password_changed');
      form.reset();
      await onDone();
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}
