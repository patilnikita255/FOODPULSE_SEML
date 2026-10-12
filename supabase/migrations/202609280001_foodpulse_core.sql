create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('STUDENT', 'MESS_MANAGER', 'ADMIN');
create type public.record_status as enum ('ACTIVE', 'INACTIVE', 'SUSPENDED');
create type public.meal_type as enum ('BREAKFAST', 'LUNCH', 'DINNER');
create type public.subscription_status as enum ('ACTIVE', 'EXPIRED', 'PAUSED', 'CANCELLED', 'PENDING');
create type public.meal_selection_status as enum ('SELECTED', 'SKIPPED', 'LOCKED', 'UNSELECTED');
create type public.payment_status as enum ('PAID', 'UNPAID', 'PENDING', 'VOID');
create type public.complaint_status as enum ('OPEN', 'IN_PROGRESS', 'RESOLVED');
create type public.notification_type as enum ('SUCCESS', 'WARNING', 'ERROR', 'INFO');

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status public.record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id),
  full_name text not null default '',
  email text not null,
  phone text,
  role public.app_role not null default 'STUDENT',
  status public.record_status not null default 'ACTIVE',
  profile_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_lower_idx on public.profiles (lower(email));
create index profiles_role_status_idx on public.profiles (role, status);

create table public.messes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  contact text,
  address text,
  operating_hours text,
  timezone text not null default 'Asia/Kolkata',
  status public.record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index messes_organization_idx on public.messes (organization_id, status);

create table public.mess_managers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  mess_id uuid not null references public.messes(id),
  assigned_at timestamptz not null default now(),
  status public.record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, mess_id)
);
create index mess_managers_user_idx on public.mess_managers (user_id, status);
create index mess_managers_mess_idx on public.mess_managers (mess_id, status);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  type text not null check (type in ('WEEKLY', 'MONTHLY')),
  price numeric(12,2) not null check (price >= 0),
  duration_days integer not null check (duration_days > 0),
  included_meals integer not null default 0 check (included_meals >= 0),
  breakfast_included boolean not null default true,
  lunch_included boolean not null default true,
  dinner_included boolean not null default true,
  description text,
  status public.record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index plans_org_status_idx on public.plans (organization_id, status);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  plan_id uuid not null references public.plans(id),
  mess_id uuid not null references public.messes(id),
  plan_name_snapshot text not null,
  price_snapshot numeric(12,2) not null check (price_snapshot >= 0),
  start_date date not null,
  end_date date not null,
  total_meals integer not null default 0 check (total_meals >= 0),
  meals_used integer not null default 0 check (meals_used >= 0),
  status public.subscription_status not null default 'PENDING',
  cancellation_requested boolean not null default false,
  pause_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create unique index subscriptions_one_active_per_student_idx
  on public.subscriptions (student_id) where status = 'ACTIVE';
create index subscriptions_student_status_idx on public.subscriptions (student_id, status);
create index subscriptions_mess_dates_idx on public.subscriptions (mess_id, start_date, end_date);

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  mess_id uuid not null references public.messes(id),
  meal_date date not null,
  meal_type public.meal_type not null,
  menu_items jsonb not null default '[]'::jsonb check (jsonb_typeof(menu_items) = 'array'),
  is_special boolean not null default false,
  is_festival boolean not null default false,
  status public.record_status not null default 'ACTIVE',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mess_id, meal_date, meal_type)
);
create index menus_mess_date_idx on public.menus (mess_id, meal_date, meal_type);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  mess_id uuid not null references public.messes(id),
  meal_date date not null,
  meal_type public.meal_type not null,
  menu_id uuid references public.menus(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mess_id, meal_date, meal_type)
);
create index meals_date_type_idx on public.meals (mess_id, meal_date, meal_type);

create table public.meal_selections (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  meal_id uuid not null references public.meals(id),
  status public.meal_selection_status not null default 'UNSELECTED',
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, meal_id)
);
create index meal_selections_student_idx on public.meal_selections (student_id, meal_id);

