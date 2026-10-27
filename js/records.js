// 기록(계획서, 이론 조사, 활동 일지) 읽기 도우미와 공통 상수
import { sb, friendlyError } from './api.js';

export const SOURCE_TYPES = ['논문', '책', '공공기관 자료', '기사', '영상', '웹문서'];
export const ACTIVITY_TYPES = ['조사', '설계', '제작', '실험·테스트', '회의', '발표'];
export const AREAS = ['자율', '동아리', '진로'];

async function run(query) {
  const { data, error } = await query;
  if (error) throw new Error(friendlyError(error));
  return data || [];
}

// 볼 수 있는 모든 계정. user_id → 계정 Map 으로 돌려줍니다.
export async function fetchPeople() {
  const rows = await run(sb.from('profiles').select('user_id, login_id, display_name, role, team_id').order('login_id'));
  return new Map(rows.map((p) => [p.user_id, p]));
}

export function personName(people, userId) {
  const p = people.get(userId);
  if (!p) return '알 수 없음';
  return p.display_name ? `${p.display_name}(${p.login_id})` : p.login_id;
}

export async function fetchPlan(userId) {
  const rows = await run(sb.from('plans').select('*').eq('user_id', userId));
  return rows[0] || null;
}

export async function fetchResearch({ authorId, id, limit } = {}) {
  let q = sb.from('research_notes').select('*');
  if (authorId) q = q.eq('author_id', authorId);
  if (id) q = q.eq('id', id);
  q = q.order('created_at', { ascending: false });
  if (limit) q = q.limit(limit);
  return run(q);
}

export async function fetchLogs({ authorId, id, ids, limit } = {}) {
  let q = sb.from('activity_logs').select('*');
  if (authorId) q = q.eq('author_id', authorId);
  if (id) q = q.eq('id', id);
  if (ids) {
    if (!ids.length) return [];
    q = q.in('id', ids);
  }
  q = q.order('log_date', { ascending: false });
  if (limit) q = q.limit(limit);
  return run(q);
}

// log_id → [user_id] Map
export async function fetchParticipants(logIds) {
  if (!logIds.length) return new Map();
  const rows = await run(sb.from('log_participants').select('log_id, user_id').in('log_id', logIds));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.log_id)) map.set(r.log_id, []);
    map.get(r.log_id).push(r.user_id);
  }
  return map;
}

// 내가 '같이 한 팀원'으로 들어간 다른 사람의 일지
export async function fetchJoinedLogs(userId) {
  const rows = await run(sb.from('log_participants').select('log_id').eq('user_id', userId));
  return fetchLogs({ ids: rows.map((r) => r.log_id) });
}

// "열심히", "많이" 같은 막연한 표현 찾기
const VAGUE = ['열심히', '많이', '최선을', '노력했', '여러 가지', '등등', '잘 했', '잘했'];
export function findVague(text) {
  return VAGUE.filter((w) => String(text || '').includes(w));
}

export function splitLines(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// 학생들이 어디서 열어도 한국 시간으로 보여 줘요.
export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });
}

export function shortDate(value) {
  return value ? new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';
}

// 한국 시간 기준 'YYYY-MM-DD'
export function kstDay(value = Date.now()) {
  return new Date(new Date(value).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function todayKst() {
  return kstDay();
}

// ---------------------------------------------------------------------
// 3단계: 공지, 할 일, 물품 신청, 일지 사진
// ---------------------------------------------------------------------

export const TASK_STATUSES = ['예정', '진행', '완료'];
export const PURCHASE_STATUSES = ['신청', '승인', '반려', '구매 완료', '수령'];
// 예산에서 '쓴 돈'으로 보는 상태 (선생님이 승인한 뒤부터)
export const SPENT_STATUSES = ['승인', '구매 완료', '수령'];

export async function fetchNotices({ limit } = {}) {
  let q = sb.from('notices').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false });
  if (limit) q = q.limit(limit);
  return run(q);
}

