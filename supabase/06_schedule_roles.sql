-- =====================================================================
-- 에코시티 기록 사이트 · 5-1단계 (통합 일정, 통합 테스트 체크리스트, 역할 분담과 변경 이력, 알림 확인 시각)
-- 01 ~ 05 를 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 여러 번 실행해도 이미 쓴 내용은 지워지지 않습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------

-- 통합 일정: 팀별 마감, 모형을 합치는 날, 발표 등 (관리자·선생님이 써요)
create table if not exists public.schedule_events (
  id          bigint generated always as identity primary key,
  title       text not null,
  detail      text,
  kind        text not null default '마감' check (kind in ('마감', '통합', '발표', '회의', '기타')),
  event_date  date not null,
  end_date    date,
  team_id     int references public.teams(id) on delete set null,   -- 비어 있으면 전체 일정
  created_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or end_date >= event_date)
);
create index if not exists schedule_events_date_idx on public.schedule_events (event_date);

-- 통합 테스트 체크리스트: 모형을 합쳤을 때 확인할 항목
create table if not exists public.integration_checks (
  id          bigint generated always as identity primary key,
  title       text not null,
  detail      text,
  team_id     int references public.teams(id) on delete set null,   -- 확인을 맡은 팀. 비어 있으면 전체
  sort_order  int not null default 0,
  status      text not null default '대기' check (status in ('대기', '통과', '실패')),
  note        text,                                                 -- 확인 결과 메모 (실패 원인 등)
  checked_by  uuid references public.profiles(user_id) on delete set null,
  checked_at  timestamptz,
  created_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 역할 분담 (관리자·선생님이 관리하고 모두 볼 수 있어요)
create table if not exists public.role_assignments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  area        text not null,                          -- 맡은 기능·분야
  duties      text[] not null default '{}',           -- 세부 담당 업무
  due_date    date,
  status      text not null default '진행 중' check (status in ('예정', '진행 중', '완료')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists role_assignments_user_idx on public.role_assignments (user_id);

-- 역할 변경 이력: 바뀐 날짜와 이유
create table if not exists public.role_history (
  id             bigint generated always as identity primary key,
  assignment_id  bigint references public.role_assignments(id) on delete set null,
  user_id        uuid not null references public.profiles(user_id) on delete cascade,
  change         text not null,     -- 무엇이 바뀌었는지 (자동)
  reason         text,
  changed_by     uuid references public.profiles(user_id) on delete set null,
  changed_at     timestamptz not null default now()
);
create index if not exists role_history_user_idx on public.role_history (user_id, changed_at desc);

-- 알림을 마지막으로 확인한 시각
create table if not exists public.notification_seen (
  user_id  uuid primary key references public.profiles(user_id) on delete cascade,
  seen_at  timestamptz not null default now()
);

alter table public.schedule_events    enable row level security;
alter table public.integration_checks enable row level security;
alter table public.role_assignments   enable row level security;
alter table public.role_history       enable row level security;
alter table public.notification_seen  enable row level security;

revoke all on public.schedule_events, public.integration_checks, public.role_assignments, public.role_history, public.notification_seen from anon, authenticated;
grant select on public.schedule_events, public.integration_checks, public.role_assignments, public.role_history, public.notification_seen to authenticated;

drop policy if exists schedule_select on public.schedule_events;
create policy schedule_select on public.schedule_events
  for select to authenticated using (public.is_active_member());

drop policy if exists checks_select on public.integration_checks;
create policy checks_select on public.integration_checks
  for select to authenticated using (public.is_active_member());

drop policy if exists roles_select on public.role_assignments;
create policy roles_select on public.role_assignments
  for select to authenticated using (public.can_see_author(user_id));

drop policy if exists role_history_select on public.role_history;
create policy role_history_select on public.role_history
  for select to authenticated using (public.can_see_author(user_id));

drop policy if exists notification_seen_select on public.notification_seen;
create policy notification_seen_select on public.notification_seen
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 날짜 읽기 도우미
-- ---------------------------------------------------------------------

create or replace function private.clean_date(p_value text, p_label text, p_required boolean) returns date
language plpgsql immutable set search_path = '' as $$
declare
  v date;
begin
  begin
    v := nullif(trim(coalesce(p_value, '')), '')::date;
  exception when others then
    raise exception '%을(를) 확인해 주세요.', p_label;
  end;
  if v is null and p_required then
    raise exception '%을(를) 입력해 주세요.', p_label;
  end if;
  return v;
end;
$$;

create or replace function private.clean_team(p_value text) returns int
language plpgsql stable set search_path = '' as $$
declare
  v int;
begin
  begin
    v := nullif(trim(coalesce(p_value, '')), '')::int;
  exception when others then
    raise exception '팀을 확인해 주세요.';
  end;
  if v is not null and not exists (select 1 from public.teams where id = v) then
    raise exception '그런 팀이 없어요.';
  end if;
  return v;
end;
$$;

revoke execute on function private.clean_date(text, text, boolean) from public, anon, authenticated;
revoke execute on function private.clean_team(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 통합 일정 (관리자·선생님)
-- ---------------------------------------------------------------------

create or replace function public.save_event(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_kind text := coalesce(nullif(trim(p_data->>'kind'), ''), '마감');
  v_start date;
  v_end date;
begin
  perform private.require_staff();
  if v_kind not in ('마감', '통합', '발표', '회의', '기타') then
    raise exception '일정 종류를 목록에서 골라 주세요.';
  end if;
  v_start := private.clean_date(p_data->>'event_date', '날짜', true);
  v_end   := private.clean_date(p_data->>'end_date', '끝나는 날', false);
  if v_end is not null and v_end < v_start then
    raise exception '끝나는 날은 시작하는 날보다 뒤여야 해요.';
  end if;
  if v_end = v_start then
    v_end := null;
  end if;

  if p_id is null then
    insert into public.schedule_events (title, detail, kind, event_date, end_date, team_id, created_by)
    values (
      private.clean_text(p_data->>'title', '일정 이름', true, 200),
      private.clean_text(p_data->>'detail', '자세한 내용', false, 2000),
      v_kind, v_start, v_end, private.clean_team(p_data->>'team_id'), auth.uid()
    ) returning id into v_id;
  else
    update public.schedule_events set
      title      = private.clean_text(p_data->>'title', '일정 이름', true, 200),
      detail     = private.clean_text(p_data->>'detail', '자세한 내용', false, 2000),
      kind       = v_kind,
      event_date = v_start,
      end_date   = v_end,
      team_id    = private.clean_team(p_data->>'team_id'),
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '그 일정을 찾을 수 없어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_event(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  delete from public.schedule_events where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 통합 테스트 체크리스트
-- 항목은 관리자·선생님이 만들고, 결과는 맡은 팀 학생(전체 항목은 모든 학생)도 기록해요.
-- ---------------------------------------------------------------------

create or replace function public.save_check(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_order int;
begin
  perform private.require_staff();
  begin
    v_order := coalesce(nullif(trim(coalesce(p_data->>'sort_order', '')), '')::int, 0);
  exception when others then
    raise exception '순서는 숫자로 입력해 주세요.';
  end;
  if p_id is null then
    insert into public.integration_checks (title, detail, team_id, sort_order, created_by)
    values (
      private.clean_text(p_data->>'title', '확인할 항목', true, 200),
      private.clean_text(p_data->>'detail', '확인 방법', false, 2000),
      private.clean_team(p_data->>'team_id'), v_order, auth.uid()
    ) returning id into v_id;
  else
    update public.integration_checks set
      title      = private.clean_text(p_data->>'title', '확인할 항목', true, 200),
      detail     = private.clean_text(p_data->>'detail', '확인 방법', false, 2000),
      team_id    = private.clean_team(p_data->>'team_id'),
      sort_order = v_order,
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception '그 항목을 찾을 수 없어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_check(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  delete from public.integration_checks where id = p_id;
end;
$$;

create or replace function public.set_check_result(p_id bigint, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_team int;
  v_note text := private.clean_text(p_note, '메모', false, 1000);
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if p_status not in ('대기', '통과', '실패') then
    raise exception '결과는 대기, 통과, 실패 중에서 골라 주세요.';
  end if;
  if p_status = '실패' and v_note is null then
    raise exception '실패했다면 원인이나 상황을 메모에 적어 주세요.';
  end if;
  select team_id into v_team from public.integration_checks where id = p_id;
  if not found then
    raise exception '그 항목을 찾을 수 없어요.';
  end if;
  if not public.is_staff() and v_team is not null
     and v_team is distinct from (select team_id from public.profiles where user_id = auth.uid()) then
    raise exception '우리 팀이 맡은 항목만 결과를 기록할 수 있어요.';
  end if;
  update public.integration_checks set
    status     = p_status,
    note       = v_note,
    checked_by = case when p_status = '대기' then null else auth.uid() end,
    checked_at = case when p_status = '대기' then null else now() end,
    updated_at = now()
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 역할 분담 (관리자·선생님). 고칠 때마다 변경 이력을 남겨요.
-- ---------------------------------------------------------------------

create or replace function public.save_role(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_user uuid;
  v_area text;
  v_duties text[];
  v_due date;
  v_status text := coalesce(nullif(trim(p_data->>'status'), ''), '진행 중');
  v_reason text;
  v_old public.role_assignments;
  v_change text[] := '{}';
begin
  perform private.require_staff();
  v_area   := private.clean_text(p_data->>'area', '맡은 기능·분야', true, 200);
  v_duties := private.clean_list(p_data->'duties', '세부 담당 업무', 20);
  v_due    := private.clean_date(p_data->>'due_date', '기간', false);
  v_reason := private.clean_text(p_data->>'reason', '바꾼 이유', false, 500);
  if v_status not in ('예정', '진행 중', '완료') then
    raise exception '상태는 예정, 진행 중, 완료 중에서 골라 주세요.';
  end if;
  begin
    v_user := nullif(trim(coalesce(p_data->>'user_id', '')), '')::uuid;
  exception when others then
    raise exception '팀원을 다시 골라 주세요.';
  end;
  if v_user is null or not exists (select 1 from public.profiles where user_id = v_user and role = 'student') then
    raise exception '팀원은 학생 계정에서 골라 주세요.';
  end if;
  if coalesce(array_length(v_duties, 1), 0) = 0 then
    raise exception '세부 담당 업무를 한 줄 이상 써 주세요.';
  end if;

  if p_id is null then
    insert into public.role_assignments (user_id, area, duties, due_date, status)
    values (v_user, v_area, v_duties, v_due, v_status)
    returning id into v_id;
    insert into public.role_history (assignment_id, user_id, change, reason, changed_by)
    values (v_id, v_user, format('새로 맡음: %s', v_area), v_reason, auth.uid());
  else
    select * into v_old from public.role_assignments where id = p_id;
    if not found then
      raise exception '그 역할을 찾을 수 없어요.';
    end if;
    if v_old.user_id <> v_user then
      v_change := v_change || format('담당자 변경: %s → %s',
        (select coalesce(display_name, login_id) from public.profiles where user_id = v_old.user_id),
        (select coalesce(display_name, login_id) from public.profiles where user_id = v_user));
    end if;
    if v_old.area <> v_area then
      v_change := v_change || format('분야: %s → %s', v_old.area, v_area);
    end if;
    if v_old.duties <> v_duties then
      v_change := v_change || format('세부 업무: %s', array_to_string(v_duties, ', '));
    end if;
    if v_old.due_date is distinct from v_due then
      v_change := v_change || format('기간: %s', coalesce(to_char(v_due, 'MM/DD'), '없음'));
    end if;
    if v_old.status <> v_status then
      v_change := v_change || format('상태: %s → %s', v_old.status, v_status);
    end if;
    -- 담당자나 분야, 세부 업무가 바뀌면 이유를 꼭 남겨요. (상태·기간만 바뀌면 생략 가능)
    if (v_old.user_id <> v_user or v_old.area <> v_area or v_old.duties <> v_duties) and v_reason is null then
      raise exception '역할이 바뀐 이유를 적어 주세요.';
    end if;
    update public.role_assignments set
      user_id = v_user, area = v_area, duties = v_duties, due_date = v_due, status = v_status, updated_at = now()
    where id = p_id
    returning id into v_id;
    if coalesce(array_length(v_change, 1), 0) > 0 then
      insert into public.role_history (assignment_id, user_id, change, reason, changed_by)
      values (v_id, v_user, array_to_string(v_change, ' · '), v_reason, auth.uid());
      if v_old.user_id <> v_user then
        insert into public.role_history (assignment_id, user_id, change, reason, changed_by)
        values (v_id, v_old.user_id, format('역할 넘김: %s', v_old.area), v_reason, auth.uid());
      end if;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_role(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.role_assignments;
begin
  perform private.require_staff();
  select * into v_old from public.role_assignments where id = p_id;
  if not found then
    raise exception '그 역할을 찾을 수 없어요.';
  end if;
  insert into public.role_history (assignment_id, user_id, change, reason, changed_by)
  values (null, v_old.user_id, format('역할 끝냄: %s', v_old.area), private.clean_text(p_reason, '이유', false, 500), auth.uid());
  delete from public.role_assignments where id = p_id;
end;
$$;

-- 알림을 확인했다고 표시해요.
create or replace function public.mark_notifications_seen() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  insert into public.notification_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------

revoke execute on function public.save_event(bigint, jsonb)               from public, anon;
revoke execute on function public.delete_event(bigint)                    from public, anon;
revoke execute on function public.save_check(bigint, jsonb)               from public, anon;
revoke execute on function public.delete_check(bigint)                    from public, anon;
revoke execute on function public.set_check_result(bigint, text, text)    from public, anon;
revoke execute on function public.save_role(bigint, jsonb)                from public, anon;
revoke execute on function public.delete_role(bigint, text)               from public, anon;
revoke execute on function public.mark_notifications_seen()               from public, anon;

grant execute on function public.save_event(bigint, jsonb)               to authenticated;
grant execute on function public.delete_event(bigint)                    to authenticated;
grant execute on function public.save_check(bigint, jsonb)               to authenticated;
grant execute on function public.delete_check(bigint)                    to authenticated;
grant execute on function public.set_check_result(bigint, text, text)    to authenticated;
grant execute on function public.save_role(bigint, jsonb)                to authenticated;
grant execute on function public.delete_role(bigint, text)               to authenticated;
grant execute on function public.mark_notifications_seen()               to authenticated;

-- 확인: 표 5개가 나오면 성공
select table_name as "만들어진 표"
from information_schema.tables
where table_schema = 'public' and table_name in ('schedule_events', 'integration_checks', 'role_assignments', 'role_history', 'notification_seen')
order by table_name;
