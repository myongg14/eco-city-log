import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, LOGIN_EMAIL_DOMAIN } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export function normalizeLoginId(loginId) {
  return String(loginId || '').trim().toLowerCase();
}

export function loginEmail(loginId) {
  return `${normalizeLoginId(loginId)}@${LOGIN_EMAIL_DOMAIN}`;
}

// 데이터베이스 함수 호출. 실패하면 사용자에게 보여 줄 수 있는 문장을 담은 Error 를 던집니다.
export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

export function friendlyError(error) {
  const msg = error?.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return '인터넷 연결을 확인해 주세요. 잠시 뒤 다시 시도해 주세요.';
  }
  if (/should be different from the old password/i.test(msg)) {
    return '지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.';
  }
  if (/Password should be at least/i.test(msg)) {
    return '비밀번호는 8자 이상이어야 해요.';
  }
  if (/JWT|session/i.test(msg) && !/[가-힣]/.test(msg)) {
    return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  }
  return msg;
}

export async function fetchMyProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('user_id, login_id, role, team_id, display_name, role_desc, career_goal, must_change_password, profile_completed, last_login_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function fetchTeams() {
  const { data, error } = await sb.from('teams').select('id, name, topic, is_reserve, is_active').order('id');
  if (error) throw new Error(friendlyError(error));
  return data || [];
}