export async function fetchTasks({ teamId, assigneeId } = {}) {
  let q = sb.from('tasks').select('*');
  if (teamId) q = q.eq('team_id', teamId);
  if (assigneeId) q = q.eq('assignee_id', assigneeId);
  return run(q.order('due_date', { ascending: true, nullsFirst: false }).order('id'));
}

export async function fetchPurchases({ id, teamId } = {}) {
  let q = sb.from('purchase_requests').select('*');
  if (id) q = q.eq('id', id);
  if (teamId) q = q.eq('team_id', teamId);
  return run(q.order('created_at', { ascending: false }));
}

export async function fetchBudget() {
  const rows = await run(sb.from('app_settings').select('key, value').eq('key', 'total_budget'));
  return Number(rows[0]?.value ?? 1600000);
}

export function budgetSummary(total, purchases) {
  const sum = (list) => list.reduce((s, p) => s + Number(p.total_price || 0), 0);
  const spent = sum(purchases.filter((p) => SPENT_STATUSES.includes(p.status)));
  const pending = sum(purchases.filter((p) => p.status === '신청'));
  return { total, spent, pending, left: total - spent, afterPending: total - spent - pending };
}

// log_id → [사진 행] Map
export async function fetchPhotos({ logIds } = {}) {
  let q = sb.from('log_photos').select('*');
  if (logIds) {
    if (!logIds.length) return new Map();
    q = q.in('log_id', logIds);
  }
  const rows = await run(q.order('created_at'));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.log_id)) map.set(r.log_id, []);
    map.get(r.log_id).push(r);
  }
  return map;
}

export function won(n) {
  return `${Number(n || 0).toLocaleString('ko-KR')}원`;
}

// ---------------------------------------------------------------------
// 4단계: 성찰, 피드백 댓글, 교과 연계
// ---------------------------------------------------------------------

export const COMPETENCIES = ['문제해결력', '협업능력', '탐구력', '창의성', '의사소통', '자기주도성', '리더십', '책임감', '정보활용', '공동체의식'];
export const SUBJECTS = ['물리', '화학', '생명과학', '지구과학', '수학', '정보', '기술·가정', '통합사회', '국어', '영어', '미술'];

// 그 날이 들어 있는 주의 월요일 'YYYY-MM-DD' (한국 시간)
export function weekMonday(day = kstDay()) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekLabel(monday) {
  if (!monday) return '최종 성찰';
  const [, m, d] = monday.split('-').map(Number);
  const end = addDays(monday, 6).split('-').map(Number);
  return `${m}월 ${d}일 ~ ${end[1]}월 ${end[2]}일 주`;
}

export async function fetchReflections({ authorId, id } = {}) {
  let q = sb.from('reflections').select('*');
  if (authorId) q = q.eq('author_id', authorId);
  if (id) q = q.eq('id', id);
  return run(q.order('created_at', { ascending: false }));
}

