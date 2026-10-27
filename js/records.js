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