create table public.meal_consumption (
  id uuid primary key default gen_random_uuid(),
  mess_id uuid not null references public.messes(id),
  meal_id uuid not null unique references public.meals(id),
  expected_quantity integer not null default 0 check (expected_quantity >= 0),
  prepared_quantity integer not null check (prepared_quantity >= 0),
  consumed_quantity integer not null check (consumed_quantity >= 0 and consumed_quantity <= prepared_quantity),
  wasted_quantity integer generated always as (prepared_quantity - consumed_quantity) stored,
  wastage_percentage numeric(6,2) generated always as (
    case when prepared_quantity = 0 then 0
      else round(((prepared_quantity - consumed_quantity)::numeric / prepared_quantity) * 100, 2)
    end
  ) stored,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meal_consumption_mess_recorded_idx on public.meal_consumption (mess_id, recorded_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  subscription_id uuid not null references public.subscriptions(id),
  mess_id uuid not null references public.messes(id),
  invoice_number text not null unique,
  amount numeric(12,2) not null check (amount >= 0),
  payment_date timestamptz,
  status public.payment_status not null default 'UNPAID',
  payment_method text check (payment_method in ('DEMO', 'CASH', 'OTHER')),
  transaction_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_student_status_idx on public.payments (student_id, status);
create index payments_mess_date_idx on public.payments (mess_id, payment_date);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  meal_id uuid not null references public.meals(id),
  rating smallint not null check (rating between 1 and 5),
  category text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, meal_id)
);
create index feedback_meal_idx on public.feedback (meal_id, rating);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  mess_id uuid not null references public.messes(id),
  meal_id uuid references public.meals(id),
  category text not null,
  description text not null,
  status public.complaint_status not null default 'OPEN',
  manager_response text,
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index complaints_student_status_idx on public.complaints (student_id, status);
create index complaints_mess_status_idx on public.complaints (mess_id, status);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type public.notification_type not null default 'INFO',
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, is_read, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id),
  action text not null,
  module text not null,
  entity_type text,
  entity_id uuid,
  description text not null,
  old_value jsonb,
  new_value jsonb,
  status text not null default 'SUCCESS',
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id),
  mess_name text,
  contact text,
  address text,
  operating_hours text,
  breakfast_time time,
  lunch_time time,
  dinner_time time,
  meal_cutoff_time time not null default '22:00',
  notify_subscription_expiry boolean not null default true,
  notify_payment_reminder boolean not null default true,
  notify_meal_deadline boolean not null default true,
  notify_complaint_update boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  selected_organization uuid;
begin
  select id into selected_organization from public.organizations
    where slug = nullif(new.raw_user_meta_data ->> 'organization_slug', '') and status = 'ACTIVE';
  if selected_organization is null then
    select (array_agg(id))[1] into selected_organization from public.organizations where status = 'ACTIVE'
      having count(*) = 1;
  end if;
  if selected_organization is null then
    raise exception 'A valid organization code is required to create a FoodPulse account';
  end if;
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  update public.profiles set organization_id = selected_organization where id = new.id;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and status = 'ACTIVE'
$$;

create or replace function public.is_manager_of(target_mess uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.mess_managers mm
    where mm.user_id = (select auth.uid()) and mm.mess_id = target_mess and mm.status = 'ACTIVE'
  )
$$;

create or replace function public.is_mess_student(target_mess uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.student_id = (select auth.uid()) and s.mess_id = target_mess
      and s.status in ('ACTIVE', 'PENDING') and s.end_date >= (now() at time zone 'Asia/Kolkata')::date
  )
$$;

