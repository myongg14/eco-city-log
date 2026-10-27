import { rpc } from '../api.js';
import { html, render, formatDateTime } from '../ui.js';
import { fetchAlerts } from '../records.js';

// 사이트 안 알림: 피드백, 배정된 할 일, 마감 임박, 물품 결과, 다가오는 일정, 통합 테스트 실패
export async function alertsView(el, ctx) {
  const me = ctx.state.me;
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let alerts;
  try {
    alerts = await fetchAlerts(me);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const urgent = alerts.list.filter((a) => a.urgent);
  const rest = alerts.list.filter((a) => !a.urgent);
  const item = (a) => html`
    <li class="${a.isNew ? 'is-new' : ''}">
      <a href="${a.href}">
        <span class="alert-icon" aria-hidden="true">${a.icon}</span>
        <span class="recent-text"><strong>${a.kind}</strong>${a.isNew ? html` <span class="badge warn">새로</span>` : ''}<br>${a.text.length > 80 ? `${a.text.slice(0, 80)}…` : a.text}</span>
        ${a.when ? html`<span class="muted small">${formatDateTime(a.when)}</span>` : ''}
      </a>
    </li>`;

  render(el, html`
    <section class="card">
      <h1 class="title">알림</h1>
      <p class="muted">${alerts.newCount ? `새 알림 ${alerts.newCount}개가 있어요.` : '새 알림이 없어요.'} 이 화면을 열면 새 알림 숫자가 사라져요.</p>
    </section>
    ${urgent.length ? html`
      <section class="card urgent-card">
        <h2 class="subtitle">지금 확인할 것</h2>
        <ul class="alert-list">${urgent.map(item)}</ul>
      </section>` : ''}
    <section class="card">
      <h2 class="subtitle">모든 알림</h2>
      ${rest.length ? html`<ul class="alert-list">${rest.slice(0, 50).map(item)}</ul>` : html`<p class="muted">알림이 없어요.</p>`}
    </section>
  `);
  ctx.clearAlertBadge();
  rpc('mark_notifications_seen').catch(() => {});
}
