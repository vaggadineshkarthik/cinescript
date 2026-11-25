create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'talent' check (role in ('recruiter', 'talent')),
  created_at timestamptz not null default now()
);

create table if not exists public.recruiter_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  company_name text not null,
  company_logo text,
  bio text
);

create table if not exists public.talent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  full_name text not null,
  profile_photo text,
  bio text,
  primary_role text not null,
  skills jsonb not null default '[]'::jsonb,
  experience_level text not null default 'Entry',
  years_of_experience integer check (years_of_experience is null or years_of_experience >= 0),
  languages jsonb not null default '[]'::jsonb,
  location text,
  portfolio_link text,
  demo_reel_link text,
  resume_url text,
  social_links jsonb not null default '{}'::jsonb
);

create table if not exists public.job_vacancies (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references public.profiles(id) on delete cascade,
  job_title text not null,
  category text not null,
  project_name text not null,
  project_type text not null,
  location text not null,
  workplace_type text not null check (workplace_type in ('Remote', 'Hybrid', 'Onsite')),
  experience_required text not null default '',
  salary_range text not null default '',
  description text not null,
  required_skills jsonb not null default '[]'::jsonb,
  deadline date not null,
  contact_details text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_vacancies(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  cover_letter text not null,
  portfolio_link text,
  resume_link text,
  status text not null default 'pending'
    check (status in ('pending', 'shortlisted', 'rejected', 'hired')),
  applied_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);

create table if not exists public.saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.job_vacancies(id) on delete cascade,
  unique (user_id, job_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 5000),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  read_status boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists job_vacancies_status_created_idx
  on public.job_vacancies(status, created_at desc);
create index if not exists job_vacancies_recruiter_created_idx
  on public.job_vacancies(recruiter_id, created_at desc);
create index if not exists job_applications_applicant_idx
  on public.job_applications(applicant_id, applied_at desc);
create index if not exists job_applications_job_idx
  on public.job_applications(job_id, applied_at desc);
create index if not exists messages_participants_created_idx
  on public.messages(sender_id, receiver_id, created_at);
create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

grant select, insert on public.profiles to authenticated;
grant update (email) on public.profiles to authenticated;
grant select, insert, update, delete on public.recruiter_profiles to authenticated;
grant select, insert, update, delete on public.talent_profiles to authenticated;
grant select, insert, update, delete on public.job_vacancies to authenticated;
grant select, insert, update, delete on public.job_applications to authenticated;
grant select, insert, update, delete on public.saved_jobs to authenticated;
grant select, insert on public.messages to authenticated;
grant select, update on public.notifications to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    coalesce(new.email, ''),
    case when new.raw_user_meta_data ->> 'role' = 'recruiter'
      then 'recruiter' else 'talent' end
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_recruitment on auth.users;
create trigger on_auth_user_created_recruitment
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.notify_recruitment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_title text;
  recruiter uuid;
begin
  if tg_table_name = 'job_applications' then
    select j.job_title, j.recruiter_id into job_title, recruiter
    from public.job_vacancies j where j.id = new.job_id;

    if tg_op = 'INSERT' then
      insert into public.notifications (user_id, title, message)
      values (recruiter, 'New application', 'A candidate applied for ' || job_title || '.');
    elsif new.status is distinct from old.status then
      insert into public.notifications (user_id, title, message)
      values (
        new.applicant_id,
        'Application update',
        'Your application for ' || job_title || ' is now ' || new.status || '.'
      );
    end if;
  elsif tg_table_name = 'messages' then
    insert into public.notifications (user_id, title, message)
    values (new.receiver_id, 'New message', 'You received a new recruitment message.');
  end if;
  return new;
end;
$$;

drop trigger if exists on_recruitment_application_event on public.job_applications;
create trigger on_recruitment_application_event
  after insert or update of status on public.job_applications
  for each row execute function public.notify_recruitment_event();

drop trigger if exists on_recruitment_message_event on public.messages;
create trigger on_recruitment_message_event
  after insert on public.messages
  for each row execute function public.notify_recruitment_event();

alter table public.profiles enable row level security;
alter table public.recruiter_profiles enable row level security;
alter table public.talent_profiles enable row level security;
alter table public.job_vacancies enable row level security;
alter table public.job_applications enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (email) on public.profiles to authenticated;

drop policy if exists "recruiter_profiles_read_authenticated" on public.recruiter_profiles;
create policy "recruiter_profiles_read_authenticated" on public.recruiter_profiles
  for select to authenticated using (true);
drop policy if exists "recruiter_profiles_manage_own" on public.recruiter_profiles;
create policy "recruiter_profiles_manage_own" on public.recruiter_profiles
  for all to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'recruiter'
    )
  );

drop policy if exists "talent_profiles_read_authenticated" on public.talent_profiles;
create policy "talent_profiles_read_authenticated" on public.talent_profiles
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'recruiter'
    )
  );
