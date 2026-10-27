import { html, render } from '../ui.js';
import { fetchFeatures, fetchMeasurements, fetchPhotos, fetchLogs, fetchResearch, fetchLinks, fetchPeople, personName,
  formatDate, todayKst } from '../records.js';
import { signedUrls } from '../photos.js';
import { lineChart, bindCharts } from '../chart.js';
import { linkMap, linkList, bindLinkMap } from '../linkmap.js';
import { stageSteps, teamPercent } from './progress.js';

const SECTIONS = [
  { key: 'overview', label: '프로젝트 개요' },
  { key: 'progress', label: '기능 구현 현황' },
  { key: 'links', label: '팀 간 연결 지도' },
  { key: 'measure', label: '측정 결과' },
  { key: 'photos', label: '제작 과정 사진' },
];

export function cityBoard(teams, features) {
  return html`<div class="city-board">
    ${teams.map((t) => {
      const pct = teamPercent(features.filter((f) => f.team_id === t.id));
      const level = pct === null ? 'none' : pct >= 100 ? 'l4' : pct >= 75 ? 'l3' : pct >= 50 ? 'l2' : 'l1';
      return html`<div class="city-cell ${level}"><strong>${t.name}</strong><span>${pct === null ? '기능 없음' : `${pct}%`}</span></div>`;
    })}
  </div>`;
}

export function featureTable(teams, features) {
  const shown = teams.filter((t) => features.some((f) => f.team_id === t.id));
  if (!shown.length) return html`<p class="muted">아직 등록한 기능이 없어요.</p>`;
  return html`${shown.map((t) => html`
    <h3 class="present-team">${t.name} <span class="muted small">${teamPercent(features.filter((f) => f.team_id === t.id))}%</span></h3>
    <ul class="present-features">
      ${features.filter((f) => f.team_id === t.id).map((f) => html`<li><strong>${f.name}</strong>${stageSteps(f.stage)}</li>`)}
    </ul>`)}`;
}

