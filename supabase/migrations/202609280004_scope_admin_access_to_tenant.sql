-- Administrators are tenant administrators, not platform-wide superusers.
create or replace function public.is_admin_of(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'ADMIN'
      and p.status = 'ACTIVE'
      and p.organization_id = target_organization
  )
$$;

-- Keep audit history tenant-scoped, including rows created by triggers/RPCs.
alter table public.audit_logs add column if not exists organization_id uuid references public.organizations(id);
create index if not exists audit_logs_organization_created_idx
  on public.audit_logs (organization_id, created_at desc);

create or replace function public.set_audit_log_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id
    from public.profiles
    where id = coalesce(new.actor_user_id, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_set_organization on public.audit_logs;
create trigger audit_log_set_organization
  before insert on public.audit_logs
  for each row execute function public.set_audit_log_organization();

drop policy if exists "profiles_read_self_or_admin" on public.profiles;
create policy "profiles_read_self_or_admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin_of(organization_id)
    or exists (select 1 from public.mess_managers mm where mm.user_id = (select auth.uid())
      and mm.status = 'ACTIVE' and mm.mess_id in (
        select s.mess_id from public.subscriptions s where s.student_id = profiles.id
      )));
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_admin_of(organization_id))
  with check (id = (select auth.uid()) or public.is_admin_of(organization_id));
drop policy if exists "profile_admin_update" on public.profiles;
create policy "profile_admin_update" on public.profiles for update to authenticated
  using (public.is_admin_of(organization_id))
  with check (public.is_admin_of(organization_id));

drop policy if exists "admin_manage_organizations" on public.organizations;
create policy "admin_manage_organizations" on public.organizations for all to authenticated
  using (public.is_admin_of(id)) with check (public.is_admin_of(id));
drop policy if exists "organization_read_for_members" on public.organizations;
create policy "organization_read_for_members" on public.organizations for select to authenticated
  using (public.is_admin_of(id)
    or id = (select organization_id from public.profiles where id = (select auth.uid()))
    or exists (select 1 from public.messes m where m.organization_id = organizations.id
      and (public.is_manager_of(m.id) or public.is_mess_student(m.id))));

drop policy if exists "messes_read_authorized" on public.messes;
create policy "messes_read_authorized" on public.messes for select to authenticated
  using (public.is_admin_of(organization_id) or public.is_manager_of(id) or public.is_mess_student(id)
    or (status = 'ACTIVE' and organization_id = (
      select organization_id from public.profiles where id = (select auth.uid())
    )));
drop policy if exists "admin_manage_messes" on public.messes;
create policy "admin_manage_messes" on public.messes for all to authenticated
  using (public.is_admin_of(organization_id)) with check (public.is_admin_of(organization_id));
drop policy if exists "managers_read_assignments" on public.mess_managers;
create policy "managers_read_assignments" on public.mess_managers for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ));
drop policy if exists "admin_manage_assignments" on public.mess_managers;
create policy "admin_manage_assignments" on public.mess_managers for all to authenticated
  using (exists (select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)))
  with check (exists (select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)));

drop policy if exists "plans_read_active_or_staff" on public.plans;
create policy "plans_read_active_or_staff" on public.plans for select to authenticated
  using ((status = 'ACTIVE' and organization_id = (select organization_id from public.profiles where id = (select auth.uid())))
    or public.is_admin_of(organization_id)
    or exists (select 1 from public.messes m where m.organization_id = plans.organization_id and public.is_manager_of(m.id)));
drop policy if exists "admin_manage_plans" on public.plans;
create policy "admin_manage_plans" on public.plans for all to authenticated
  using (public.is_admin_of(organization_id)) with check (public.is_admin_of(organization_id));

drop policy if exists "subscriptions_read_related" on public.subscriptions;
create policy "subscriptions_read_related" on public.subscriptions for select to authenticated
  using (student_id = (select auth.uid()) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ) or public.is_manager_of(mess_id));
drop policy if exists "menus_read_authorized" on public.menus;
create policy "menus_read_authorized" on public.menus for select to authenticated
  using (exists (select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id))
    or public.is_manager_of(mess_id) or (status = 'ACTIVE' and public.is_mess_student(mess_id)));
drop policy if exists "manager_manage_menus" on public.menus;
create policy "manager_manage_menus" on public.menus for all to authenticated
  using (public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ))
  with check (public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ));
drop policy if exists "meals_read_authorized" on public.meals;
create policy "meals_read_authorized" on public.meals for select to authenticated
  using (exists (select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id))
    or public.is_manager_of(mess_id) or public.is_mess_student(mess_id));
drop policy if exists "meal_selections_read_related" on public.meal_selections;
create policy "meal_selections_read_related" on public.meal_selections for select to authenticated
  using (student_id = (select auth.uid()) or exists (
    select 1 from public.meals meal join public.messes mess on mess.id = meal.mess_id
    where meal.id = meal_id and (public.is_admin_of(mess.organization_id) or public.is_manager_of(mess.id))
  ));
