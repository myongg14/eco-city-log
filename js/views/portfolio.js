// 생기부 정리: 학생 본인이 쓰거나 참여자로 표시된 기록만 규칙과 틀로 모아 보여 줘요. (AI 를 쓰지 않아요)
import { fetchMyProfile } from '../api.js';
import { html, render, toast, copyText } from '../ui.js';
import {
  fetchPeople, fetchPlan, fetchResearch, fetchLogs, fetchJoinedLogs, fetchReflections,
  findVague, splitLines, formatDate, shortDate, weekLabel, addDays, kstDay, COMPETENCIES,
} from '../records.js';

const DRAFT_LIMIT = 500;

// 첫 문장(또는 첫 줄)만, 너무 길면 줄여서. 끝의 마침표는 떼요.
function clip(text, max = 70) {
  const first = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  const sentence = first.split(/(?<=[.!?。])\s/)[0].replace(/[.。!?\s]+$/, '');
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

function firstLine(text) {
  return clip(text, 50);
}

// 영역 태그가 없으면 기록 종류로 나눠요.
function areasOf(kind, r) {
  if (r.areas?.length) return r.areas;
  if (kind === 'reflection') return ['진로'];
  if (kind === 'research') return ['동아리'];
  return ['회의', '발표'].includes(r.activity_type) ? ['자율'] : ['동아리'];
}

function countBy(list, fn) {
  return list.reduce((m, x) => m.set(fn(x), (m.get(fn(x)) || 0) + 1), new Map());
}

function joinCounts(map, unit = '회') {
  return [...map].map(([k, n]) => `${k} ${n}${unit}`).join(', ');
}

// 문장 목록을 이어 붙이되 글자 수 한도를 넘지 않게 해요.
function compose(sentences, limit = DRAFT_LIMIT) {
  let out = '';
  for (const s of sentences.filter(Boolean)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > limit) break;
    out = next;
  }
  return out;
}

