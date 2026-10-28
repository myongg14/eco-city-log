-- =====================================================================
-- 에코시티 기록 사이트 · 쓰다 만 글 임시 저장 (다른 기기에서 이어 쓰기)
-- 01 ~ 08 을 먼저 실행한 뒤, 이 파일 전체를 SQL Editor 에 붙여 넣고 Run.
-- 여러 번 실행해도 이미 쓴 내용은 지워지지 않습니다.
-- 임시 저장은 쓴 사람 본인만 볼 수 있어요(관리자·선생님도 못 봐요). 저장 버튼을 누르면 지워져요.
-- =====================================================================

create table if not exists public.drafts (
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  key         text not null,        -- 화면 주소 + 글쓰기 칸 이름 (예: /log/new:log-form)
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.drafts enable row level security;
revoke all on public.drafts from anon, authenticated;
grant select on public.drafts to authenticated;

drop policy if exists drafts_select on public.drafts;
create policy drafts_select on public.drafts
  for select to authenticated using (user_id = auth.uid() and public.is_active_member());

create or replace function public.save_draft(p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요해요.';
  end if;
  if p_key is null or length(p_key) > 200 or jsonb_typeof(p_data) <> 'array' then
    raise exception '임시 저장할 수 없는 내용이에요.';
  end if;
  if length(p_data::text) > 60000 then
    raise exception '글이 너무 길어서 임시 저장하지 못했어요.';
  end if;
  insert into public.drafts (user_id, key, data) values (auth.uid(), p_key, p_data)
  on conflict (user_id, key) do update set data = excluded.data, updated_at = now();
  -- 한 사람당 임시 저장은 최근 50개, 30일까지만 남겨요.
  delete from public.drafts d
  where d.user_id = auth.uid()
    and (d.updated_at < now() - interval '30 days'
         or d.key not in (select x.key from public.drafts x where x.user_id = auth.uid() order by x.updated_at desc limit 50));
end;
$$;

create or replace function public.delete_draft(p_key text) returns void
language sql security definer set search_path = '' as $$
  delete from public.drafts where user_id = auth.uid() and key = p_key;
$$;

revoke execute on function public.save_draft(text, jsonb) from public, anon;
revoke execute on function public.delete_draft(text)      from public, anon;
grant execute on function public.save_draft(text, jsonb)  to authenticated;
grant execute on function public.delete_draft(text)       to authenticated;

-- 확인: drafts 가 나오면 성공
select table_name as "만들어진 표"
from information_schema.tables
where table_schema = 'public' and table_name = 'drafts';