// "kind:id" → [댓글] Map. targets: [{kind, ids}]
export async function fetchComments(targets) {
  const map = new Map();
  for (const { kind, ids } of targets) {
    if (!ids.length) continue;
    const rows = await run(sb.from('comments').select('*').eq('target_kind', kind).in('target_id', ids).order('created_at'));
    for (const c of rows) {
      const k = `${c.target_kind}:${c.target_id}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
  }
  return map;
}

// 내 기록에 다른 사람이 남긴, 아직 확인하지 않은 댓글
export async function fetchUnreadComments(userId) {
  const [rows, seen] = await Promise.all([
    run(sb.from('comments').select('*').eq('target_author', userId).order('created_at', { ascending: false })),
    run(sb.from('comment_seen').select('seen_at').eq('user_id', userId)),
  ]);
  const since = seen[0]?.seen_at ? new Date(seen[0].seen_at) : new Date(0);
  return rows.filter((c) => c.author_id !== userId && new Date(c.created_at) > since);
}

// ---------------------------------------------------------------------
// 5단계: 통합 일정, 통합 테스트, 역할 분담, 알림
// ---------------------------------------------------------------------

export const EVENT_KINDS = ['마감', '통합', '발표', '회의', '기타'];
export const CHECK_STATUSES = ['대기', '통과', '실패'];
export const ROLE_STATUSES = ['예정', '진행 중', '완료'];

export async function fetchEvents() {
  return run(sb.from('schedule_events').select('*').order('event_date'));
}

export async function fetchChecks() {
  return run(sb.from('integration_checks').select('*').order('sort_order').order('id'));
}

export async function fetchRoles() {
  return run(sb.from('role_assignments').select('*').order('id'));
}

export async function fetchRoleHistory() {
  return run(sb.from('role_history').select('*').order('changed_at', { ascending: false }));
}

// 사이트 안 알림. 마지막으로 알림을 확인한 뒤에 생긴 것은 new 로 표시해요.
export async function fetchAlerts(me) {
  const isStudent = me.role === 'student';
  const [seenRows, tasks, purchases, events, checks, comments, peer, requests, replies] = await Promise.all([
    run(sb.from('notification_seen').select('seen_at').eq('user_id', me.user_id)),
    isStudent ? fetchTasks({ assigneeId: me.user_id }) : [],
    fetchPurchases(),
    fetchEvents(),
    fetchChecks(),
    isStudent ? run(sb.from('comments').select('*').eq('target_author', me.user_id).order('created_at', { ascending: false })) : [],
    isStudent ? run(sb.from('peer_feedback').select('*').eq('to_id', me.user_id)) : [],
    run(sb.from('team_requests').select('*')),
    run(sb.from('request_replies').select('*')),
  ]);
  const since = seenRows[0]?.seen_at ? new Date(seenRows[0].seen_at) : new Date(0);
  const isNew = (t) => !!t && new Date(t) > since;
  const today = kstDay();
  const soon = addDays(today, 3);
  const out = [];
  const push = (a) => out.push({ ...a, isNew: isNew(a.when) });

  for (const c of comments) {
    if (c.author_id === me.user_id) continue;
    push({ icon: '💬', kind: '피드백', text: c.body, when: c.created_at, href: '#/records' });
  }
  for (const f of peer) {
    push({ icon: f.kind === '칭찬' ? '👏' : '💡', kind: `친구의 ${f.kind}`, text: f.body, when: f.created_at, href: '#/records' });
  }
  for (const r of requests) {
    if (r.status !== '열림') continue;
    if (isStudent && r.to_team === me.team_id) {
      push({ icon: '📮', kind: '우리 팀이 받은 요청', text: r.title, when: r.created_at, href: '#/requests?f=to' });
    }
  }
  for (const a of replies) {
    const r = requests.find((x) => x.id === a.request_id);
    if (!r || a.author_id === me.user_id || r.author_id !== me.user_id) continue;
    push({ icon: '📮', kind: '내 요청에 답변', text: `${r.title} · ${a.body}`, when: a.created_at, href: '#/requests?f=from' });
  }
  for (const t of tasks) {
    if (t.status === '완료') continue;
    push({ icon: '📋', kind: '내게 배정된 할 일', text: t.title, when: t.created_at, href: '#/tasks' });
    if (t.due_date && t.due_date <= addDays(today, 2)) {
      out.push({ icon: '⏰', kind: t.due_date < today ? '마감 지남' : '마감 임박', text: `${t.title} (${shortDate(t.due_date)})`,
        when: null, href: '#/tasks', urgent: true });
    }
  }
  for (const p of purchases) {
    if (isStudent && p.requester_id === me.user_id && ['승인', '반려'].includes(p.status) && p.decided_at) {
      push({ icon: p.status === '승인' ? '✅' : '↩️', kind: `물품 ${p.status}`,
        text: p.status === '반려' ? `${p.item_name} · 사유: ${p.reject_reason || '-'}` : p.item_name, when: p.decided_at, href: '#/supplies?t=mine' });
    }
    if (me.role === 'teacher' && p.status === '신청') {
      push({ icon: '🛒', kind: '승인 대기', text: `${p.item_name} · ${won(p.total_price)}`, when: p.created_at, href: '#/supplies?t=wait' });
    }
    if (me.role === 'admin' && p.status === '승인') {
      push({ icon: '🛒', kind: '구매할 물품', text: `${p.item_name} · ${won(p.total_price)}`, when: p.decided_at, href: '#/supplies?t=buy' });
    }
  }
  for (const e of events) {
    if (isStudent && e.team_id && e.team_id !== me.team_id) continue;
    const end = e.end_date || e.event_date;
    if (end >= today && e.event_date <= soon) {
      out.push({ icon: '📅', kind: e.event_date <= today ? '오늘 일정' : '다가오는 일정', text: `${e.title} (${shortDate(e.event_date)})`,
        when: null, href: `#/schedule?m=${e.event_date.slice(0, 7)}`, urgent: e.event_date <= today });
    }
  }
  for (const c of checks) {
    if (c.status !== '실패' || (isStudent && c.team_id && c.team_id !== me.team_id)) continue;
    out.push({ icon: '🧪', kind: '통합 테스트 실패', text: `${c.title}${c.note ? ` · ${c.note}` : ''}`, when: null, href: '#/schedule?t=test', urgent: true });
  }
  out.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (b.when || '').localeCompare(a.when || ''));
  return { list: out, newCount: out.filter((a) => a.isNew).length };
}