function buildDrafts({ profile, team, plan, logs, joined, research, reflections }) {
  const all = [
    ...logs.map((r) => ({ kind: 'log', r })),
    ...joined.map((r) => ({ kind: 'log', r, joined: true })),
    ...research.map((r) => ({ kind: 'research', r })),
    ...reflections.map((r) => ({ kind: 'reflection', r })),
  ];
  const inArea = (a) => all.filter((x) => areasOf(x.kind, x.r).includes(a));
  const latest = (list, key) => list.map((x) => x[key]).find(Boolean);
  const byRecent = [...reflections].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // 자율: 공동체 문제를 팀이 함께 풀어 간 과정, 협업과 갈등 해결
  const ja = inArea('자율');
  const jaLogs = ja.filter((x) => x.kind === 'log');
  const teamwork = byRecent.find((r) => r.competencies?.some((c) => ['협업능력', '의사소통', '리더십', '공동체의식'].includes(c))) || byRecent[0];
  const jaMissing = [];
  if (!jaLogs.length) jaMissing.push('회의·발표 일지나 ‘자율’ 영역으로 표시한 일지가 없어요.');
  if (!joined.length && !logs.some((l) => l.activity_type === '회의')) jaMissing.push('팀원과 함께 한 활동(같이 한 팀원 표시)이 없어요.');
  if (!teamwork) jaMissing.push('성찰의 ‘어려웠던 점과 극복’이 없어요.');
  const jaText = compose([
    `${team ? `${team.name} 팀의 일원으로` : '팀의 일원으로'} 친환경 도시 모형 제작 프로젝트에 참여함.`,
    profile?.role_desc ? `팀에서 ‘${clip(profile.role_desc, 40)}’ 역할을 맡음.` : '',
    jaLogs.length ? `회의·발표 등 공동 활동 ${jaLogs.length}회${joined.length ? `, 팀원과 함께 기록한 활동 ${joined.length}회` : ''}에 참여함.` : '',
    teamwork?.hardship ? `활동 중 ‘${clip(teamwork.hardship)}’의 과정을 겪으며 문제를 함께 해결함.` : '',
    jaLogs[0] ? `대표 활동: ${shortDate(jaLogs[0].r.log_date)} ${jaLogs[0].r.activity_type} - ${clip(jaLogs[0].r.did, 60)}.` : '',
    teamwork?.best ? `스스로 가장 잘한 점으로 ‘${clip(teamwork.best, 50)}’을 꼽음.` : '',
  ]);

  // 동아리: 맡은 기능을 설계·제작·실험한 전문적 탐구
  const dong = inArea('동아리');
  const dLogs = dong.filter((x) => x.kind === 'log').map((x) => x.r);
  const dResearch = dong.filter((x) => x.kind === 'research').map((x) => x.r);
  const withProblem = dLogs.find((l) => l.problem);
  const withResult = dLogs.find((l) => l.results);
  const dMissing = [];
  if (!plan) dMissing.push('개인 계획서(맡을 기능·탐구 질문)가 없어요.');
  if (!dLogs.some((l) => ['설계', '제작', '실험·테스트'].includes(l.activity_type))) dMissing.push('설계·제작·실험 일지가 없어요.');
  if (!withResult) dMissing.push('‘실험 결과·측정값’을 쓴 일지가 없어요.');
  if (!dResearch.length) dMissing.push('이론 조사 기록이 없어요.');
  const types = countBy(dLogs.filter((l) => l.activity_type !== '회의'), (l) => l.activity_type);
  const dText = compose([
    plan ? `친환경 도시 모형에서 ‘${clip(plan.role_focus, 40)}’을 맡아 ‘${clip(plan.question, 60)}’에 대해 탐구함.` : '친환경 도시 모형 제작에서 맡은 기능을 탐구함.',
    types.size ? `${joinCounts(types)}에 걸쳐 활동함.` : '',
    dResearch.length ? `관련 자료 ${dResearch.length}건(${joinCounts(countBy(dResearch, (r) => r.source_type), '건')})을 조사하여 ‘${clip(dResearch[0].application, 50)}’에 적용함.` : '',
    withProblem ? `제작 중 ‘${clip(withProblem.problem)}’의 방법으로 문제를 해결함.` : '',
    withResult ? `그 결과 ‘${clip(withResult.results, 60)}’을 확인함.` : '',
  ]);

  // 진로: 활동과 희망 진로의 연결, 생각의 변화
  const changed = latest(byRecent, 'changed');
  const nextQ = latest(byRecent, 'next_inquiry') || research.map((r) => r.new_question).find(Boolean);
  const jinMissing = [];
  if (!profile?.career_goal) jinMissing.push('내 정보에 희망 진로가 없어요.');
  if (!plan) jinMissing.push('개인 계획서의 동기가 없어요.');
  if (!changed) jinMissing.push('성찰의 ‘생각이 바뀐 점’이 없어요.');
  if (!nextQ) jinMissing.push('‘다음에 해 볼 탐구’가 없어요.');
  const jinText = compose([
    profile?.career_goal ? `‘${clip(profile.career_goal, 30)}’ 진로를 희망함.` : '',
    plan?.motivation ? `‘${clip(plan.motivation)}’을 계기로 프로젝트에 참여함.` : '',
    plan?.subjects ? `연계 교과·진로: ${clip(plan.subjects, 60)}.` : '',
    changed ? `활동을 통해 ‘${clip(changed)}’으로 생각이 바뀜.` : '',
    latest(byRecent, 'learned') ? `새로 배운 점으로 ‘${clip(latest(byRecent, 'learned'), 60)}’을 정리함.` : '',
    nextQ ? `후속 탐구로 ‘${clip(nextQ, 60)}’을 계획함.` : '',
  ]);

  return [
    { area: '자율', desc: '공동체 문제를 팀이 함께 풀어 간 과정, 협업과 갈등 해결', text: jaText, missing: jaMissing, evidence: ja },
    { area: '동아리', desc: '맡은 기능을 설계·제작·실험한 전문적 탐구', text: dText, missing: dMissing, evidence: dong },
    { area: '진로', desc: '활동과 희망 진로의 연결, 생각의 변화', text: jinText, missing: jinMissing, evidence: inArea('진로') },
  ];
}

