import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast, formatDateTime } from '../ui.js';
import { fetchFeatures, fetchPeople, personName, FEATURE_STAGES, stagePercent } from '../records.js';
import { field, selectField } from '../form.js';

// 기능 하나의 단계 표시 (설계 → 부품 확보 → 제작 → 작동 확인)
export function stageSteps(stage) {
  const at = FEATURE_STAGES.indexOf(stage);
  return html`<ol class="stage-steps" aria-label="현재 단계: ${stage}">
    ${FEATURE_STAGES.map((s, i) => html`<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${s}</li>`)}
  </ol>`;
}

export function teamPercent(features) {
  if (!features.length) return null;
  return Math.round(features.reduce((sum, f) => sum + stagePercent(f.stage), 0) / features.length);
}

export function featureCard(f, { people, canEdit }) {
  const i = FEATURE_STAGES.indexOf(f.stage);
  return html`
    <article class="feature" data-id="${f.id}">
      <div class="title-row"><strong>${f.name}</strong><span class="badge ${f.stage === '작동 확인' ? 'ok' : ''}">${f.stage}</span></div>
      ${stageSteps(f.stage)}
      ${f.note ? html`<p class="small pre">${f.note}</p>` : ''}
      <p class="muted small">${f.updated_by ? `${personName(people, f.updated_by)} · ` : ''}${formatDateTime(f.updated_at)}</p>
      ${canEdit ? html`
        <div class="row-actions">
          ${i > 0 ? html`<button type="button" class="secondary small" data-stage="${FEATURE_STAGES[i - 1]}">← ${FEATURE_STAGES[i - 1]}</button>` : ''}
          ${i < 3 ? html`<button type="button" class="primary small" data-stage="${FEATURE_STAGES[i + 1]}">${FEATURE_STAGES[i + 1]} →</button>` : ''}
          <a class="link-button small" href="#/progress?edit=${f.id}">고치기</a>
          <button type="button" class="link-button danger-text small" data-del-feature>지우기</button>
        </div>` : ''}
    </article>`;
}

// 기능 카드 목록의 버튼(단계 옮기기, 지우기)을 연결해요.
export function bindFeatureButtons(root, features, onChange) {
  root.addEventListener('click', async (e) => {
    const card = e.target.closest('.feature');
    if (!card) return;
    const f = features.find((x) => x.id === Number(card.dataset.id));
    const move = e.target.closest('[data-stage]');
    const del = e.target.closest('[data-del-feature]');
    if (!move && !del) return;
    try {
      if (move) {
        await rpc('save_feature', { p_id: f.id, p_data: { name: f.name, note: f.note, sort_order: f.sort_order, stage: move.dataset.stage } });
        toast(`‘${move.dataset.stage}’ 단계로 옮겼어요.`);
      } else {
        if (!window.confirm('이 기능을 지울까요?')) return;
        await rpc('delete_feature', { p_id: f.id });
      }
      onChange();
    } catch (err) {
      toast(err.message);
    }
  });
}