drop policy if exists "consumption_read_authorized" on public.meal_consumption;
create policy "consumption_read_authorized" on public.meal_consumption for select to authenticated
  using (public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ));

drop policy if exists "payments_read_related" on public.payments;
create policy "payments_read_related" on public.payments for select to authenticated
  using (student_id = (select auth.uid()) or public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ));
drop policy if exists "payments_staff_update" on public.payments;
create policy "payments_staff_update" on public.payments for update to authenticated
  using (public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ))
  with check (public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ));
drop policy if exists "feedback_read_related" on public.feedback;
create policy "feedback_read_related" on public.feedback for select to authenticated
  using (student_id = (select auth.uid()) or exists (
    select 1 from public.meals meal join public.messes mess on mess.id = meal.mess_id
    where meal.id = meal_id and (public.is_admin_of(mess.organization_id) or public.is_manager_of(mess.id))
  ));
drop policy if exists "complaints_read_related" on public.complaints;
create policy "complaints_read_related" on public.complaints for select to authenticated
  using (student_id = (select auth.uid()) or public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ));
drop policy if exists "staff_update_complaints" on public.complaints;
create policy "staff_update_complaints" on public.complaints for update to authenticated
  using (public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ))
  with check (public.is_manager_of(mess_id) or exists (
    select 1 from public.messes m where m.id = mess_id and public.is_admin_of(m.organization_id)
  ));
drop policy if exists "notifications_owner_read_update" on public.notifications;
create policy "notifications_owner_read_update" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.profiles p where p.id = user_id and public.is_admin_of(p.organization_id)
  ));
drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy "audit_logs_admin_read" on public.audit_logs for select to authenticated
  using (public.is_admin_of(organization_id));
drop policy if exists "staff_append_audit_logs" on public.audit_logs;
create policy "staff_append_audit_logs" on public.audit_logs for insert to authenticated
  with check (actor_user_id = (select auth.uid()) and (select public.current_role()) in ('ADMIN', 'MESS_MANAGER'));
drop policy if exists "settings_admin_manage" on public.system_settings;
create policy "settings_admin_manage" on public.system_settings for all to authenticated
  using (public.is_admin_of(organization_id)) with check (public.is_admin_of(organization_id));
drop policy if exists "settings_read_for_mess_staff" on public.system_settings;
create policy "settings_read_for_mess_staff" on public.system_settings for select to authenticated
  using (public.is_admin_of(organization_id) or exists (
    select 1 from public.messes m where m.organization_id = system_settings.organization_id and public.is_manager_of(m.id)
  ));

create or replace function public.update_subscription_status(target_subscription uuid, target_status public.subscription_status)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.subscriptions;
begin
  update public.subscriptions s
  set status = target_status, pause_requested = false, cancellation_requested = false, updated_at = now()
  where s.id = target_subscription and (
    public.is_manager_of(s.mess_id) or exists (
      select 1 from public.messes m where m.id = s.mess_id and public.is_admin_of(m.organization_id)
    )
  );
  if not found then raise exception 'Subscription not found or not authorized' using errcode = '42501'; end if;
  select * into saved from public.subscriptions where id = target_subscription;
  insert into public.audit_logs (actor_user_id, action, module, entity_type, entity_id, description)
  values (auth.uid(), 'UPDATE', 'Subscriptions', 'subscription', saved.id,
    'Subscription status changed to ' || target_status::text);
  return saved;
end;
$$;

create or replace function public.record_meal_consumption(
  target_meal uuid, prepared integer, consumed integer
) returns public.meal_consumption
language plpgsql
security definer
set search_path = ''
as $$
declare
  meal_record public.meals;
  saved public.meal_consumption;
  demand integer;
begin
  if prepared < 0 or consumed < 0 or consumed > prepared then
    raise exception 'Consumption must be between zero and prepared quantity';
  end if;
  select * into meal_record from public.meals where id = target_meal;
  if not found or not (
    public.is_manager_of(meal_record.mess_id) or exists (
      select 1 from public.messes m where m.id = meal_record.mess_id and public.is_admin_of(m.organization_id)
    )
  ) then raise exception 'Not authorized to record this meal' using errcode = '42501'; end if;
  select count(*)::integer into demand from public.meal_selections where meal_id = target_meal and status = 'SELECTED';
  insert into public.meal_consumption (mess_id, meal_id, expected_quantity, prepared_quantity, consumed_quantity, recorded_by)
    values (meal_record.mess_id, target_meal, demand, prepared, consumed, auth.uid())
  on conflict (meal_id) do update set expected_quantity = excluded.expected_quantity,
    prepared_quantity = excluded.prepared_quantity, consumed_quantity = excluded.consumed_quantity,
    recorded_by = excluded.recorded_by, recorded_at = now(), updated_at = now()
  returning * into saved;
  return saved;
end;
$$;
