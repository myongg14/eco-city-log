-- =====================================================================
-- 에코시티 기록 사이트 · 2단계 기록 (개인 계획서, 이론 조사, 활동 일지)
-- 01_foundation.sql 을 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 여러 번 실행해도 이미 쓴 기록은 지워지지 않습니다.
-- 01 을 다시 실행했다면 함수 실행 권한이 초기화되니 이 파일도 다시 실행하세요.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------

-- 개인 계획서: 학생 1명당 1개
create table if not exists public.plans (
  user_id      uuid primary key references public.profiles(user_id) on delete cascade,
  motivation   text not null,
  role_focus   text not null,
  question     text not null,
  goals        text[] not null default '{}',
  theories     text[] not null default '{}',
  subjects     text,
  weekly       jsonb not null default '[]',   -- [{"week": "1주차", "plan": "조사"}]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 이론 조사: 자료 1건당 1개
create table if not exists public.research_notes (
  id                bigint generated always as identity primary key,
  author_id         uuid not null references public.profiles(user_id) on delete cascade,
  team_id           int references public.teams(id),
  title             text not null,
  source_type       text not null check (source_type in ('논문', '책', '공공기관 자료', '기사', '영상', '웹문서')),
  source_author     text,
  source_publisher  text,
  source_year       int,
  source_url        text,
  summary           text not null,
  application       text not null,
  new_question      text,
  reliability       int check (reliability between 1 and 5),
  areas             text[] not null default '{}',   -- 생기부 영역: 자율 / 동아리 / 진로
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists research_notes_author_idx on public.research_notes (author_id, created_at desc);

-- 활동 일지: 활동한 날마다
create table if not exists public.activity_logs (
  id             bigint generated always as identity primary key,
  author_id      uuid not null references public.profiles(user_id) on delete cascade,
  team_id        int references public.teams(id),
  log_date       date not null,
  minutes        int check (minutes between 1 and 1440),
  activity_type  text not null check (activity_type in ('조사', '설계', '제작', '실험·테스트', '회의', '발표')),
  did            text not null,
  problem        text,
  results        text,
  next_steps     text[] not null default '{}',
  areas          text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists activity_logs_author_idx on public.activity_logs (author_id, log_date desc);

-- 일지를 같이 한 팀원
create table if not exists public.log_participants (
  log_id   bigint not null references public.activity_logs(id) on delete cascade,
  user_id  uuid not null references public.profiles(user_id) on delete cascade,
  primary key (log_id, user_id)
);

alter table public.plans            enable row level security;
alter table public.research_notes   enable row level security;
alter table public.activity_logs    enable row level security;
alter table public.log_participants enable row level security;

-- 읽기만 허용하고, 쓰기는 아래 함수로만 합니다.
revoke all on public.plans, public.research_notes, public.activity_logs, public.log_participants from anon, authenticated;
grant select on public.plans, public.research_notes, public.activity_logs, public.log_participants to authenticated;

-- ---------------------------------------------------------------------
-- 읽기 규칙: 로그인한 사람은 모든 팀의 기록을 읽을 수 있어요.
-- 꺼진 예비 팀 학생의 기록은 관리자·선생님만 봅니다.
-- ---------------------------------------------------------------------

create or replace function public.can_see_author(p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_member() and (
    public.is_staff()
    or p_author = auth.uid()
    or exists (
      select 1 from public.profiles p
      left join public.teams t on t.id = p.team_id
      where p.user_id = p_author and (p.team_id is null or t.is_active)
    )
  )
$$;
revoke execute on function public.can_see_author(uuid) from public, anon;
grant execute on function public.can_see_author(uuid) to authenticated;

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated using (public.can_see_author(user_id));

drop policy if exists research_select on public.research_notes;
create policy research_select on public.research_notes
  for select to authenticated using (public.can_see_author(author_id));

drop policy if exists logs_select on public.activity_logs;
create policy logs_select on public.activity_logs
  for select to authenticated using (public.can_see_author(author_id));

drop policy if exists log_participants_select on public.log_participants;
create policy log_participants_select on public.log_participants
  for select to authenticated
  using (exists (select 1 from public.activity_logs l where l.id = log_id and public.can_see_author(l.author_id)));

-- ---------------------------------------------------------------------
-- 입력값 검사 도우미
-- ---------------------------------------------------------------------

-- 기록을 쓸 수 있는 학생인지 확인하고, 그 학생의 팀 번호를 돌려줍니다.
create or replace function private.require_writer() returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
  v_team int;
begin
  select p.role, p.team_id into v_role, v_team from public.profiles p where p.user_id = auth.uid();
  if v_role is null or not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if v_role <> 'student' then
    raise exception '기록은 학생 계정으로만 쓸 수 있어요.';
  end if;
  return v_team;
end;
$$;

-- 앞뒤 공백을 지우고, 비었으면 null. 너무 길면 거절합니다.
create or replace function private.clean_text(p_value text, p_label text, p_required boolean, p_max int default 5000)
returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v is null and p_required then
    raise exception '%을(를) 입력해 주세요.', p_label;
  end if;
  if v is not null and char_length(v) > p_max then
    raise exception '%은(는) %자까지 쓸 수 있어요.', p_label, p_max;
  end if;
  return v;
end;
$$;

-- JSON 배열에서 빈 줄을 뺀 글자 목록을 만듭니다.
create or replace function private.clean_list(p_value jsonb, p_label text, p_max_items int default 30)
returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_item text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    return v_out;
  end if;
  for v_item in select jsonb_array_elements_text(p_value) loop
    v_item := private.clean_text(v_item, p_label, false, 500);
    if v_item is not null then
      v_out := v_out || v_item;
    end if;
  end loop;
  if coalesce(array_length(v_out, 1), 0) > p_max_items then
    raise exception '%은(는) %개까지 쓸 수 있어요.', p_label, p_max_items;
  end if;
  return v_out;
end;
$$;

create or replace function private.clean_areas(p_value jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  v text[] := private.clean_list(p_value, '생기부 영역', 3);
begin
  if not v <@ array['자율', '동아리', '진로'] then
    raise exception '생기부 영역은 자율, 동아리, 진로 중에서 골라 주세요.';
  end if;
  return v;
end;
$$;

create or replace function private.clean_url(p_value text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v text := private.clean_text(p_value, '링크', false, 1000);
begin
  if v is not null and v !~* '^https?://' then
    raise exception '링크는 http:// 또는 https:// 로 시작해야 해요.';
  end if;
  return v;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 개인 계획서
-- ---------------------------------------------------------------------

create or replace function public.save_plan(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_weekly jsonb := '[]';
  v_row jsonb;
  v_week text;
  v_plan text;
begin
  perform private.require_writer();

  if jsonb_typeof(p_data->'weekly') = 'array' then
    for v_row in select jsonb_array_elements(p_data->'weekly') loop
      v_week := private.clean_text(v_row->>'week', '주차', false, 50);
      v_plan := private.clean_text(v_row->>'plan', '주차별 계획', false, 500);
      if v_week is not null or v_plan is not null then
        v_weekly := v_weekly || jsonb_build_array(jsonb_build_object('week', coalesce(v_week, ''), 'plan', coalesce(v_plan, '')));
      end if;
    end loop;
  end if;
  if jsonb_array_length(v_weekly) > 20 then
    raise exception '주차별 계획은 20줄까지 쓸 수 있어요.';
  end if;

  insert into public.plans as p (user_id, motivation, role_focus, question, goals, theories, subjects, weekly)
  values (
    auth.uid(),
    private.clean_text(p_data->>'motivation', '동기', true),
    private.clean_text(p_data->>'role_focus', '맡을 기능·역할', true, 300),
    private.clean_text(p_data->>'question', '탐구 질문', true, 300),
    private.clean_list(p_data->'goals', '목표'),
    private.clean_list(p_data->'theories', '조사할 이론'),
    private.clean_text(p_data->>'subjects', '연계 교과·진로', false, 300),
    v_weekly
  )
  on conflict (user_id) do update set
    motivation = excluded.motivation,
    role_focus = excluded.role_focus,
    question   = excluded.question,
    goals      = excluded.goals,
    theories   = excluded.theories,
    subjects   = excluded.subjects,
    weekly     = excluded.weekly,
    updated_at = now();

  if coalesce(array_length((select goals from public.plans where user_id = auth.uid()), 1), 0) = 0 then
    raise exception '목표를 한 줄 이상 입력해 주세요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 이론 조사 (p_id 가 null 이면 새로 쓰기, 있으면 고치기)
-- ---------------------------------------------------------------------

create or replace function public.save_research(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_team int := private.require_writer();
  v_id bigint;
  v_year int;
  v_rel int;
  v_type text := private.clean_text(p_data->>'source_type', '출처 종류', true, 20);
begin
  if v_type not in ('논문', '책', '공공기관 자료', '기사', '영상', '웹문서') then
    raise exception '출처 종류를 목록에서 골라 주세요.';
  end if;

  begin
    v_year := nullif(trim(coalesce(p_data->>'source_year', '')), '')::int;
    v_rel  := nullif(trim(coalesce(p_data->>'reliability', '')), '')::int;
  exception when others then
    raise exception '연도와 신뢰도는 숫자로 입력해 주세요.';
  end;
  if v_year is not null and (v_year < 1800 or v_year > 2100) then
    raise exception '발행 연도를 확인해 주세요.';
  end if;
  if v_rel is not null and (v_rel < 1 or v_rel > 5) then
    raise exception '신뢰도는 1~5점으로 골라 주세요.';
  end if;
  if private.clean_text(p_data->>'source_author', '저자', false, 200) is null
     and private.clean_text(p_data->>'source_publisher', '발행처', false, 200) is null
     and private.clean_url(p_data->>'source_url') is null then
    raise exception '출처 정보(저자, 발행처, 링크 중 하나 이상)를 입력해 주세요.';
  end if;

  if p_id is null then
    insert into public.research_notes (
      author_id, team_id, title, source_type, source_author, source_publisher, source_year, source_url,
      summary, application, new_question, reliability, areas
    ) values (
      auth.uid(), v_team,
      private.clean_text(p_data->>'title', '제목', true, 200),
      v_type,
      private.clean_text(p_data->>'source_author', '저자', false, 200),
      private.clean_text(p_data->>'source_publisher', '발행처', false, 200),
      v_year,
      private.clean_url(p_data->>'source_url'),
      private.clean_text(p_data->>'summary', '핵심 내용 요약', true),
      private.clean_text(p_data->>'application', '모형에 적용할 점', true, 1000),
      private.clean_text(p_data->>'new_question', '새로 생긴 궁금증', false, 1000),
      v_rel,
      private.clean_areas(p_data->'areas')
    ) returning id into v_id;
  else
    update public.research_notes set
      title            = private.clean_text(p_data->>'title', '제목', true, 200),
      source_type      = v_type,
      source_author    = private.clean_text(p_data->>'source_author', '저자', false, 200),
      source_publisher = private.clean_text(p_data->>'source_publisher', '발행처', false, 200),
      source_year      = v_year,
      source_url       = private.clean_url(p_data->>'source_url'),
      summary          = private.clean_text(p_data->>'summary', '핵심 내용 요약', true),
      application      = private.clean_text(p_data->>'application', '모형에 적용할 점', true, 1000),
      new_question     = private.clean_text(p_data->>'new_question', '새로 생긴 궁금증', false, 1000),
      reliability      = v_rel,
      areas            = private.clean_areas(p_data->'areas'),
      updated_at       = now()
    where id = p_id and author_id = auth.uid()
    returning id into v_id;
    if v_id is null then
      raise exception '내가 쓴 조사 기록만 고칠 수 있어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_research(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_writer();
  delete from public.research_notes where id = p_id and author_id = auth.uid();
  if not found then
    raise exception '내가 쓴 조사 기록만 지울 수 있어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 활동 일지 (p_id 가 null 이면 새로 쓰기, 있으면 고치기)
-- p_data.participants: 같이 한 팀원의 user_id 배열
-- ---------------------------------------------------------------------

create or replace function public.save_log(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_team int := private.require_writer();
  v_id bigint;
  v_date date;
  v_minutes int;
  v_type text := private.clean_text(p_data->>'activity_type', '활동 유형', true, 20);
  v_people uuid[] := '{}';
begin
  if v_type not in ('조사', '설계', '제작', '실험·테스트', '회의', '발표') then
    raise exception '활동 유형을 목록에서 골라 주세요.';
  end if;

  begin
    v_date    := nullif(trim(coalesce(p_data->>'log_date', '')), '')::date;
    v_minutes := nullif(trim(coalesce(p_data->>'minutes', '')), '')::int;
  exception when others then
    raise exception '날짜와 활동 시간(분)을 확인해 주세요.';
  end;
  if v_date is null then
    raise exception '날짜를 입력해 주세요.';
  end if;
  if v_date > (now() at time zone 'Asia/Seoul')::date + 1 then
    raise exception '미래 날짜로는 일지를 쓸 수 없어요.';
  end if;
  if v_minutes is null then
    raise exception '활동 시간(분)을 입력해 주세요.';
  end if;
  if v_minutes < 1 or v_minutes > 1440 then
    raise exception '활동 시간은 1~1440분으로 입력해 주세요.';
  end if;

  if jsonb_typeof(p_data->'participants') = 'array' then
    begin
      select coalesce(array_agg(distinct x::uuid), '{}') into v_people
      from jsonb_array_elements_text(p_data->'participants') x;
    exception when others then
      raise exception '같이 한 팀원 목록을 확인해 주세요.';
    end;
  end if;
  v_people := array_remove(v_people, auth.uid());
  if exists (
    select 1 from unnest(v_people) u
    where not exists (
      select 1 from public.profiles p join public.teams t on t.id = p.team_id
      where p.user_id = u and p.role = 'student' and t.is_active
    )
  ) then
    raise exception '같이 한 팀원은 학생 계정에서만 고를 수 있어요.';
  end if;

  if p_id is null then
    insert into public.activity_logs (author_id, team_id, log_date, minutes, activity_type, did, problem, results, next_steps, areas)
    values (
      auth.uid(), v_team, v_date, v_minutes, v_type,
      private.clean_text(p_data->>'did', '한 일', true),
      private.clean_text(p_data->>'problem', '문제와 해결', false),
      private.clean_text(p_data->>'results', '실험 결과·측정값', false, 3000),
      private.clean_list(p_data->'next_steps', '다음 할 일'),
      private.clean_areas(p_data->'areas')
    ) returning id into v_id;
  else
    update public.activity_logs set
      log_date      = v_date,
      minutes       = v_minutes,
      activity_type = v_type,
      did           = private.clean_text(p_data->>'did', '한 일', true),
      problem       = private.clean_text(p_data->>'problem', '문제와 해결', false),
      results       = private.clean_text(p_data->>'results', '실험 결과·측정값', false, 3000),
      next_steps    = private.clean_list(p_data->'next_steps', '다음 할 일'),
      areas         = private.clean_areas(p_data->'areas'),
      updated_at    = now()
    where id = p_id and author_id = auth.uid()
    returning id into v_id;
    if v_id is null then
      raise exception '내가 쓴 일지만 고칠 수 있어요.';
    end if;
    delete from public.log_participants where log_id = v_id;
  end if;

  insert into public.log_participants (log_id, user_id)
  select v_id, u from unnest(v_people) u;

  return v_id;
end;
$$;

create or replace function public.delete_log(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_writer();
  delete from public.activity_logs where id = p_id and author_id = auth.uid();
  if not found then
    raise exception '내가 쓴 일지만 지울 수 있어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------

revoke execute on function public.save_plan(jsonb)              from public, anon;
revoke execute on function public.save_research(bigint, jsonb)  from public, anon;
revoke execute on function public.delete_research(bigint)       from public, anon;
revoke execute on function public.save_log(bigint, jsonb)       from public, anon;
revoke execute on function public.delete_log(bigint)            from public, anon;

grant execute on function public.save_plan(jsonb)              to authenticated;
grant execute on function public.save_research(bigint, jsonb)  to authenticated;
grant execute on function public.delete_research(bigint)       to authenticated;
grant execute on function public.save_log(bigint, jsonb)       to authenticated;
grant execute on function public.delete_log(bigint)            to authenticated;

-- 확인: 표 4개가 나오면 성공
select table_name as "만들어진 표"
from information_schema.tables
where table_schema = 'public' and table_name in ('plans', 'research_notes', 'activity_logs', 'log_participants')
order by table_name;