// 전체 도시 진행 현황 + 기능 구현 현황표
export async function progressView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = (ctx.state.teams || []).filter((t) => t.is_active);
  const isStaff = me.role !== 'student';
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let features, people;
  try {
    [features, people] = await Promise.all([fetchFeatures(), fetchPeople()]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const canEdit = (teamId) => isStaff || teamId === me.team_id;
  const editing = Number(params.get('edit')) || null;
  const ef = features.find((f) => f.id === editing && canEdit(f.team_id)) || {};
  const all = teamPercent(features);
  const teamChoices = isStaff ? teams : teams.filter((t) => t.id === me.team_id);

  render(el, html`
    <section class="card">
      <a href="#/teams" class="link small">← 팀</a>
      <h1 class="title">기능 구현 현황</h1>
      <p class="muted">팀마다 친환경 기능을 설계 → 부품 확보 → 제작 → 작동 확인 단계로 표시해요. 우리 팀 기능은 팀원 누구나 단계를 옮길 수 있어요.</p>
      <div class="progress" role="img" aria-label="도시 전체 ${all ?? 0}%"><span style="width:${all ?? 0}%"></span></div>
      <p class="hint">도시 전체 ${all === null ? '아직 기능이 없어요' : `${all}%`} · 기능 ${features.length}개 · 작동 확인 ${features.filter((f) => f.stage === '작동 확인').length}개</p>
    </section>

    <section class="card">
      <h2 class="subtitle">도시 진행 현황판</h2>
      <div class="city-board">
        ${teams.map((t) => {
          const pct = teamPercent(features.filter((f) => f.team_id === t.id));
          const level = pct === null ? 'none' : pct >= 100 ? 'l4' : pct >= 75 ? 'l3' : pct >= 50 ? 'l2' : 'l1';
          return html`<a class="city-cell ${level}" href="#/team/${t.id}">
            <strong>${t.name}</strong><span>${pct === null ? '기능 없음' : `${pct}%`}</span></a>`;
        })}
      </div>
      <p class="hint">
        <span class="city-key l1">~49%</span> <span class="city-key l2">50~74%</span> <span class="city-key l3">75~99%</span> <span class="city-key l4">완성</span>
      </p>
    </section>

    ${teamChoices.length ? html`
      <section class="card">
        <details ${editing ? 'open' : ''} id="ft-new">
          <summary>${editing ? '기능 고치기' : '+ 기능 추가'}</summary>
          <form id="ft-form" novalidate>
            ${field({ name: 'name', label: '기능 이름', required: true, placeholder: '예: 태양광 가로등 자동 점등', value: ef.name })}
            <div class="field-row">
              ${editing ? '' : selectField({ name: 'team_id', label: '팀', required: true, options: teamChoices.map((t) => ({ value: t.id, label: t.name })), value: me.team_id })}
              ${selectField({ name: 'stage', label: '단계', options: FEATURE_STAGES, value: ef.stage || '설계', empty: '설계' })}
              ${field({ name: 'sort_order', label: '순서', type: 'number', value: ef.sort_order ?? 0, attrs: 'inputmode="numeric"' })}
            </div>
            ${field({ name: 'note', label: '메모', placeholder: '예: 조도 센서 부품 도착 대기', value: ef.note })}
            <p class="message" id="ft-msg" hidden></p>
            <div class="row-actions">
              <button type="submit" class="primary" id="ft-btn">${editing ? '고친 내용 저장' : '기능 추가'}</button>
              ${editing ? html`<a class="secondary" href="#/progress">취소</a>` : ''}
            </div>
          </form>
        </details>
      </section>` : ''}

    <div id="ft-teams">
      ${teams.map((t) => {
        const list = features.filter((f) => f.team_id === t.id);
        return html`
          <section class="card">
            <div class="title-row"><h2 class="subtitle">${t.name}</h2><span class="muted small">${list.length ? `${teamPercent(list)}%` : ''}</span></div>
            ${list.length ? html`<div class="feature-list">${list.map((f) => featureCard(f, { people, canEdit: canEdit(t.id) }))}</div>`
              : html`<p class="muted small">아직 등록한 기능이 없어요.</p>`}
          </section>`;
      })}
    </div>
  `);

  bindFeatureButtons(el.querySelector('#ft-teams'), features, () => progressView(el, ctx, new URLSearchParams()));

  const form = el.querySelector('#ft-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el.querySelector('#ft-msg');
    const btn = el.querySelector('#ft-btn');
    const v = (n) => form.elements[n]?.value.trim() ?? '';
    const data = { name: v('name'), team_id: v('team_id'), stage: v('stage'), sort_order: v('sort_order'), note: v('note') };
    if (!data.name || (!editing && !data.team_id)) return showMessage(msg, '* 표시가 있는 칸을 모두 채워 주세요.');
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('save_feature', { p_id: editing, p_data: data });
      toast(editing ? '기능을 고쳤어요.' : '기능을 추가했어요.');
      ctx.go('/progress');
    } catch (err) {
      showMessage(msg, err.message);
      setBusy(btn, false);
    }
  });
}