// 발표 자료: 개요·기능 현황·연결 지도·측정 결과·사진을 한 페이지로 모아 인쇄(PDF 저장)해요.
export async function presentView(el, ctx, params) {
  const allTeams = (ctx.state.teams || []).filter((t) => t.is_active);
  const teamId = Number(params.get('team')) || null;
  const scopeTeam = allTeams.find((t) => t.id === teamId) || null;
  const teams = scopeTeam ? [scopeTeam] : allTeams;
  render(el, html`<section class="card"><p class="muted">발표 자료를 모으는 중…</p></section>`);

  let features, measurements, logs, research, links, people, photos, urls;
  try {
    let byLog;
    [features, measurements, logs, research, links, people, byLog] = await Promise.all([
      fetchFeatures(), fetchMeasurements(), fetchLogs(), fetchResearch(), fetchLinks(), fetchPeople(), fetchPhotos(),
    ]);
    const inScope = (tid) => !scopeTeam || tid === scopeTeam.id;
    features = features.filter((f) => inScope(f.team_id));
    measurements = measurements.filter((m) => inScope(m.team_id)).reverse();
    logs = logs.filter((l) => inScope(l.team_id));
    research = research.filter((r) => inScope(r.team_id));
    if (scopeTeam) links = links.filter((l) => l.from_team === scopeTeam.id || l.to_team === scopeTeam.id);
    const logMap = new Map(logs.map((l) => [l.id, l]));
    photos = [...byLog.values()].flat().filter((ph) => logMap.has(ph.log_id))
      .map((ph) => ({ ...ph, log: logMap.get(ph.log_id) }))
      .sort((a, b) => (a.log.log_date === b.log.log_date ? a.id - b.id : a.log.log_date < b.log.log_date ? -1 : 1));
    urls = await signedUrls(photos);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const students = [...people.values()].filter((p) => p.role === 'student' && teams.some((t) => t.id === p.team_id));
  const working = features.filter((f) => f.stage === '작동 확인').length;
  const pct = teamPercent(features);
  const mapTeams = scopeTeam ? allTeams.filter((t) => t.id === scopeTeam.id || links.some((l) => l.from_team === t.id || l.to_team === t.id)) : allTeams;
  const teamName = (id) => allTeams.find((t) => t.id === id)?.name || '';
  // 사진이 많으면 처음에는 12장만 넣어요. 나머지는 체크해서 넣을 수 있어요.
  const PHOTO_DEFAULT = 12;
  const pickStep = photos.length > PHOTO_DEFAULT ? Math.ceil(photos.length / PHOTO_DEFAULT) : 1;

  render(el, html`
    <section class="card no-print">
      <h1 class="title">발표 자료 만들기</h1>
      <p class="muted">기록을 모아 발표용 한 페이지로 만들어요. 넣을 부분을 고르고, 사진·그래프 옆 체크를 끄면 그 항목은 빠져요. ‘인쇄 / PDF 저장’을 누르고 대상(프린터)에서 ‘PDF로 저장’을 고르면 파일이 돼요.</p>
      <div class="field-row">
        <div class="field">
          <label for="pr-team">범위</label>
          <select id="pr-team">
            <option value="">도시 전체</option>
            ${allTeams.map((t) => html`<option value="${t.id}" ${t.id === teamId ? 'selected' : ''}>${t.name}</option>`)}
          </select>
        </div>
      </div>
      <fieldset class="field checks">
        <legend>넣을 부분</legend>
        <div class="check-list" id="pr-sections">
          ${SECTIONS.map((s) => html`<label class="check"><input type="checkbox" value="${s.key}" checked> ${s.label}</label>`)}
        </div>
      </fieldset>
      <div class="row-actions">
        <button type="button" class="primary" id="pr-print">🖨 인쇄 / PDF 저장</button>
        <a class="secondary" href="#/teams">돌아가기</a>
      </div>
    </section>

    <div class="present" id="present">
      <section class="card present-cover" data-sec="overview">
        <p class="muted small">${formatDate(todayKst())} · 친환경 도시 모형 프로젝트</p>
        <h1 class="present-title">${scopeTeam ? scopeTeam.name : '실제 기능을 갖춘 친환경 도시 모형'}</h1>
        ${scopeTeam?.topic ? html`<p>${scopeTeam.topic}</p>` : ''}
        <div class="stats">
          ${scopeTeam ? '' : html`<div class="stat"><span class="stat-label">팀</span><strong class="stat-value">${allTeams.length}</strong></div>`}
          <div class="stat"><span class="stat-label">참여 학생</span><strong class="stat-value">${students.length}명</strong></div>
          <div class="stat"><span class="stat-label">활동 일지</span><strong class="stat-value">${logs.length}</strong></div>
          <div class="stat"><span class="stat-label">이론 조사</span><strong class="stat-value">${research.length}</strong></div>
          <div class="stat"><span class="stat-label">측정 기록</span><strong class="stat-value">${measurements.length}</strong></div>
          <div class="stat"><span class="stat-label">작동 확인 기능</span><strong class="stat-value">${working}/${features.length}</strong></div>
        </div>
        ${scopeTeam
          ? html`<p class="small"><strong>팀원</strong> ${students.map((p) => p.display_name || p.login_id).join(', ') || '없음'}</p>`
          : html`<ul class="present-teams">${allTeams.map((t) => html`<li><strong>${t.name}</strong>${t.topic ? html` · <span class="muted">${t.topic}</span>` : ''}</li>`)}</ul>`}
      </section>

      <section class="card" data-sec="progress">
        <h2 class="subtitle">기능 구현 현황 ${pct === null ? '' : html`<span class="muted small">· 전체 ${pct}%</span>`}</h2>
        ${scopeTeam ? '' : cityBoard(allTeams, features)}
        ${featureTable(teams, features)}
      </section>

      <section class="card" data-sec="links">
        <h2 class="subtitle">팀 간 연결 지도</h2>
        ${links.length ? html`${linkMap(mapTeams, links)}${linkList(allTeams, links)}` : html`<p class="muted">아직 연결이 없어요.</p>`}
      </section>

      <section class="card" data-sec="measure">
        <h2 class="subtitle">측정 결과</h2>
        ${measurements.length ? html`<div class="present-grid">${measurements.map((m) => html`
          <article class="present-item">
            <label class="pick no-print"><input type="checkbox" checked> 넣기</label>
            <h3 class="present-item-title">${m.title}</h3>
            <p class="muted small">${formatDate(m.measured_on)}${scopeTeam ? '' : ` · ${teamName(m.team_id)}`} · ${personName(people, m.author_id)}</p>
            ${lineChart(m)}
            ${m.conclusion ? html`<p class="small pre">${m.conclusion}</p>` : ''}
          </article>`)}</div>` : html`<p class="muted">아직 측정 기록이 없어요.</p>`}
      </section>

      <section class="card" data-sec="photos">
        <h2 class="subtitle">제작 과정 사진</h2>
        ${photos.length ? html`<div class="gallery present-photos">${photos.map((ph, i) => html`
          <figure class="gal-item present-item ${i % pickStep === 0 ? '' : 'skip'}">
            <label class="pick no-print"><input type="checkbox" ${i % pickStep === 0 ? 'checked' : ''}> 넣기</label>
            ${urls.get(ph.path) ? html`<img src="${urls.get(ph.path)}" alt="${ph.log.activity_type} 사진" loading="lazy">` : html`<div class="gal-missing muted small">사진을 불러오지 못했어요</div>`}
            <figcaption class="small">${formatDate(ph.log.log_date)} · ${ph.log.activity_type}${scopeTeam ? '' : ` · ${teamName(ph.log.team_id)}`}</figcaption>
          </figure>`)}</div>
          ${pickStep > 1 ? html`<p class="hint no-print">사진이 ${photos.length}장이라 고르게 ${Math.ceil(photos.length / pickStep)}장만 먼저 넣었어요. 체크로 바꿀 수 있어요.</p>` : ''}`
          : html`<p class="muted">아직 사진이 없어요.</p>`}
      </section>
    </div>
  `);
  bindCharts(el);
  bindLinkMap(el);

  el.querySelector('#pr-team').addEventListener('change', (e) => {
    ctx.go(e.target.value ? `/present?team=${e.target.value}` : '/present');
  });
  el.querySelector('#pr-sections').addEventListener('change', (e) => {
    el.querySelector(`[data-sec="${e.target.value}"]`).classList.toggle('skip', !e.target.checked);
  });
  el.querySelector('#present').addEventListener('change', (e) => {
    const item = e.target.closest('.pick') && e.target.closest('.present-item');
    if (item) item.classList.toggle('skip', !e.target.checked);
  });
  el.querySelector('#pr-print').addEventListener('click', () => {
    document.body.classList.add('printing-present');
    const done = () => {
      document.body.classList.remove('printing-present');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  });
}

