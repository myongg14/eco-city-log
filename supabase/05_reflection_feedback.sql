-- =====================================================================
-- 에코시티 기록 사이트 · 4단계 (성찰, 선생님 피드백 댓글, 교과 연계 태그)
-- 01 ~ 04 를 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 여러 번 실행해도 이미 쓴 내용은 지워지지 않습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 표
-- ---------------------------------------------------------------------

-- 성찰: 매주 1회(주간) + 프로젝트 끝날 때 1회(최종)
create table if not exists public.reflections (
  id             bigint generated always as identity primary key,
  author_id      uuid not null references public.profiles(user_id) on delete cascade,
  team_id        int references public.teams(id),
  kind           text not null default '주간' check (kind in ('주간', '최종')),
  week_of        date,                          -- 주간 성찰: 그 주 월요일. 최종 성찰은 비워 둠
  best           text not null,                 -- 이번 주 가장 잘한 점
  hardship       text not null,                 -- 어려웠던 점과 극복
  learned        text not null,                 -- 새로 배운 것
  changed        text,                          -- 생각이 바뀐 점
  next_inquiry   text,                          -- 다음에 해 볼 탐구
  competencies   text[] not null default '{}',  -- 스스로 느낀 역량
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists reflections_week_uniq on public.reflections (author_id, week_of) where kind = '주간';
create unique index if not exists reflections_final_uniq on public.reflections (author_id) where kind = '최종';

-- 피드백 댓글: 관리자·선생님이 일지·성찰·조사에 남기고, 기록을 쓴 학생이 답할 수 있어요.
create table if not exists public.comments (
  id             bigint generated always as identity primary key,
  target_kind    text not null check (target_kind in ('log', 'reflection', 'research')),
  target_id      bigint not null,
  target_author  uuid not null references public.profiles(user_id) on delete cascade,
  author_id      uuid not null references public.profiles(user_id) on delete cascade,
  body           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists comments_target_idx on public.comments (target_kind, target_id);
create index if not exists comments_target_author_idx on public.comments (target_author, created_at desc);

-- 새 댓글 알림: 마지막으로 내 기록의 댓글을 확인한 시각
create table if not exists public.comment_seen (
  user_id  uuid primary key references public.profiles(user_id) on delete cascade,
  seen_at  timestamptz not null default now()
);

-- 교과 연계 태그 (일지, 조사)
alter table public.activity_logs  add column if not exists subjects text[] not null default '{}';
alter table public.research_notes add column if not exists subjects text[] not null default '{}';

alter table public.reflections  enable row level security;
alter table public.comments     enable row level security;
alter table public.comment_seen enable row level security;

revoke all on public.reflections, public.comments, public.comment_seen from anon, authenticated;
grant select on public.reflections, public.comments, public.comment_seen to authenticated;

-- 성찰은 쓴 학생과 관리자·선생님만 봐요.
drop policy if exists reflections_select on public.reflections;
create policy reflections_select on public.reflections
  for select to authenticated
  using (public.is_active_member() and (author_id = auth.uid() or public.is_staff()));

-- 댓글은 기록을 쓴 학생, 댓글 쓴 사람, 관리자·선생님만 봐요.
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (public.is_active_member() and (target_author = auth.uid() or author_id = auth.uid() or public.is_staff()));

drop policy if exists comment_seen_select on public.comment_seen;
create policy comment_seen_select on public.comment_seen
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 성찰 (p_id 가 null 이면 새로 쓰기, 있으면 고치기)
-- ---------------------------------------------------------------------

create or replace function public.save_reflection(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_team int := private.require_writer();
  v_id bigint;
  v_kind text := coalesce(private.clean_text(p_data->>'kind', '성찰 종류', false, 10), '주간');
  v_week date;
  v_comp text[] := private.clean_list(p_data->'competencies', '역량', 10);
begin
  if v_kind not in ('주간', '최종') then
    raise exception '성찰 종류는 주간 또는 최종으로 골라 주세요.';
  end if;
  if v_kind = '주간' then
    begin
      v_week := nullif(trim(coalesce(p_data->>'week_of', '')), '')::date;
    exception when others then
      raise exception '성찰할 주를 확인해 주세요.';
    end;
    if v_week is null then
      raise exception '성찰할 주를 골라 주세요.';
    end if;
    v_week := date_trunc('week', v_week)::date;   -- 그 주 월요일
    if v_week > (now() at time zone 'Asia/Seoul')::date then
      raise exception '아직 오지 않은 주는 성찰할 수 없어요.';
    end if;
  end if;
  if not v_comp <@ array['문제해결력', '협업능력', '탐구력', '창의성', '의사소통', '자기주도성', '리더십', '책임감', '정보활용', '공동체의식'] then
    raise exception '역량은 목록에서 골라 주세요.';
  end if;

  if p_id is null then
    if v_kind = '주간' and exists (select 1 from public.reflections where author_id = auth.uid() and kind = '주간' and week_of = v_week) then
      raise exception '그 주의 성찰은 이미 있어요. 내 기록에서 고쳐 주세요.';
    end if;
    if v_kind = '최종' and exists (select 1 from public.reflections where author_id = auth.uid() and kind = '최종') then
      raise exception '최종 성찰은 이미 있어요. 내 기록에서 고쳐 주세요.';
    end if;
    insert into public.reflections (author_id, team_id, kind, week_of, best, hardship, learned, changed, next_inquiry, competencies)
    values (
      auth.uid(), v_team, v_kind, v_week,
      private.clean_text(p_data->>'best', '가장 잘한 점', true, 500),
      private.clean_text(p_data->>'hardship', '어려웠던 점과 극복', true),
      private.clean_text(p_data->>'learned', '새로 배운 것', true),
      private.clean_text(p_data->>'changed', '생각이 바뀐 점', false),
      private.clean_text(p_data->>'next_inquiry', '다음에 해 볼 탐구', false, 500),
      v_comp
    ) returning id into v_id;
  else
    begin
      update public.reflections set
        kind         = v_kind,
        week_of      = v_week,
        best         = private.clean_text(p_data->>'best', '가장 잘한 점', true, 500),
        hardship     = private.clean_text(p_data->>'hardship', '어려웠던 점과 극복', true),
        learned      = private.clean_text(p_data->>'learned', '새로 배운 것', true),
        changed      = private.clean_text(p_data->>'changed', '생각이 바뀐 점', false),
        next_inquiry = private.clean_text(p_data->>'next_inquiry', '다음에 해 볼 탐구', false, 500),
        competencies = v_comp,
        updated_at   = now()
      where id = p_id and author_id = auth.uid()
      returning id into v_id;
    exception when unique_violation then
      raise exception '그 주(또는 최종) 성찰은 이미 있어요.';
    end;
    if v_id is null then
      raise exception '내가 쓴 성찰만 고칠 수 있어요.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_reflection(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_writer();
  delete from public.reflections where id = p_id and author_id = auth.uid();
  if not found then
    raise exception '내가 쓴 성찰만 지울 수 있어요.';
  end if;
  delete from public.comments where target_kind = 'reflection' and target_id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 교과 연계 태그: 내가 쓴 일지·조사에 붙여요.
-- ---------------------------------------------------------------------

create or replace function public.set_record_subjects(p_kind text, p_id bigint, p_subjects jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v text[] := private.clean_list(p_subjects, '연계 교과', 6);
begin
  perform private.require_writer();
  if not v <@ array['물리', '화학', '생명과학', '지구과학', '수학', '정보', '기술·가정', '통합사회', '국어', '영어', '미술'] then
    raise exception '연계 교과는 목록에서 골라 주세요.';
  end if;
  if p_kind = 'log' then
    update public.activity_logs set subjects = v where id = p_id and author_id = auth.uid();
  elsif p_kind = 'research' then
    update public.research_notes set subjects = v where id = p_id and author_id = auth.uid();
  else
    raise exception '기록 종류를 확인해 주세요.';
  end if;
  if not found then
    raise exception '내가 쓴 기록에만 교과를 붙일 수 있어요.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 피드백 댓글
-- ---------------------------------------------------------------------

create or replace function public.add_comment(p_kind text, p_id bigint, p_body text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_id bigint;
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if p_kind = 'log' then
    select author_id into v_owner from public.activity_logs where id = p_id;
  elsif p_kind = 'reflection' then
    select author_id into v_owner from public.reflections where id = p_id;
  elsif p_kind = 'research' then
    select author_id into v_owner from public.research_notes where id = p_id;
  else
    raise exception '기록 종류를 확인해 주세요.';
  end if;
  if v_owner is null then
    raise exception '그 기록을 찾을 수 없어요.';
  end if;
  if not public.is_staff() and v_owner <> auth.uid() then
    raise exception '피드백은 선생님·관리자와 기록을 쓴 학생만 남길 수 있어요.';
  end if;
  insert into public.comments (target_kind, target_id, target_author, author_id, body)
  values (p_kind, p_id, v_owner, auth.uid(), private.clean_text(p_body, '댓글', true, 1000))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_comment(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comments where id = p_id and author_id = auth.uid();
  if not found then
    raise exception '내가 쓴 댓글만 지울 수 있어요.';
  end if;
end;
$$;

-- 내 기록의 댓글을 확인했다고 표시해요. (새 댓글 알림 끄기)
create or replace function public.mark_comments_seen() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  insert into public.comment_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now();
end;
$$;

-- 일지·조사를 지우면 그 댓글도 함께 지워요.
create or replace function private.drop_record_comments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comments where target_kind = tg_argv[0] and target_id = old.id;
  return old;
end;
$$;
drop trigger if exists activity_logs_drop_comments on public.activity_logs;
create trigger activity_logs_drop_comments after delete on public.activity_logs
  for each row execute function private.drop_record_comments('log');
drop trigger if exists research_notes_drop_comments on public.research_notes;
create trigger research_notes_drop_comments after delete on public.research_notes
  for each row execute function private.drop_record_comments('research');

-- ---------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------

revoke execute on function private.drop_record_comments()                 from public, anon, authenticated;
revoke execute on function public.save_reflection(bigint, jsonb)            from public, anon;
revoke execute on function public.delete_reflection(bigint)                 from public, anon;
revoke execute on function public.set_record_subjects(text, bigint, jsonb)  from public, anon;
revoke execute on function public.add_comment(text, bigint, text)           from public, anon;
revoke execute on function public.delete_comment(bigint)                    from public, anon;
revoke execute on function public.mark_comments_seen()                      from public, anon;

grant execute on function public.save_reflection(bigint, jsonb)            to authenticated;
grant execute on function public.delete_reflection(bigint)                 to authenticated;
grant execute on function public.set_record_subjects(text, bigint, jsonb)  to authenticated;
grant execute on function public.add_comment(text, bigint, text)           to authenticated;
grant execute on function public.delete_comment(bigint)                    to authenticated;
grant execute on function public.mark_comments_seen()                      to authenticated;

-- 확인: 표 3개가 나오면 성공
select table_name as "만들어진 표"
from information_schema.tables
where table_schema = 'public' and table_name in ('reflections', 'comments', 'comment_seen')
order by table_name;