create or replace function public.create_subscription(target_plan uuid, target_mess uuid)
returns public.subscriptions language plpgsql security definer set search_path = '' as $$
declare
  selected_plan public.plans;
  created_subscription public.subscriptions;
  invoice text;
  current_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or public.current_role() <> 'STUDENT' then
    raise exception 'Only signed-in students can subscribe' using errcode = '42501';
  end if;
  if exists (select 1 from public.subscriptions where student_id = auth.uid() and status = 'ACTIVE') then
    raise exception 'An active subscription already exists' using errcode = '23505';
  end if;
  select * into selected_plan from public.plans p
    where p.id = target_plan and p.status = 'ACTIVE'
      and p.organization_id = (select organization_id from public.profiles where id = auth.uid())
      and p.organization_id = (select organization_id from public.messes where id = target_mess and status = 'ACTIVE');
  if not found then raise exception 'Selected plan or mess is unavailable'; end if;

  insert into public.subscriptions (
    student_id, plan_id, mess_id, plan_name_snapshot, price_snapshot,
    start_date, end_date, total_meals, status
  ) values (
    auth.uid(), selected_plan.id, target_mess, selected_plan.name, selected_plan.price,
    current_day, current_day + selected_plan.duration_days - 1, selected_plan.included_meals, 'ACTIVE'
  ) returning * into created_subscription;

  invoice := 'FP-' || to_char(current_day, 'YYYY') || '-' ||
    lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  insert into public.payments (student_id, subscription_id, mess_id, invoice_number, amount)
    values (auth.uid(), created_subscription.id, target_mess, invoice, selected_plan.price);
  insert into public.notifications (user_id, type, title, message)
    values (auth.uid(), 'SUCCESS', 'Subscription created', 'Your subscription is active. Your invoice is ready.');
  insert into public.audit_logs (actor_user_id, action, module, entity_type, entity_id, description)
    values (auth.uid(), 'CREATE', 'Subscriptions', 'subscription', created_subscription.id, 'Student subscribed to ' || selected_plan.name);
  return created_subscription;
end;
$$;

create sequence public.invoice_number_seq;

create or replace function public.set_meal_selection(target_meal uuid, desired_status public.meal_selection_status)
returns public.meal_selections language plpgsql security definer set search_path = '' as $$
declare
  target public.meals;
  plan_record public.plans;
  result public.meal_selections;
  deadline timestamptz;
begin
  if auth.uid() is null or public.current_role() <> 'STUDENT' then
    raise exception 'Only signed-in students can change meal selections' using errcode = '42501';
  end if;
  if desired_status not in ('SELECTED', 'SKIPPED') then raise exception 'Invalid meal selection'; end if;
  select * into target from public.meals where id = target_meal;
  if not found then raise exception 'Meal not found' using errcode = 'P0002'; end if;
  select p.* into plan_record from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.student_id = auth.uid() and s.mess_id = target.mess_id and s.status = 'ACTIVE'
      and s.start_date <= target.meal_date and s.end_date >= target.meal_date limit 1;
  if not found then raise exception 'An active subscription for this meal is required' using errcode = '42501'; end if;
  if (target.meal_type = 'BREAKFAST' and not plan_record.breakfast_included)
    or (target.meal_type = 'LUNCH' and not plan_record.lunch_included)
    or (target.meal_type = 'DINNER' and not plan_record.dinner_included) then
    raise exception 'This meal is not included in your plan';
  end if;
  deadline := ((target.meal_date - 1)::timestamp + time '22:00') at time zone 'Asia/Kolkata';
  if now() >= deadline then
    raise exception 'Meal selection deadline has passed. This meal can no longer be changed.' using errcode = 'P0001';
  end if;
  insert into public.meal_selections (student_id, meal_id, status, selected_at)
    values (auth.uid(), target.id, desired_status, case when desired_status = 'SELECTED' then now() end)
  on conflict (student_id, meal_id) do update set
    status = excluded.status, selected_at = excluded.selected_at, updated_at = now()
  where public.meal_selections.status <> 'LOCKED'
  returning * into result;
  if result.id is null then raise exception 'This meal selection is locked'; end if;
  return result;
end;
$$;

create or replace function public.record_meal_consumption(
  target_meal uuid, prepared integer, consumed integer
) returns public.meal_consumption language plpgsql security definer set search_path = '' as $$
declare
  meal_record public.meals;
  saved public.meal_consumption;
  demand integer;