function evidenceItem(x) {
  const r = x.r;
  if (x.kind === 'log') return html`<li>${shortDate(r.log_date)} 일지(${r.activity_type})${x.joined ? ' · 같이 함' : ''}: ${firstLine(r.did)}</li>`;
  if (x.kind === 'research') return html`<li>${shortDate(r.created_at)} 조사(${r.source_type}): ${r.title}</li>`;
  return html`<li>${r.kind === '최종' ? '최종 성찰' : weekLabel(r.week_of)}: ${firstLine(r.best)}</li>`;
}

function storyCell(items, empty) {
  const list = items.filter(Boolean);
  return list.length ? html`<ul>${list.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="warn-text small">${empty}</p>`;
}

export async function portfolioView(el, ctx, params) {
  const me = ctx.state.me;
  const teams = ctx.state.teams || [];
  const isStaff = me.role !== 'student';
  render(el, html`<section class="card"><p class="muted">기록을 모으는 중…</p></section>`);

  let people, target, profile, plan, logs, joined, research, reflections;
  try {
    people = await fetchPeople();
    const students = [...people.values()].filter((p) => p.role === 'student');
    target = isStaff
      ? students.find((p) => p.login_id === params.get('u')) || students[0]
      : people.get(me.user_id);
    if (!target) {
      render(el, html`<section class="card"><p class="muted">아직 학생 계정이 없어요.</p></section>`);
      return;
    }
    [profile, plan, logs, joined, research, reflections] = await Promise.all([
      target.user_id === me.user_id ? me : fetchMyProfile(target.user_id),
      fetchPlan(target.user_id),
      fetchLogs({ authorId: target.user_id }),
      fetchJoinedLogs(target.user_id),
      fetchResearch({ authorId: target.user_id }),
      fetchReflections({ authorId: target.user_id }),
    ]);
    joined = joined.filter((l) => l.author_id !== target.user_id);
  } catch (err) {
    render(el, html`<section class="card"><p class="message error">${err.message}</p></section>`);
    return;
  }

  const team = teams.find((t) => t.id === target.team_id);
  const students = [...people.values()].filter((p) => p.role === 'student');
  const isMine = target.user_id === me.user_id;
  const chrono = [...logs, ...joined].sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
  const reflByWeek = [...reflections].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  // 빈칸 알림
  const alerts = [];
  if (!plan) alerts.push(html`개인 계획서가 아직 없어요. ${isMine ? html`<a class="link" href="#/plan">계획서 쓰기</a>` : ''}`);
  const lastRefl = reflections.map((r) => r.updated_at || r.created_at).sort().pop();
  if (!lastRefl || Date.now() - new Date(lastRefl) > 14 * 86400000) {
    alerts.push(html`성찰을 2주 넘게 쓰지 않았어요. ${isMine ? html`<a class="link" href="#/reflection/new">이번 주 성찰 쓰기</a>` : ''}`);
  }
  const noLink = research.filter((r) => !r.source_url);
  if (noLink.length) alerts.push(html`출처 링크가 없는 조사 기록이 ${noLink.length}건 있어요. 다시 찾아볼 수 있게 링크를 남겨 두면 좋아요.`);
  const noResult = logs.filter((l) => ['실험·테스트', '제작'].includes(l.activity_type) && !l.results);
  if (noResult.length) alerts.push(html`측정값이 비어 있는 제작·실험 일지가 ${noResult.length}개 있어요.`);
  if (!reflections.some((r) => r.kind === '최종') && kstDay() >= '2026-12-01') {
    alerts.push(html`최종 성찰을 써 주세요. ${isMine ? html`<a class="link" href="#/reflection/new?kind=최종">최종 성찰 쓰기</a>` : ''}`);
  }

  // 표현 점검
  const vague = [
    ...logs.map((l) => ({ label: `${shortDate(l.log_date)} 일지`, href: `#/log/${l.id}`, words: findVague([l.did, l.problem, l.results].join(' ')) })),
    ...research.map((r) => ({ label: `조사 ‘${r.title}’`, href: `#/research/${r.id}`, words: findVague([r.summary, r.application].join(' ')) })),
    ...reflections.map((r) => ({ label: r.kind === '최종' ? '최종 성찰' : weekLabel(r.week_of), href: `#/reflection/${r.id}`,
      words: findVague([r.best, r.hardship, r.learned, r.changed].join(' ')) })),
  ].filter((v) => v.words.length);

  // 숫자로 보기
  const numberLines = chrono.flatMap((l) => splitLines(l.results).filter((s) => /\d/.test(s)).map((s) => ({ day: l.log_date, s }))).slice(-8);

  // 역량 태그 모아보기: 성찰에서 고른 역량 → 그 주의 일지
  const competencies = COMPETENCIES.map((c) => {
    const refls = reflByWeek.filter((r) => r.competencies?.includes(c));
    return {
      c,
      refls: refls.map((r) => ({
        r,
        logs: r.kind === '주간' ? chrono.filter((l) => l.log_date >= r.week_of && l.log_date <= addDays(r.week_of, 6)) : [],
      })),
    };
  }).filter((x) => x.refls.length).sort((a, b) => b.refls.length - a.refls.length);

  // 교과 연계
  const bySubject = new Map();
  for (const l of chrono) for (const s of l.subjects || []) bySubject.set(s, [...(bySubject.get(s) || []), `${shortDate(l.log_date)} 일지: ${firstLine(l.did)}`]);
  for (const r of research) for (const s of r.subjects || []) bySubject.set(s, [...(bySubject.get(s) || []), `조사: ${r.title}`]);

  const drafts = buildDrafts({ profile, team, plan, logs, joined, research, reflections });
  const report = compose([
    plan ? `[동기] ${clip(plan.motivation)}. 이를 바탕으로 ‘${clip(plan.question, 60)}’에 대해 탐구함.` : '',
    chrono.length ? `[과정] ${shortDate(chrono[0].log_date)}부터 ${chrono.length}회 활동함(${joinCounts(countBy(chrono, (l) => l.activity_type))}). ${clip(chrono[chrono.length - 1].did, 60)}.` : '',
    research.length ? `관련 자료 ${research.length}건을 조사함.` : '',
    chrono.find((l) => l.results) ? `[결과] ${clip([...chrono].reverse().find((l) => l.results).results, 80)}.` : '',
    reflections.find((r) => r.learned) ? `[배운 점] ${clip(reflByWeek[reflByWeek.length - 1].learned, 80)}.` : '',
    reflections.find((r) => r.next_inquiry) ? `[후속 탐구] ${clip(reflByWeek.filter((r) => r.next_inquiry).pop().next_inquiry, 60)}.` : '',
  ], 560);

  render(el, html`
    <section class="card">
      <div class="title-row">
        <h1 class="title">${isMine ? '나의 생기부 정리' : `${target.display_name || target.login_id}의 생기부 정리`}</h1>
        <div class="title-actions no-print"><button type="button" class="secondary" id="pf-print">🖨 인쇄·PDF</button></div>
      </div>
      ${isStaff ? html`
        <label for="pf-who" class="inline-label no-print">학생 고르기</label>
        <select id="pf-who" class="no-print">
          ${teams.map((t) => {
            const members = students.filter((p) => p.team_id === t.id);
            return members.length ? html`<optgroup label="${t.name}">${members.map((p) => html`<option value="${p.login_id}" ${p.user_id === target.user_id ? 'selected' : ''}>${p.display_name || '(이름 없음)'} · ${p.login_id}</option>`)}</optgroup>` : '';
          })}
        </select>` : ''}
      <p class="notice-box">이 정리는 ${isMine ? '내가' : '학생이'} 쓴 기록과 참여자로 표시된 일지만 모아 규칙에 따라 만든 <strong>참고용 초안</strong>이에요.
        생기부는 선생님이 관찰한 내용으로 작성해요.</p>
      <div class="stats">
        <div class="stat"><span class="stat-label">활동 일지</span><strong class="stat-value">${logs.length}</strong><span class="stat-label">같이 한 일지 ${joined.length}개</span></div>
        <div class="stat"><span class="stat-label">이론 조사</span><strong class="stat-value">${research.length}</strong>
          <span class="stat-label">${research.length ? joinCounts(countBy(research, (r) => r.source_type), '건') : '아직 없음'}</span></div>
        <div class="stat"><span class="stat-label">성찰</span><strong class="stat-value">${reflections.length}</strong>
          <span class="stat-label">${reflections.some((r) => r.kind === '최종') ? '최종 성찰 완료' : '최종 성찰 전'}</span></div>
        <div class="stat"><span class="stat-label">측정값 있는 일지</span><strong class="stat-value">${chrono.filter((l) => l.results).length}</strong>
          <span class="stat-label">활동 유형 ${countBy(chrono, (l) => l.activity_type).size}가지</span></div>
      </div>
    </section>

    ${alerts.length ? html`
      <section class="card">
        <h2 class="subtitle">🔔 채우면 좋은 빈칸</h2>
        <ul class="alerts">${alerts.map((a) => html`<li>${a}</li>`)}</ul>
      </section>` : ''}

    <section class="card">
      <h2 class="subtitle">나의 탐구 스토리</h2>
      <table class="story"><tbody>
        <tr><th>동기</th><td>${storyCell([plan?.motivation && clip(plan.motivation, 120), plan?.question && `탐구 질문: ${plan.question}`, profile?.career_goal && `희망 진로: ${profile.career_goal}`], '계획서의 동기와 탐구 질문을 써 보세요.')}</td></tr>
        <tr><th>과정</th><td>${storyCell([
          ...chrono.slice(-8).map((l) => `${shortDate(l.log_date)} [${l.activity_type}] ${firstLine(l.did)}`),
          research.length ? `이론 조사 ${research.length}건: ${research.slice(0, 3).map((r) => r.title).join(', ')}${research.length > 3 ? ' 등' : ''}` : '',
        ], '활동 일지를 써 보세요.')}</td></tr>
        <tr><th>결과</th><td>${storyCell(chrono.filter((l) => l.results).slice(-5).map((l) => `${shortDate(l.log_date)} ${clip(l.results, 100)}`), '일지의 ‘실험 결과·측정값’을 채워 보세요.')}</td></tr>
        <tr><th>배운 점</th><td>${storyCell([...reflByWeek.slice(-4).map((r) => clip(r.learned, 100)), ...reflByWeek.filter((r) => r.changed).slice(-2).map((r) => `생각이 바뀐 점: ${clip(r.changed, 80)}`)], '성찰의 ‘새로 배운 것’을 써 보세요.')}</td></tr>
        <tr><th>후속 탐구</th><td>${storyCell([...reflByWeek.map((r) => r.next_inquiry).filter(Boolean).slice(-3), ...research.map((r) => r.new_question).filter(Boolean).slice(0, 2)].map((t) => clip(t, 80)), '성찰의 ‘다음에 해 볼 탐구’를 써 보세요.')}</td></tr>
      </tbody></table>
    </section>

    <section class="card">
      <h2 class="subtitle">자율 · 동아리 · 진로 영역별 초안</h2>
      <p class="hint">영역을 고르지 않은 기록은 종류에 따라 나눴어요. 회의·발표 일지 → 자율, 조사·설계·제작·실험 일지와 이론 조사 → 동아리, 성찰 → 진로.</p>
      ${drafts.map((d, i) => html`
        <div class="draft">
          <div class="title-row">
            <h3 class="rec-title">${d.area} <span class="muted small">${d.desc}</span></h3>
            <button type="button" class="secondary small no-print" data-copy="${i}">복사</button>
          </div>
          <p class="draft-text" id="draft-${i}">${d.text}</p>
          <p class="hint">${d.text.length}자 · 근거 기록 ${d.evidence.length}개</p>
          ${d.missing.length ? html`<ul class="alerts small">${d.missing.map((m) => html`<li>근거 부족: ${m}</li>`)}</ul>` : ''}
          ${d.evidence.length ? html`<details><summary>근거 기록 보기</summary><ul class="evidence">${d.evidence.map(evidenceItem)}</ul></details>` : ''}
        </div>`)}
    </section>

    <section class="card">
      <h2 class="subtitle">역량 태그 모아보기</h2>
      ${competencies.length ? competencies.map((x) => html`
        <details class="draft">
          <summary><strong>${x.c}</strong> <span class="muted small">성찰 ${x.refls.length}번</span></summary>
          <ul class="evidence">
            ${x.refls.map(({ r, logs: wl }) => html`<li>
              <strong>${r.kind === '최종' ? '최종 성찰' : weekLabel(r.week_of)}</strong>: ${firstLine(r.best)}
              ${wl.length ? html`<ul>${wl.map((l) => html`<li>${shortDate(l.log_date)} 일지(${l.activity_type}): ${firstLine(l.did)}</li>`)}</ul>` : ''}
            </li>`)}
          </ul>
        </details>`)
        : html`<p class="muted">성찰에서 ‘스스로 느낀 역량’을 고르면 여기에 근거 일지와 함께 모여요.</p>`}
    </section>

    <section class="card">
      <h2 class="subtitle">교과 연계</h2>
      ${plan?.subjects ? html`<p>계획서: ${plan.subjects}</p>` : ''}
      ${bySubject.size ? [...bySubject].map(([s, items]) => html`
        <details class="draft"><summary><strong>${s}</strong> <span class="muted small">${items.length}건</span></summary>
          <ul class="evidence">${items.map((t) => html`<li>${t}</li>`)}</ul></details>`)
        : html`<p class="muted">일지와 조사에서 ‘연계 교과’를 고르면 교과별로 모여요.</p>`}
    </section>

    <section class="card">
      <h2 class="subtitle">숫자로 보는 활동</h2>
      <p>활동 유형: ${chrono.length ? joinCounts(countBy(chrono, (l) => l.activity_type)) : '아직 없음'}</p>
      <p>읽은 자료: ${research.length ? joinCounts(countBy(research, (r) => r.source_type), '건') : '아직 없음'}</p>
      ${numberLines.length ? html`<h4>측정·숫자 기록</h4><ul class="evidence">${numberLines.map((n) => html`<li>${shortDate(n.day)} ${n.s}</li>`)}</ul>`
        : html`<p class="muted">일지의 ‘실험 결과·측정값’에 숫자를 쓰면 여기에 모여요.</p>`}
    </section>

    <section class="card">
      <h2 class="subtitle">표현 점검</h2>
      ${vague.length ? html`
        <p class="muted">“열심히”, “많이” 같은 말 대신 숫자나 구체적인 행동으로 바꿔 보세요.</p>
        <ul class="alerts">${vague.map((v) => html`<li>${isMine ? html`<a class="link" href="${v.href}">${v.label}</a>` : v.label}: ‘${v.words.join('’, ‘')}’</li>`)}</ul>`
        : html`<p class="muted">막연한 표현이 없어요. 좋아요!</p>`}
    </section>

    <section class="card">
      <div class="title-row">
        <h2 class="subtitle">활동 보고서 초안</h2>
        <button type="button" class="secondary small no-print" data-copy="report">복사</button>
      </div>
      <p class="draft-text" id="draft-report">${report || '기록이 더 쌓이면 동기 → 과정 → 결과 → 배운 점 → 후속 탐구 순서로 채워져요.'}</p>
      <p class="hint">${report.length}자 · 500자 안팎으로 맞췄어요. 복사해서 다듬어 쓰세요.</p>
      <p class="hint print-only">출력: ${formatDate(new Date().toISOString())} · 에코시티 기록장</p>
    </section>
  `);

  el.querySelector('#pf-who')?.addEventListener('change', (e) => ctx.go(`/portfolio?u=${encodeURIComponent(e.target.value)}`));
  el.querySelector('#pf-print').addEventListener('click', () => window.print());
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = el.querySelector(`#draft-${btn.dataset.copy}`).textContent.trim();
    toast(await copyText(text) ? '복사했어요.' : '복사하지 못했어요. 글을 길게 눌러 직접 복사해 주세요.');
  });
}

