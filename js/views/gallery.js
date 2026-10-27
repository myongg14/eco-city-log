import { html, render } from '../ui.js';
import { fetchPhotos, fetchLogs, fetchPeople, personName, formatDate } from '../records.js';
import { signedUrls } from '../photos.js';

// 사진 갤러리: 일지 사진을 활동한 날짜순으로 모아 모형이 완성되는 과정을 보여 줘요.
export async function galleryView(el, ctx, params) {
  const teams = ctx.state.teams || [];
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);
  let photos, logs, people, urls;
  try {
    const byLog = await fetchPhotos();
    photos = [...byLog.values()].flat();
    [logs, people, urls] = await Promise.all([
      fetchLogs({ ids: [...byLog.keys()] }),
      fetchPeople(),
      signedUrls(photos),
    ]);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }
  const team = params.get('team') || '';
  const logMap = new Map(logs.map((l) => [l.id, l]));
  const shown = photos
    .filter((ph) => logMap.has(ph.log_id) && (!team || String(logMap.get(ph.log_id).team_id) === team))
    .sort((a, b) => {
      const la = logMap.get(a.log_id).log_date;
      const lb = logMap.get(b.log_id).log_date;
      return la === lb ? (a.created_at < b.created_at ? 1 : -1) : la < lb ? 1 : -1;
    });
  const byDate = new Map();
  for (const ph of shown) {
    const d = logMap.get(ph.log_id).log_date;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(ph);
  }

  render(el, html`
    <section class="card">
      <h1 class="title">사진 갤러리</h1>
      <p class="muted">활동 일지에 올린 사진이 날짜순으로 모여요. 사진을 누르면 크게 볼 수 있어요.</p>
      <select id="gal-team">
        <option value="">모든 팀</option>
        ${teams.map((t) => html`<option value="${t.id}" ${String(t.id) === team ? 'selected' : ''}>${t.name}</option>`)}
      </select>
    </section>
    ${byDate.size ? [...byDate].map(([d, list]) => html`
      <section class="card">
        <h2 class="subtitle">${formatDate(d)}</h2>
        <div class="gallery">
          ${list.map((ph) => {
            const l = logMap.get(ph.log_id);
            const t = teams.find((x) => x.id === l.team_id);
            return html`
              <figure class="gal-item">
                ${urls.get(ph.path)
                  ? html`<a href="${urls.get(ph.path)}" target="_blank" rel="noopener"><img src="${urls.get(ph.path)}" alt="${l.activity_type} 사진" loading="lazy"></a>`
                  : html`<div class="gal-missing muted small">사진을 불러오지 못했어요</div>`}
                <figcaption class="small">
                  <strong>${l.activity_type}</strong> · ${String(l.did).split('\n')[0].slice(0, 40)}
                  <span class="muted">${personName(people, l.author_id)}${t ? ` · ${t.name}` : ''}</span>
                </figcaption>
              </figure>`;
          })}
        </div>
      </section>`)
      : html`<section class="card"><p class="muted">아직 사진이 없어요. 활동 일지를 쓸 때 사진을 함께 올려 보세요.</p></section>`}
  `);
  el.querySelector('#gal-team').addEventListener('change', (e) => {
    ctx.go(e.target.value ? `/gallery?team=${e.target.value}` : '/gallery');
  });
}