begin
  if prepared < 0 or consumed < 0 or consumed > prepared then
    raise exception 'Consumption must be between zero and prepared quantity';
  end if;
  select * into meal_record from public.meals where id = target_meal;
  if not found or not (public.current_role() = 'ADMIN' or public.is_manager_of(meal_record.mess_id)) then
    raise exception 'Not authorized to record this meal' using errcode = '42501';
  end if;
  select count(*)::integer into demand from public.meal_selections
    where meal_id = target_meal and status = 'SELECTED';
  insert into public.meal_consumption (mess_id, meal_id, expected_quantity, prepared_quantity, consumed_quantity, recorded_by)
    values (meal_record.mess_id, target_meal, demand, prepared, consumed, auth.uid())
  on conflict (meal_id) do update set expected_quantity = excluded.expected_quantity,
    prepared_quantity = excluded.prepared_quantity, consumed_quantity = excluded.consumed_quantity,
    recorded_by = excluded.recorded_by, recorded_at = now(), updated_at = now()
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.audit_payment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (actor_user_id, action, module, entity_type, entity_id, description, old_value, new_value)
      values (auth.uid(), 'UPDATE', 'Payments', 'payment', new.id,
        'Payment status changed', jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
    if new.status = 'PAID' then
      insert into public.notifications (user_id, type, title, message)
        values (new.student_id, 'SUCCESS', 'Payment received', 'Payment for invoice ' || new.invoice_number || ' is marked paid.');
    end if;
  end if;
  return new;
end;
$$;
create trigger payment_status_audit after update of status on public.payments
  for each row execute function public.audit_payment_change();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organizations', 'profiles', 'messes', 'mess_managers', 'plans', 'subscriptions', 'menus',
    'meals', 'meal_selections', 'meal_consumption', 'payments', 'feedback', 'complaints',
    'notifications', 'system_settings'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name);
  end loop;
end;
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.messes enable row level security;
alter table public.mess_managers enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.menus enable row level security;
alter table public.meals enable row level security;
alter table public.meal_selections enable row level security;
alter table public.meal_consumption enable row level security;
alter table public.payments enable row level security;
alter table public.feedback enable row level security;
alter table public.complaints enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

create policy "profiles_read_self_or_admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.current_role()) = 'ADMIN'
    or exists (select 1 from public.mess_managers mm where mm.user_id = (select auth.uid())
      and mm.status = 'ACTIVE' and mm.mess_id in (
        select s.mess_id from public.subscriptions s where s.student_id = profiles.id
      )));
create policy "profiles_update_self_or_admin" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.current_role()) = 'ADMIN')
  with check (id = (select auth.uid()) or (select public.current_role()) = 'ADMIN');
grant update (full_name, phone, profile_image_url) on public.profiles to authenticated;
create policy "admin_manage_organizations" on public.organizations for all to authenticated
  using ((select public.current_role()) = 'ADMIN') with check ((select public.current_role()) = 'ADMIN');
create policy "organization_read_for_members" on public.organizations for select to authenticated
  using ((select public.current_role()) = 'ADMIN'
    or id = (select organization_id from public.profiles where id = (select auth.uid()))
    or exists (select 1 from public.messes m where m.organization_id = organizations.id
      and (public.is_manager_of(m.id) or public.is_mess_student(m.id))));
create policy "messes_read_authorized" on public.messes for select to authenticated
  using ((select public.current_role()) = 'ADMIN' or public.is_manager_of(id) or public.is_mess_student(id));
create policy "admin_manage_messes" on public.messes for all to authenticated
  using ((select public.current_role()) = 'ADMIN') with check ((select public.current_role()) = 'ADMIN');
create policy "managers_read_assignments" on public.mess_managers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.current_role()) = 'ADMIN');
create policy "admin_manage_assignments" on public.mess_managers for all to authenticated
  using ((select public.current_role()) = 'ADMIN') with check ((select public.current_role()) = 'ADMIN');
create policy "plans_read_active_or_staff" on public.plans for select to authenticated
  using ((status = 'ACTIVE' and organization_id = (select organization_id from public.profiles where id = (select auth.uid())))
    or (select public.current_role()) = 'ADMIN'
    or exists (select 1 from public.messes m where m.organization_id = plans.organization_id and public.is_manager_of(m.id)));
create policy "admin_manage_plans" on public.plans for all to authenticated
  using ((select public.current_role()) = 'ADMIN') with check ((select public.current_role()) = 'ADMIN');
create policy "subscriptions_read_related" on public.subscriptions for select to authenticated
  using (student_id = (select auth.uid()) or (select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id));
