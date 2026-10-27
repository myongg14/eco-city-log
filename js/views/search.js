import { html, render } from '../ui.js';
import { fetchPeople, fetchResearch, fetchLogs, fetchPurchases, fetchNotices, fetchTasks, fetchReflections, personName, shortDate, weekLabel } from '../records.js';

// 통합 검색: 일지, 조사, 성찰, 물품, 공지, 할 일을 한 번에 찾아요.
export async function searchView(el, ctx, params) {
  const me = ctx.state.me;
  const isStaff = me.role !== 'student';
  render(el, html`<section class="card"><p class="muted">불러오는 중…</p></section>`);

  let people, data;
  try {
    const [p, logs, research, purchases, notices, tasks, reflections] = await Promise.all([
      fetchPeople(), fetchLogs(), fetchResearch(), fetchPurchases(), fetchNotices(), fetchTasks(),
      fetchReflections(isStaff ? {} : { authorId: me.user_id }),
    ]);
    people = p;
    data = { logs, research, purchases, notices, tasks, reflections };
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  const who = (id) => personName(people, id);
  const loginOf = (id) => encodeURIComponent(people.get(id)?.login_id || '');
  const groups = [
    { label: '활동 일지', rows: data.logs, text: (l) => [l.did, l.problem, l.results, (l.next_steps || []).join(' '), l.activity_type, (l.subjects || []).join(' ')],
      title: (l) => String(l.did).split('\n')[0], meta: (l) => `${who(l.author_id)} · ${shortDate(l.log_date)} · ${l.activity_type}`,
      href: (l) => `#/records?u=${loginOf(l.author_id)}&f=log` },
    { label: '이론 조사', rows: data.research, text: (r) => [r.title, r.summary, r.application, r.new_question, r.source_author, r.source_publisher, (r.subjects || []).join(' ')],
      title: (r) => r.title, meta: (r) => `${who(r.author_id)} · ${r.source_type}`, href: (r) => `#/records?u=${loginOf(r.author_id)}&f=research` },
    { label: '성찰', rows: data.reflections, text: (r) => [r.best, r.hardship, r.learned, r.changed, r.next_inquiry, (r.competencies || []).join(' ')],
      title: (r) => r.best, meta: (r) => `${who(r.author_id)} · ${r.kind === '최종' ? '최종 성찰' : weekLabel(r.week_of)}`,
      href: (r) => `#/records?u=${loginOf(r.author_id)}&f=reflection` },
    { label: '물품', rows: data.purchases, text: (p) => [p.item_name, p.usage, p.reason, p.status],
      title: (p) => p.item_name, meta: (p) => `${who(p.requester_id)} · ${p.status}`, href: () => '#/supplies' },
    { label: '공지', rows: data.notices, text: (n) => [n.title, n.body], title: (n) => n.title, meta: (n) => shortDate(n.created_at), href: () => '#/home' },
    { label: '할 일', rows: data.tasks, text: (t) => [t.title, t.detail], title: (t) => t.title,
      meta: (t) => `${t.assignee_id ? who(t.assignee_id) : '담당 없음'} · ${t.status}`, href: () => '#/tasks?f=all' },
  ];

  render(el, html`
    <section class="card">
      <h1 class="title">검색</h1>
      <p class="muted">기록, 자료, 물품, 공지, 할 일을 한 번에 찾아요. ${isStaff ? '' : '성찰은 내 것만 찾아져요.'}</p>
      <input id="sq" type="search" placeholder="예: 태양광, 센서, 배터리" value="${params.get('q') || ''}" autofocus>
      <p class="hint" id="s-count"></p>
    </section>
    <div id="s-results"></div>
  `);

  const input = el.querySelector('#sq');
  const out = el.querySelector('#s-results');
  const count = el.querySelector('#s-count');

  function snippet(texts, word) {
    const hay = texts.filter(Boolean).join(' · ');
    const i = hay.toLowerCase().indexOf(word);
    if (i < 0) return '';
    const start = Math.max(0, i - 25);
    return html`${start ? '…' : ''}${hay.slice(start, i)}<mark>${hay.slice(i, i + word.length)}</mark>${hay.slice(i + word.length, i + word.length + 45)}…`;
  }

  function draw() {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    history.replaceState(null, '', `#/search${words.length ? `?q=${encodeURIComponent(input.value.trim())}` : ''}`);
    if (!words.length) {
      count.textContent = '';
      render(out, '');
      return;
    }
    let total = 0;
    const found = groups.map((g) => {
      const rows = g.rows.filter((r) => {
        const hay = [...g.text(r), g.meta(r)].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      total += rows.length;
      return { ...g, rows };
    }).filter((g) => g.rows.length);
    count.textContent = total ? `${total}개 찾았어요.` : '찾는 내용이 없어요. 다른 낱말로 찾아보세요.';
    render(out, html`${found.map((g) => html`
      <section class="card">
        <h2 class="subtitle">${g.label} <span class="muted small">${g.rows.length}</span></h2>
        <ul class="search-list">
          ${g.rows.slice(0, 30).map((r) => html`
            <li><a href="${g.href(r)}">
              <strong>${String(g.title(r)).slice(0, 60)}</strong>
              <span class="muted small">${g.meta(r)}</span>
              <span class="small">${snippet(g.text(r), words[0])}</span>
            </a></li>`)}
        </ul>
        ${g.rows.length > 30 ? html`<p class="hint">앞의 30개만 보여요. 낱말을 더 넣어 좁혀 보세요.</p>` : ''}
      </section>`)}`);
  }
  input.addEventListener('input', draw);
  draw();
}
