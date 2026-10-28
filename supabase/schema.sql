create extension if not exists pgcrypto;

create or replace function public.valid_survey_answers(candidate smallint[])
returns boolean
language sql
immutable
as $$
  select cardinality(candidate) = 30
    and not exists (
      select 1 from unnest(candidate) as valueset(answer)
      where valueset.answer < -2 or valueset.answer > 2
    );
$$;

create or replace function public.valid_question_order(candidate smallint[])
returns boolean
language sql
immutable
as $$
  select cardinality(candidate) = 30
    and (select count(distinct valueset.position) = 30 from unnest(candidate) as valueset(position))
    and not exists (
      select 1 from unnest(candidate) as valueset(position)
      where valueset.position < 0 or valueset.position > 29
    );
$$;

create table if not exists public.responses (
  id uuid primary key,
  name text not null check (char_length(trim(name)) between 1 and 40),
  answers smallint[] not null check (public.valid_survey_answers(answers)),
  question_order smallint[] not null check (public.valid_question_order(question_order)),
  completed_at timestamptz not null default now()
);

create table if not exists public.response_recovery (
  response_id uuid primary key references public.responses(id) on delete cascade,
  recovery_hash text unique not null check (char_length(recovery_hash) = 64)
);

create table if not exists public.group_names (
  signature text primary key,
  name text not null check (char_length(trim(name)) between 1 and 32),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.responses enable row level security;
alter table public.response_recovery enable row level security;
alter table public.group_names enable row level security;
alter table public.survey_admins enable row level security;

grant select on public.responses to anon, authenticated;
grant select, insert, update, delete on public.group_names to anon, authenticated;
revoke all on public.response_recovery from anon, authenticated;
revoke all on public.survey_admins from anon, authenticated;

drop policy if exists "Anyone can read submitted responses" on public.responses;
create policy "Anyone can read submitted responses"
  on public.responses for select to anon, authenticated using (true);

drop policy if exists "Anyone can read group labels" on public.group_names;
create policy "Anyone can read group labels"
  on public.group_names for select to anon, authenticated using (true);

create or replace function public.is_survey_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.survey_admins where user_id = (select auth.uid())
  );
$$;

grant execute on function public.is_survey_admin() to authenticated;
revoke execute on function public.is_survey_admin() from anon, public;

drop policy if exists "Admins can create group labels" on public.group_names;
create policy "Admins can create group labels"
  on public.group_names for insert to authenticated
  with check ((select public.is_survey_admin()));

drop policy if exists "Admins can rename group labels" on public.group_names;
create policy "Admins can rename group labels"
  on public.group_names for update to authenticated
  using ((select public.is_survey_admin()))
  with check ((select public.is_survey_admin()));

drop policy if exists "Admins can remove group labels" on public.group_names;
create policy "Admins can remove group labels"
  on public.group_names for delete to authenticated
  using ((select public.is_survey_admin()));

create or replace function public.submit_survey_response(
  p_id uuid,
  p_name text,
  p_answers smallint[],
  p_question_order smallint[],
  p_recovery_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.responses (id, name, answers, question_order)
  values (p_id, trim(p_name), p_answers, p_question_order);

  if p_recovery_hash is not null then
    insert into public.response_recovery (response_id, recovery_hash)
    values (p_id, p_recovery_hash);
  end if;

  return p_id;
end;
$$;

grant execute on function public.submit_survey_response(uuid, text, smallint[], smallint[], text) to anon, authenticated;
revoke execute on function public.submit_survey_response(uuid, text, smallint[], smallint[], text) from public;

create or replace function public.restore_survey_response(p_recovery_hash text)
returns table (id uuid, name text, answers smallint[], question_order smallint[], completed_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select response.id, response.name, response.answers, response.question_order, response.completed_at
  from public.responses as response
  join public.response_recovery as recovery on recovery.response_id = response.id
  where recovery.recovery_hash = p_recovery_hash
  limit 1;
$$;

grant execute on function public.restore_survey_response(text) to anon, authenticated;
revoke execute on function public.restore_survey_response(text) from public;