create policy "menus_read_authorized" on public.menus for select to authenticated
  using ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id)
    or (status = 'ACTIVE' and public.is_mess_student(mess_id)));
create policy "manager_manage_menus" on public.menus for all to authenticated
  using ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id))
  with check ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id));
create policy "meals_read_authorized" on public.meals for select to authenticated
  using ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id) or public.is_mess_student(mess_id));
create policy "meal_selections_read_related" on public.meal_selections for select to authenticated
  using (student_id = (select auth.uid()) or (select public.current_role()) = 'ADMIN' or exists (
    select 1 from public.meals m where m.id = meal_id and public.is_manager_of(m.mess_id)
  ));
create policy "meal_selections_student_insert" on public.meal_selections for insert to authenticated
  with check (student_id = (select auth.uid()) and (select public.current_role()) = 'STUDENT');
create policy "meal_selections_student_update" on public.meal_selections for update to authenticated
  using (student_id = (select auth.uid()) and status <> 'LOCKED')
  with check (student_id = (select auth.uid()) and status in ('SELECTED', 'SKIPPED'));
create policy "consumption_read_authorized" on public.meal_consumption for select to authenticated
  using ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id));
create policy "payments_read_related" on public.payments for select to authenticated
  using (student_id = (select auth.uid()) or (select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id));
create policy "payments_staff_update" on public.payments for update to authenticated
  using ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id))
  with check ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id));
create policy "feedback_read_related" on public.feedback for select to authenticated
  using (student_id = (select auth.uid()) or (select public.current_role()) = 'ADMIN' or exists (
    select 1 from public.meals m where m.id = meal_id and public.is_manager_of(m.mess_id)
  ));
create policy "students_create_feedback" on public.feedback for insert to authenticated
  with check (student_id = (select auth.uid()) and (select public.current_role()) = 'STUDENT');
create policy "complaints_read_related" on public.complaints for select to authenticated
  using (student_id = (select auth.uid()) or (select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id));
create policy "students_create_complaints" on public.complaints for insert to authenticated
  with check (student_id = (select auth.uid()) and (select public.current_role()) = 'STUDENT');
create policy "staff_update_complaints" on public.complaints for update to authenticated
  using ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id))
  with check ((select public.current_role()) = 'ADMIN' or public.is_manager_of(mess_id));
create policy "notifications_owner_read_update" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.current_role()) = 'ADMIN');
create policy "notifications_owner_update" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "audit_logs_admin_read" on public.audit_logs for select to authenticated
  using ((select public.current_role()) = 'ADMIN');
create policy "settings_admin_manage" on public.system_settings for all to authenticated
  using ((select public.current_role()) = 'ADMIN') with check ((select public.current_role()) = 'ADMIN');
create policy "settings_read_for_mess_staff" on public.system_settings for select to authenticated
  using ((select public.current_role()) = 'ADMIN' or exists (
    select 1 from public.messes m where m.organization_id = system_settings.organization_id and public.is_manager_of(m.id)
  ));

create policy "profile_admin_update" on public.profiles for update to authenticated
  using ((select public.current_role()) = 'ADMIN')
  with check ((select public.current_role()) = 'ADMIN');

grant select on public.meal_selections to authenticated;
grant select, insert on public.feedback to authenticated;
grant select, insert on public.complaints to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.profiles, public.organizations, public.messes, public.mess_managers,
  public.plans, public.subscriptions, public.menus, public.meals, public.meal_consumption,
  public.payments, public.audit_logs, public.system_settings to authenticated;
grant update on public.complaints, public.payments to authenticated;
grant usage, select on sequence public.invoice_number_seq to authenticated;
revoke insert, update, delete on public.meal_selections from authenticated;
revoke insert, update, delete on public.meal_consumption from authenticated;
grant execute on function public.create_subscription(uuid, uuid) to authenticated;
grant execute on function public.set_meal_selection(uuid, public.meal_selection_status) to authenticated;
grant execute on function public.record_meal_consumption(uuid, integer, integer) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['notifications', 'menus', 'complaints', 'payments', 'meal_selections'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
