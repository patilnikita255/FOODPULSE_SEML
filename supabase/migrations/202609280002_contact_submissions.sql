create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  email text not null check (char_length(trim(email)) between 3 and 320),
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  message text not null check (char_length(trim(message)) between 10 and 5000),
  created_at timestamptz not null default now()
);

alter table public.contact_submissions enable row level security;

create policy "public_submit_contact_message"
  on public.contact_submissions
  for insert
  to anon, authenticated
  with check (
    char_length(trim(name)) between 1 and 120
    and char_length(trim(email)) between 3 and 320
    and position('@' in email) > 1
    and char_length(trim(subject)) between 1 and 200
    and char_length(trim(message)) between 10 and 5000
  );

create policy "admin_read_contact_messages"
  on public.contact_submissions
  for select
  to authenticated
  using (public.current_role() = 'ADMIN');

grant insert on public.contact_submissions to anon, authenticated;
grant select on public.contact_submissions to authenticated;
