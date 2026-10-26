-- =====================================================================
-- 에코시티 기록 사이트 · 1단계 기초 설정
-- Supabase 화면 > SQL Editor > New query 에 이 파일 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 이미 있는 계정·팀은 그대로 둡니다.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 아이디(team1-1)를 로그인용 내부 이메일로 바꿀 때 붙이는 주소. js/config.js 의 LOGIN_EMAIL_DOMAIN 과 같아야 합니다.
create or replace function private.login_email(p_login_id text) returns text
language sql immutable set search_path = '' as $$
  select lower(trim(p_login_id)) || '@ecocity.invalid'
$$;

-- ---------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------

create table if not exists public.teams (
  id          int primary key,
  name        text not null,
  topic       text,
  is_reserve  boolean not null default false,
  is_active   boolean not null default true
);

create table if not exists public.profiles (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  login_id              text not null unique,
  role                  text not null default 'student' check (role in ('student', 'admin', 'teacher')),
  team_id               int references public.teams(id),
  display_name          text,
  role_desc             text,
  career_goal           text,
  must_change_password  boolean not null default true,
  profile_completed     boolean not null default false,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now()
);

-- 로그인 시도 기록(5번 틀리면 10분 잠금). private 스키마라 사이트에서 직접 읽을 수 없습니다.
create table if not exists private.login_attempts (
  id            bigint generated always as identity primary key,
  login_id      text not null,
  success       boolean not null,
  attempted_at  timestamptz not null default now()
);
create index if not exists login_attempts_login_id_idx on private.login_attempts (login_id, attempted_at desc);

alter table public.teams    enable row level security;
alter table public.profiles enable row level security;

-- 읽기만 허용하고, 쓰기는 아래 함수로만 합니다(역할을 몰래 바꾸는 일을 막기 위해).
revoke all on public.teams, public.profiles from anon, authenticated;
grant select on public.teams, public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 권한 확인용 함수
-- ---------------------------------------------------------------------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.user_id = auth.uid()
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin', 'teacher'), false)
$$;

-- 로그인한 사람이 쓸 수 있는 상태인지(예비 팀이 꺼져 있으면 false)
create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    where p.user_id = auth.uid()
      and (p.team_id is null or t.is_active)
  )
$$;

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select to authenticated
  using (public.is_active_member() and (is_active or public.is_staff()));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.is_active_member()
    and (
      public.is_staff()
      or user_id = auth.uid()
      or team_id is null
      or exists (select 1 from public.teams t where t.id = profiles.team_id and t.is_active)
    )
  );

-- ---------------------------------------------------------------------
-- 계정 만들기(내부용)
-- ---------------------------------------------------------------------

create or replace function private.create_account(p_login_id text, p_role text, p_team_id int)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_login text := lower(trim(p_login_id));
  v_email text := private.login_email(p_login_id);
  v_id    uuid;