// ---------------------------------------------------------------------
// 5-2단계: 기능 구현 현황, 실험·측정, 팀원 상호 피드백, 팀 간 요청
// ---------------------------------------------------------------------

export const FEATURE_STAGES = ['설계', '부품 확보', '제작', '작동 확인'];

// 단계를 진행률(%)로: 설계 25 → 작동 확인 100
export function stagePercent(stage) {
  return (FEATURE_STAGES.indexOf(stage) + 1) * 25;
}

export async function fetchFeatures() {
  return run(sb.from('features').select('*').order('team_id').order('sort_order').order('id'));
}

export async function fetchMeasurements({ authorId, id } = {}) {
  let q = sb.from('measurements').select('*');
  if (authorId) q = q.eq('author_id', authorId);
  if (id) q = q.eq('id', id);
  return run(q.order('measured_on', { ascending: false }).order('id', { ascending: false }));
}

export async function fetchPeerFeedback({ toId } = {}) {
  let q = sb.from('peer_feedback').select('*');
  if (toId) q = q.eq('to_id', toId);
  return run(q.order('created_at', { ascending: false }));
}

export async function fetchRequests() {
  return run(sb.from('team_requests').select('*').order('created_at', { ascending: false }));
}

// request_id → [답변] Map
export async function fetchReplies() {
  const rows = await run(sb.from('request_replies').select('*').order('created_at'));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.request_id)) map.set(r.request_id, []);
    map.get(r.request_id).push(r);
  }
  return map;
}

export async function fetchLinks() {
  return run(sb.from('team_links').select('*').order('id'));
}

// 외부 공개 페이지 설정 { enabled, intro } (관리자·선생님 화면에서 씀)
export async function fetchShowcaseSettings() {
  const rows = await run(sb.from('app_settings').select('key, value').eq('key', 'showcase'));
  return { enabled: false, intro: '', ...(rows[0]?.value || {}) };
}

// 공개하기로 고른 항목: { measurement: Set<id>, photo: Set<id> }
export async function fetchShowcaseItems() {
  const rows = await run(sb.from('showcase_items').select('kind, ref_id'));
  const picked = { measurement: new Set(), photo: new Set() };
  for (const r of rows) picked[r.kind]?.add(Number(r.ref_id));
  return picked;
}