drop policy if exists "talent_profiles_manage_own" on public.talent_profiles;
create policy "talent_profiles_manage_own" on public.talent_profiles
  for all to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'talent'
    )
  );

drop policy if exists "vacancies_read_open_or_own" on public.job_vacancies;
create policy "vacancies_read_open_or_own" on public.job_vacancies
  for select to authenticated using (
    status = 'open' or recruiter_id = (select auth.uid())
  );
drop policy if exists "vacancies_insert_recruiter" on public.job_vacancies;
create policy "vacancies_insert_recruiter" on public.job_vacancies
  for insert to authenticated with check (
    recruiter_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'recruiter'
    )
  );
drop policy if exists "vacancies_update_own" on public.job_vacancies;
create policy "vacancies_update_own" on public.job_vacancies
  for update to authenticated using (recruiter_id = (select auth.uid()))
  with check (recruiter_id = (select auth.uid()));
drop policy if exists "vacancies_delete_own" on public.job_vacancies;
create policy "vacancies_delete_own" on public.job_vacancies
  for delete to authenticated using (recruiter_id = (select auth.uid()));

drop policy if exists "applications_read_applicant_or_recruiter" on public.job_applications;
create policy "applications_read_applicant_or_recruiter" on public.job_applications
  for select to authenticated using (
    applicant_id = (select auth.uid())
    or exists (
      select 1 from public.job_vacancies j
      where j.id = job_id and j.recruiter_id = (select auth.uid())
    )
  );
drop policy if exists "applications_insert_talent" on public.job_applications;
create policy "applications_insert_talent" on public.job_applications
  for insert to authenticated with check (
    applicant_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'talent'
    )
    and exists (
      select 1 from public.job_vacancies j
      where j.id = job_id and j.status = 'open' and j.deadline >= current_date
    )
    and status = 'pending'
  );
drop policy if exists "applications_status_update_recruiter" on public.job_applications;
create policy "applications_status_update_recruiter" on public.job_applications
  for update to authenticated using (
    exists (
      select 1 from public.job_vacancies j
      where j.id = job_id and j.recruiter_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.job_vacancies j
      where j.id = job_id and j.recruiter_id = (select auth.uid())
    )
  );

drop policy if exists "saved_jobs_manage_own" on public.saved_jobs;
create policy "saved_jobs_manage_own" on public.saved_jobs
  for all to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.job_vacancies j
      where j.id = job_id and j.status = 'open' and j.deadline >= current_date
    )
  );

drop policy if exists "messages_read_participants" on public.messages;
create policy "messages_read_participants" on public.messages
  for select to authenticated using (
    sender_id = (select auth.uid()) or receiver_id = (select auth.uid())
  );
drop policy if exists "messages_send_as_self" on public.messages;
create policy "messages_send_as_self" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and receiver_id <> (select auth.uid())
  );

drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke update on public.job_applications from authenticated;
grant update (status) on public.job_applications to authenticated;
revoke update on public.notifications from authenticated;
grant update (read_status) on public.notifications to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('profile-photos', 'profile-photos', true, 10485760),
  ('resumes', 'resumes', false, 20971520),
  ('company-logos', 'company-logos', true, 10485760),
  ('demo-reels', 'demo-reels', false, 104857600)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists "recruitment_public_assets_read" on storage.objects;
create policy "recruitment_public_assets_read" on storage.objects
  for select to authenticated using (bucket_id in ('profile-photos', 'company-logos', 'demo-reels'));
drop policy if exists "recruitment_resume_access" on storage.objects;
create policy "recruitment_resume_access" on storage.objects
  for select to authenticated using (
    bucket_id = 'resumes'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.job_applications a
        join public.job_vacancies j on j.id = a.job_id
        where a.applicant_id::text = (storage.foldername(name))[1]
          and j.recruiter_id = (select auth.uid())
      )
    )
  );
drop policy if exists "recruitment_upload_own_assets" on storage.objects;
create policy "recruitment_upload_own_assets" on storage.objects
  for insert to authenticated with check (
    bucket_id in ('profile-photos', 'resumes', 'company-logos', 'demo-reels')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "recruitment_update_own_assets" on storage.objects;
create policy "recruitment_update_own_assets" on storage.objects
  for update to authenticated using (
    bucket_id in ('profile-photos', 'resumes', 'company-logos', 'demo-reels')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id in ('profile-photos', 'resumes', 'company-logos', 'demo-reels')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "recruitment_delete_own_assets" on storage.objects;
create policy "recruitment_delete_own_assets" on storage.objects
  for delete to authenticated using (
    bucket_id in ('profile-photos', 'resumes', 'company-logos', 'demo-reels')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'job_applications', 'messages', 'notifications'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