begin
  select user_id into v_id from public.profiles where login_id = v_login;
  if v_id is not null then
    return v_id;
  end if;

  v_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt('12345678', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('login_id', v_login), now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.profiles (user_id, login_id, role, team_id)
  values (v_id, v_login, p_role, p_team_id);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 로그인 흐름 (사이트에서 부르는 함수)
-- ---------------------------------------------------------------------

-- 로그인 전에 잠금·예비 팀 여부 확인: 'ok' | 'locked' | 'inactive'
create or replace function public.login_precheck(p_login_id text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_login text := lower(trim(p_login_id));
  v_last_success timestamptz;
  v_fails int;
  v_team_active boolean;
begin
  select max(attempted_at) into v_last_success
  from private.login_attempts where login_id = v_login and success;

  select count(*) into v_fails
  from private.login_attempts
  where login_id = v_login
    and not success
    and attempted_at > now() - interval '10 minutes'
    and attempted_at > coalesce(v_last_success, '-infinity'::timestamptz);

  if v_fails >= 5 then
    return 'locked';
  end if;

  select coalesce(t.is_active, true) into v_team_active
  from public.profiles p left join public.teams t on t.id = p.team_id
  where p.login_id = v_login;

  if v_team_active = false then
    return 'inactive';
  end if;

  return 'ok';
end;
$$;

-- 비밀번호가 틀렸을 때 기록. 남은 시도 횟수를 돌려줍니다.
create or replace function public.record_login_failure(p_login_id text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_login text := lower(trim(p_login_id));
  v_last_success timestamptz;
  v_fails int;
begin
  if not exists (select 1 from public.profiles where login_id = v_login) then
    return 5;
  end if;

  insert into private.login_attempts (login_id, success) values (v_login, false);

  select max(attempted_at) into v_last_success
  from private.login_attempts where login_id = v_login and success;

  select count(*) into v_fails
  from private.login_attempts
  where login_id = v_login
    and not success
    and attempted_at > now() - interval '10 minutes'
    and attempted_at > coalesce(v_last_success, '-infinity'::timestamptz);

  return greatest(5 - v_fails, 0);
end;
$$;

-- 로그인 성공 직후: 기록을 남기고 내 상태를 돌려줍니다.
create or replace function public.record_login_success() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
  v_prev timestamptz;
  v_team_active boolean;
begin
  select * into v_profile from public.profiles where user_id = auth.uid();
  if v_profile.user_id is null then
    raise exception '계정 정보를 찾을 수 없어요.';
  end if;

  select coalesce(t.is_active, true) into v_team_active
  from public.teams t where t.id = v_profile.team_id;
  v_team_active := coalesce(v_team_active, true);

  v_prev := v_profile.last_login_at;

  if v_team_active then
    insert into private.login_attempts (login_id, success) values (v_profile.login_id, true);
    update public.profiles set last_login_at = now() where user_id = auth.uid();
  end if;

  return jsonb_build_object(
    'login_id', v_profile.login_id,
    'role', v_profile.role,
    'team_id', v_profile.team_id,
    'team_active', v_team_active,
    'must_change_password', v_profile.must_change_password,
    'profile_completed', v_profile.profile_completed,
    'previous_login_at', v_prev
  );
end;
$$;

-- 비밀번호를 바꾼 뒤 부릅니다. 아직 12345678 이면 거절합니다.
create or replace function public.mark_password_changed() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
begin
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null then
    raise exception '로그인이 필요해요.';
  end if;
  if extensions.crypt('12345678', v_hash) = v_hash then
    raise exception '초기 비밀번호(12345678)는 다시 쓸 수 없어요.';
  end if;
  update public.profiles set must_change_password = false where user_id = auth.uid();
end;
$$;

-- 처음 로그인할 때 이름·맡은 역할·희망 진로 입력
create or replace function public.complete_my_profile(p_display_name text, p_role_desc text, p_career_goal text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요.';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception '이름을 입력해 주세요.';
  end if;
  update public.profiles
  set display_name = trim(p_display_name),
      role_desc = nullif(trim(p_role_desc), ''),
      career_goal = nullif(trim(p_career_goal), ''),
      profile_completed = true
  where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- 관리 기능 (관리자 admin · 선생님 teacher)
-- ---------------------------------------------------------------------

create or replace function private.require_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception '관리자나 선생님만 할 수 있어요.';
  end if;
end;
$$;

create or replace function public.admin_list_accounts()
returns table (
  login_id text, role text, team_id int, team_name text, team_active boolean,
  display_name text, must_change_password boolean, profile_completed boolean,
  last_login_at timestamptz, locked boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query
    select p.login_id, p.role, p.team_id, t.name, coalesce(t.is_active, true),
           p.display_name, p.must_change_password, p.profile_completed,
           p.last_login_at, public.login_precheck(p.login_id) = 'locked'
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    order by p.team_id nulls first, p.login_id;
end;
$$;

create or replace function public.admin_reset_password(p_login_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
begin
  perform private.require_staff();
  select * into v_target from public.profiles where login_id = lower(trim(p_login_id));
  if v_target.user_id is null then
    raise exception '그런 아이디가 없어요.';
  end if;
  if v_target.role = 'teacher' and public.my_role() <> 'teacher' then
    raise exception '선생님 계정은 선생님만 초기화할 수 있어요.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt('12345678', extensions.gen_salt('bf')), updated_at = now()
  where id = v_target.user_id;

  update public.profiles set must_change_password = true where user_id = v_target.user_id;
  delete from private.login_attempts where login_id = v_target.login_id and not success;
end;
$$;

create or replace function public.admin_unlock(p_login_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  delete from private.login_attempts where login_id = lower(trim(p_login_id)) and not success;
end;
$$;

create or replace function public.admin_create_account(p_login_id text, p_team_id int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_login text := lower(trim(p_login_id));
begin
  perform private.require_staff();
  if v_login !~ '^[a-z0-9][a-z0-9-]{2,29}$' then
    raise exception '아이디는 영어 소문자, 숫자, -(하이픈)로 3~30자여야 해요.';
  end if;
  if exists (select 1 from public.profiles where login_id = v_login) then
    raise exception '이미 있는 아이디예요.';
  end if;
  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception '그런 팀이 없어요.';
  end if;
  perform private.create_account(v_login, 'student', p_team_id);
end;
$$;

create or replace function public.admin_delete_account(p_login_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
begin
  perform private.require_staff();
  select * into v_target from public.profiles where login_id = lower(trim(p_login_id));
  if v_target.user_id is null then
    raise exception '그런 아이디가 없어요.';
  end if;
  if v_target.role <> 'student' then
    raise exception '관리자·선생님 계정은 지울 수 없어요.';
  end if;
  delete from auth.users where id = v_target.user_id;
  delete from private.login_attempts where login_id = v_target.login_id;
end;
$$;

create or replace function public.admin_update_team(p_team_id int, p_name text, p_topic text, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if coalesce(trim(p_name), '') = '' then
    raise exception '팀 이름을 입력해 주세요.';
  end if;
  update public.teams
  set name = trim(p_name), topic = nullif(trim(p_topic), ''), is_active = p_active
  where id = p_team_id;
  if not found then
    raise exception '그런 팀이 없어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 함수 실행 권한: 필요한 것만 열어 둡니다.
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function public.login_precheck(text)        to anon, authenticated;
grant execute on function public.record_login_failure(text)  to anon, authenticated;

grant execute on function public.my_role()                   to authenticated;
grant execute on function public.is_staff()                  to authenticated;
grant execute on function public.is_active_member()          to authenticated;
grant execute on function public.record_login_success()      to authenticated;
grant execute on function public.mark_password_changed()     to authenticated;
grant execute on function public.complete_my_profile(text, text, text) to authenticated;
grant execute on function public.admin_list_accounts()       to authenticated;
grant execute on function public.admin_reset_password(text)  to authenticated;
grant execute on function public.admin_unlock(text)          to authenticated;
grant execute on function public.admin_create_account(text, int) to authenticated;
grant execute on function public.admin_delete_account(text)  to authenticated;
grant execute on function public.admin_update_team(int, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 팀과 계정 33개
-- ---------------------------------------------------------------------

insert into public.teams (id, name, topic, is_reserve, is_active) values
  (1, '제로 에너지 하우스', null, false, true),
  (2, '배터리(ESS, 스마트그리드 등)', null, false, true),
  (3, '쓰레기장(바이오 에너지)', null, false, true),
  (4, '친환경 에너지 발전 설비', null, false, true),
  (5, 'LiDAR 및 딥러닝 기반 자율주행', null, false, true),
  (6, '전력 시스템 안전 관리와 효율성 증진', null, false, true),
  (7, '도시 계획', null, false, true),
  (8, '예비 팀 A', '주제 미정', true, false),
  (9, '예비 팀 B', '주제 미정', true, false)
on conflict (id) do nothing;

do $$
declare
  v_counts int[] := array[4, 2, 1, 1, 4, 3, 6, 5, 5];  -- team1 ~ team9 인원
  v_team int;
  v_n int;
begin
  for v_team in 1 .. array_length(v_counts, 1) loop
    for v_n in 1 .. v_counts[v_team] loop
      perform private.create_account(format('team%s-%s', v_team, v_n), 'student', v_team);
    end loop;
  end loop;

  perform private.create_account('admin', 'admin', null);
  perform private.create_account('teacher', 'teacher', null);
end;
$$;

-- 확인: 33 이 나오면 성공
select count(*) as "만들어진 계정 수" from public.profiles;
