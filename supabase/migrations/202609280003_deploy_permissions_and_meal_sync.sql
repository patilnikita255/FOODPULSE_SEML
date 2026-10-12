-- Table privileges complement the role-aware RLS policies in the core schema.
-- RLS remains the authority for which rows each role can read or change.
grant insert, update, delete on public.organizations, public.messes,
  public.mess_managers, public.plans, public.menus, public.system_settings
  to authenticated;
grant update (status) on public.profiles to authenticated;
grant update on public.feedback to authenticated;
grant insert on public.audit_logs to authenticated;

drop policy if exists "students_update_own_feedback" on public.feedback;
create policy "students_update_own_feedback" on public.feedback for update to authenticated
  using (student_id = (select auth.uid()) and (select public.current_role()) = 'STUDENT')
  with check (student_id = (select auth.uid()) and (select public.current_role()) = 'STUDENT');

drop policy if exists "staff_append_audit_logs" on public.audit_logs;
create policy "staff_append_audit_logs" on public.audit_logs for insert to authenticated
  with check (actor_user_id = (select auth.uid()) and (select public.current_role()) in ('ADMIN', 'MESS_MANAGER'));

drop policy if exists "messes_read_authorized" on public.messes;
create policy "messes_read_authorized" on public.messes for select to authenticated
  using (
    (select public.current_role()) = 'ADMIN'
    or public.is_manager_of(id)
    or public.is_mess_student(id)
    or (status = 'ACTIVE' and organization_id = (
      select organization_id from public.profiles where id = (select auth.uid())
    ))
  );

create or replace function public.request_subscription_change(target_subscription uuid, request_kind text)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.subscriptions;
begin
  if auth.uid() is null or public.current_role() <> 'STUDENT' then
    raise exception 'Only students can request a subscription change' using errcode = '42501';
  end if;
  if request_kind not in ('pause', 'cancel') then
    raise exception 'Request must be pause or cancel';
  end if;
  update public.subscriptions
  set pause_requested = (request_kind = 'pause'),
      cancellation_requested = (request_kind = 'cancel'),
      updated_at = now()
  where id = target_subscription and student_id = auth.uid() and status = 'ACTIVE'
  returning * into saved;
  if saved.id is null then
    raise exception 'No active subscription found' using errcode = 'P0002';
  end if;
  insert into public.notifications (user_id, type, title, message)
  select mm.user_id, 'WARNING', 'Subscription change requested',
    'A student requested to ' || request_kind || ' subscription ' || saved.id::text || '.'
  from public.mess_managers mm
  where mm.mess_id = saved.mess_id and mm.status = 'ACTIVE';
  return saved;
end;
$$;

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
  set status = target_status,
      pause_requested = false,
      cancellation_requested = false,
      updated_at = now()
  where s.id = target_subscription
    and ((select public.current_role()) = 'ADMIN' or public.is_manager_of(s.mess_id));
  if not found then
    raise exception 'Subscription not found or not authorized' using errcode = '42501';
  end if;
  select * into saved from public.subscriptions where id = target_subscription;
  insert into public.audit_logs (actor_user_id, action, module, entity_type, entity_id, description)
  values (auth.uid(), 'UPDATE', 'Subscriptions', 'subscription', saved.id,
    'Subscription status changed to ' || target_status::text);
  return saved;
end;
$$;

grant execute on function public.request_subscription_change(uuid, text) to authenticated;
grant execute on function public.update_subscription_status(uuid, public.subscription_status) to authenticated;

create or replace function public.report_payment(target_payment uuid)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.payments;
begin
  if auth.uid() is null or public.current_role() <> 'STUDENT' then
    raise exception 'Only students can report their payment' using errcode = '42501';
  end if;
  update public.payments
  set status = 'PENDING', payment_method = 'OTHER', payment_date = now(), updated_at = now()
  where id = target_payment and student_id = auth.uid() and status = 'UNPAID'
  returning * into saved;
  if saved.id is null then
    raise exception 'Unpaid payment not found' using errcode = 'P0002';
  end if;
  insert into public.notifications (user_id, type, title, message)
  select mm.user_id, 'INFO', 'Payment reported',
    'A student reported payment for invoice ' || saved.invoice_number || '.'
  from public.mess_managers mm
  where mm.mess_id = saved.mess_id and mm.status = 'ACTIVE';
  return saved;
end;
$$;

grant execute on function public.report_payment(uuid) to authenticated;

-- A published menu is also the source of the meal row used by selections and
-- consumption tracking. Keep those rows in sync without granting clients write
-- access to the operational meals table.
create or replace function public.sync_meal_from_menu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.meals (mess_id, meal_date, meal_type, menu_id)
  values (new.mess_id, new.meal_date, new.meal_type, new.id)
  on conflict (mess_id, meal_date, meal_type)
  do update set menu_id = excluded.menu_id, updated_at = now();
  return new;
end;
$$;

create trigger menus_sync_meal
  after insert or update
  on public.menus
  for each row execute function public.sync_meal_from_menu();

insert into public.meals (mess_id, meal_date, meal_type, menu_id)
select mess_id, meal_date, meal_type, id
from public.menus
where status = 'ACTIVE'
on conflict (mess_id, meal_date, meal_type)
do update set menu_id = excluded.menu_id, updated_at = now();
