// 기록 카드 그리기 (내 기록, 자료실, 홈에서 같이 씀)
import { html } from '../ui.js';
import { personName, formatDate, shortDate } from '../records.js';

function areaBadges(areas) {
  return (areas || []).map((a) => html`<span class="badge area">${a}</span>`);
}

function para(label, text) {
  if (!text) return '';
  return html`<div class="rec-part"><h4>${label}</h4><p class="pre">${text}</p></div>`;
}

function list(label, items) {
  if (!items || !items.length) return '';
  return html`<div class="rec-part"><h4>${label}</h4><ul>${items.map((i) => html`<li>${i}</li>`)}</ul></div>`;
}

function edited(r) {
  const c = new Date(r.created_at);
  const u = new Date(r.updated_at);
  return u - c > 60000 ? html` · 고친 날 ${shortDate(r.updated_at)}` : '';
}

function ownerActions(kind, r, isMine) {
  if (!isMine) return '';
  return html`
    <div class="rec-actions">
      <a class="secondary" href="#/${kind}/${r.id}">고치기</a>
      <button type="button" class="danger" data-del="${kind}" data-id="${r.id}">지우기</button>
    </div>`;
}

export function researchCard(r, { people, teams, meId, showAuthor = true }) {
  const team = teams.find((t) => t.id === r.team_id);
  const source = [r.source_author, r.source_publisher, r.source_year].filter(Boolean).join(', ');
  return html`
    <article class="rec" data-kind="research">
      <div class="rec-head">
        <span class="badge kind-research">이론 조사</span>
        <span class="badge">${r.source_type}</span>
        ${areaBadges(r.areas)}
        <span class="rec-date">${formatDate(r.created_at)}</span>
      </div>
      <h3 class="rec-title">${r.title}</h3>
      <p class="muted small">
        ${showAuthor ? html`${personName(people, r.author_id)}${team ? html` · ${team.name}` : ''} · ` : ''}
        출처: ${source || '-'}
        ${r.source_url ? html` · <a href="${r.source_url}" target="_blank" rel="noopener noreferrer">링크 열기</a>` : ''}
        ${r.reliability ? html` · 신뢰도 ${'★'.repeat(r.reliability)}` : ''}
      </p>
      <details>
        <summary>내용 보기</summary>
        ${para('핵심 내용 요약', r.summary)}
        ${para('모형에 적용할 점', r.application)}
        ${para('새로 생긴 궁금증', r.new_question)}
        <p class="hint">처음 쓴 날 ${shortDate(r.created_at)}${edited(r)}</p>
      </details>
      ${ownerActions('research', r, r.author_id === meId)}
    </article>`;
}

function thumbs(photos, urls) {
  if (!photos?.length) return '';
  return html`<div class="thumbs small">${photos.map((ph) => (urls?.get(ph.path)
    ? html`<a class="thumb" href="${urls.get(ph.path)}" target="_blank" rel="noopener"><img src="${urls.get(ph.path)}" alt="일지 사진" loading="lazy"></a>`
    : ''))}</div>`;
}

export function logCard(l, { people, teams, meId, participants, photos, urls, showAuthor = true }) {
  const team = teams.find((t) => t.id === l.team_id);
  const with_ = (participants?.get(l.id) || []).map((u) => personName(people, u));
  const firstLine = String(l.did || '').split('\n')[0];
  return html`
    <article class="rec" data-kind="log">
      <div class="rec-head">
        <span class="badge kind-log">활동 일지</span>
        <span class="badge">${l.activity_type}</span>
        ${areaBadges(l.areas)}
        <span class="rec-date">${formatDate(l.log_date)} · ${l.minutes}분</span>
      </div>
      <h3 class="rec-title">${firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine}</h3>
      <p class="muted small">
        ${showAuthor ? html`${personName(people, l.author_id)}${team ? html` · ${team.name}` : ''}` : ''}
        ${with_.length ? html`${showAuthor ? ' · ' : ''}같이 한 사람: ${with_.join(', ')}` : ''}
      </p>
      ${thumbs(photos?.get(l.id), urls)}
      <details>
        <summary>내용 보기</summary>
        ${para('한 일', l.did)}
        ${para('문제와 해결', l.problem)}
        ${para('실험 결과·측정값', l.results)}
        ${list('다음 할 일', l.next_steps)}
        <p class="hint">처음 쓴 날 ${shortDate(l.created_at)}${edited(l)}</p>
      </details>
      ${ownerActions('log', l, l.author_id === meId)}
    </article>`;
}

export function planCard(plan) {
  return html`
    <div class="plan">
      ${para('동기', plan.motivation)}
      ${para('맡을 기능·역할', plan.role_focus)}
      ${para('탐구 질문', plan.question)}
      ${list('목표', plan.goals)}
      ${list('조사할 이론', plan.theories)}
      ${para('연계 교과·진로', plan.subjects)}
      ${plan.weekly?.length ? html`
        <div class="rec-part"><h4>주차별 계획</h4>
          <table class="wk"><tbody>
            ${plan.weekly.map((w) => html`<tr><th>${w.week || '-'}</th><td>${w.plan}</td></tr>`)}
          </tbody></table>
        </div>` : ''}
    </div>`;
}
