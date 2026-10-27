import { rpc } from '../api.js';
import { html, render, showMessage, setBusy, toast, copyText } from '../ui.js';
import { fetchShowcaseSettings, fetchShowcaseItems, fetchMeasurements, fetchPhotos, fetchLogs, fetchPeople, personName, formatDate } from '../records.js';
import { signedUrls } from '../photos.js';
import { lineChart, bindCharts } from '../chart.js';
import { linkMap, linkList, bindLinkMap } from '../linkmap.js';
import { cityBoard, featureTable } from './present.js';
import { teamPercent } from './progress.js';

export function showcaseUrl() {
  return `${location.origin}${location.pathname}#/showcase`;
}

// 외부 공개 페이지: 로그인 없이 보는 프로젝트 소개. 학생 이름은 데이터베이스에서부터 빼고 받아요.
export async function showcaseView(el, ctx) {
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let data;
  let urls = new Map();
  try {
    data = await rpc('public_showcase');
    if (data?.enabled && data.photos.length) {
      try {
        urls = await signedUrls(data.photos);
      } catch {
        // 사진을 못 불러와도 나머지는 보여 줘요.
      }
    }
  } catch (err) {
    render(el, html`<section class="card narrow"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const loginLink = ctx.state.me ? html`<a class="link" href="#/home">기록장으로 돌아가기</a>` : html`<a class="link" href="#/login">팀원 로그인</a>`;
  if (!data?.enabled) {
    render(el, html`
      <section class="card narrow">
        <h1 class="title">친환경 도시 모형 프로젝트</h1>
        <p class="muted">아직 공개하지 않은 페이지예요. 준비가 끝나면 이 주소에서 볼 수 있어요.</p>
        <p>${loginLink}</p>
      </section>`);
    return;
  }
  const { teams, features, links, measurements, photos, counts } = data;
  const teamName = (id) => teams.find((t) => t.id === id)?.name || '';
  const pct = teamPercent(features);

  render(el, html`
    <section class="card showcase-hero">
      <p class="muted small">고등학교 2학년 친환경 프로젝트</p>
      <h1 class="present-title">실제 기능을 갖춘 친환경 도시 모형</h1>
      ${data.intro ? html`<p class="pre">${data.intro}</p>` : ''}
      <div class="stats">
        <div class="stat"><span class="stat-label">팀</span><strong class="stat-value">${teams.length}</strong></div>
        <div class="stat"><span class="stat-label">참여 학생</span><strong class="stat-value">${counts.students}명</strong></div>
        <div class="stat"><span class="stat-label">활동 일지</span><strong class="stat-value">${counts.logs}</strong></div>
        <div class="stat"><span class="stat-label">이론 조사</span><strong class="stat-value">${counts.research}</strong></div>
        <div class="stat"><span class="stat-label">측정 기록</span><strong class="stat-value">${counts.measurements}</strong></div>
        <div class="stat"><span class="stat-label">도시 완성도</span><strong class="stat-value">${pct === null ? '-' : `${pct}%`}</strong></div>
      </div>
    </section>

    <section class="card">
      <h2 class="subtitle">팀 소개</h2>
      <ul class="present-teams">
        ${teams.map((t) => html`<li><strong>${t.name}</strong> <span class="muted small">${t.members}명</span>${t.topic ? html`<br><span class="muted">${t.topic}</span>` : ''}</li>`)}
      </ul>
    </section>

    <section class="card">
      <h2 class="subtitle">도시 진행 현황</h2>
      ${cityBoard(teams, features)}
      <details class="showcase-more"><summary>기능별로 보기</summary>${featureTable(teams, features)}</details>
    </section>

    ${links.length ? html`
      <section class="card">
        <h2 class="subtitle">팀 간 연결 지도</h2>
        <p class="muted small">화살표는 한 팀의 결과물이 다른 팀으로 가는 방향이에요.</p>
        ${linkMap(teams, links)}
        ${linkList(teams, links)}
      </section>` : ''}

    ${measurements.length ? html`
      <section class="card">
        <h2 class="subtitle">실험·측정 결과</h2>
        <div class="present-grid">
          ${measurements.map((m) => html`
            <article class="present-item">
              <h3 class="present-item-title">${m.title}</h3>
              <p class="muted small">${formatDate(m.measured_on)} · ${teamName(m.team_id)}</p>
              ${lineChart(m)}
              ${m.conclusion ? html`<p class="small pre">${m.conclusion}</p>` : ''}
            </article>`)}
        </div>
      </section>` : ''}

    ${photos.length ? html`
      <section class="card">
        <h2 class="subtitle">제작 과정</h2>
        <div class="gallery">
          ${photos.filter((ph) => urls.get(ph.path)).map((ph) => html`
            <figure class="gal-item">
              <img src="${urls.get(ph.path)}" alt="${teamName(ph.team_id)} ${ph.activity_type} 사진" loading="lazy">
              <figcaption class="small">${formatDate(ph.log_date)} · ${teamName(ph.team_id)}</figcaption>
            </figure>`)}
        </div>
      </section>` : ''}

    <section class="card">
      <p class="muted small">이 페이지는 학생 이름을 보여 주지 않아요. ${loginLink}</p>
    </section>
  `);
  bindCharts(el);
  bindLinkMap(el);
}

// 외부 공개 페이지 설정 (관리자·선생님)
export async function showcaseSettingsView(el, ctx) {
  const teams = ctx.state.teams || [];
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let settings, picked, measurements, photos, urls, people;
  try {
    let byLog;
    [settings, picked, measurements, byLog, people] = await Promise.all([
      fetchShowcaseSettings(), fetchShowcaseItems(), fetchMeasurements(), fetchPhotos(), fetchPeople(),
    ]);
    const logs = await fetchLogs({ ids: [...byLog.keys()] });
    const logMap = new Map(logs.map((l) => [l.id, l]));
    photos = [...byLog.values()].flat().filter((ph) => logMap.has(ph.log_id))
      .map((ph) => ({ ...ph, log: logMap.get(ph.log_id) }))
      .sort((a, b) => (a.log.log_date < b.log.log_date ? 1 : -1));
    urls = await signedUrls(photos);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const teamName = (id) => teams.find((t) => t.id === id)?.name || '';

  render(el, html`
    <section class="card">
      <a href="#/admin" class="link small">← 관리</a>
      <h1 class="title">외부 공개 페이지</h1>
      <p class="muted">로그인 없이 누구나 보는 프로젝트 소개 화면이에요. 팀 이름, 기능 진행 상황, 연결 지도, 기록 개수가 나오고 학생 이름·아이디는 나오지 않아요. 측정 기록과 사진은 아래에서 고른 것만 나와요.</p>
      <p class="badge ${settings.enabled ? 'ok' : ''}">${settings.enabled ? '지금 공개 중' : '지금 꺼져 있음'}</p>
      <form id="sc-form" novalidate>
        <label class="check"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}> 공개하기</label>
        <div class="field">
          <label for="sc-intro">소개 글</label>
          <textarea id="sc-intro" name="intro" rows="4" placeholder="예: 7개 팀이 에너지 생산부터 저장, 자율주행, 도시 계획까지 실제로 움직이는 도시 모형을 만들고 있어요.">${settings.intro}</textarea>
        </div>
        <p class="message" id="sc-msg" hidden></p>
        <div class="row-actions">
          <button type="submit" class="primary" id="sc-btn">저장</button>
          <a class="secondary" href="#/showcase" target="_blank" rel="noopener">미리 보기</a>
          <button type="button" class="secondary" id="sc-copy">주소 복사</button>
        </div>
      </form>
      <p class="hint">주소: ${showcaseUrl()}</p>
    </section>

    <section class="card">
      <h2 class="subtitle">공개할 측정 기록</h2>
      <p class="hint">결과 해석에 학생 이름이 들어 있으면 고르지 마세요.</p>
      ${measurements.length ? html`<ul class="pick-list" id="sc-meas">
        ${measurements.map((m) => html`<li><label class="check"><input type="checkbox" data-kind="measurement" value="${m.id}" ${picked.measurement.has(m.id) ? 'checked' : ''}>
          ${m.title} <span class="muted small">· ${formatDate(m.measured_on)} · ${teamName(m.team_id)} · ${personName(people, m.author_id)}</span></label></li>`)}
      </ul>` : html`<p class="muted">아직 측정 기록이 없어요.</p>`}
    </section>

    <section class="card">
      <h2 class="subtitle">공개할 사진</h2>
      <p class="hint">얼굴이나 이름표가 보이는 사진은 고르지 마세요. 고른 사진은 공개를 켠 동안 누구나 볼 수 있어요.</p>
      ${photos.length ? html`<div class="gallery" id="sc-photos">
        ${photos.map((ph) => html`<figure class="gal-item ${picked.photo.has(ph.id) ? 'picked' : ''}">
          ${urls.get(ph.path) ? html`<img src="${urls.get(ph.path)}" alt="${ph.log.activity_type} 사진" loading="lazy">` : html`<div class="gal-missing muted small">사진을 불러오지 못했어요</div>`}
          <figcaption class="small"><label class="check"><input type="checkbox" data-kind="photo" value="${ph.id}" ${picked.photo.has(ph.id) ? 'checked' : ''}> 공개</label>
            <span class="muted">${formatDate(ph.log.log_date)} · ${teamName(ph.log.team_id)}</span></figcaption>
        </figure>`)}
      </div>` : html`<p class="muted">아직 사진이 없어요.</p>`}
    </section>
  `);

  const form = el.querySelector('#sc-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el.querySelector('#sc-msg');
    const btn = el.querySelector('#sc-btn');
    setBusy(btn, true, '저장 중…');
    try {
      await rpc('set_showcase', { p_enabled: form.elements.enabled.checked, p_intro: form.elements.intro.value });
      toast(form.elements.enabled.checked ? '공개 페이지를 켰어요.' : '공개 페이지를 껐어요.');
      showcaseSettingsView(el, ctx);
    } catch (err) {
      showMessage(msg, err.message);
      setBusy(btn, false);
    }
  });
  el.querySelector('#sc-copy').addEventListener('click', async () => {
    toast((await copyText(showcaseUrl())) ? '주소를 복사했어요.' : '복사하지 못했어요. 주소를 길게 눌러 복사해 주세요.');
  });
  el.addEventListener('change', async (e) => {
    const box = e.target.closest('input[data-kind]');
    if (!box) return;
    box.disabled = true;
    try {
      await rpc('set_showcase_item', { p_kind: box.dataset.kind, p_ref: Number(box.value), p_on: box.checked });
      box.closest('.gal-item')?.classList.toggle('picked', box.checked);
      toast(box.checked ? '공개 목록에 넣었어요.' : '공개 목록에서 뺐어요.');
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message);
    } finally {
      box.disabled = false;
    }
  });
}
