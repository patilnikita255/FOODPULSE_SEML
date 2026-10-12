-- Initial PCCOE tenant using the signup code requested for deployment.
-- Safe to re-run; update the placeholder plans/settings before production sales.
with created_org as (
  insert into public.organizations (name, slug)
  values ('PCCOE', 'pccoe-mess1')
  on conflict (slug) do update set name = excluded.name
  returning id
), selected_org as (
  select id from created_org
  union all
  select id from public.organizations where slug = 'pccoe-mess1'
  limit 1
), created_mess as (
  insert into public.messes (organization_id, name, timezone)
  select id, 'PCCOE-MESS1', 'Asia/Kolkata' from selected_org
  on conflict (organization_id, name) do update set timezone = excluded.timezone
  returning organization_id
)
insert into public.system_settings (organization_id, mess_name)
select organization_id, 'PCCOE-MESS1' from created_mess
on conflict (organization_id) do update set mess_name = excluded.mess_name;

insert into public.plans (
  organization_id, name, type, price, duration_days, included_meals,
  breakfast_included, lunch_included, dinner_included, description
)
select o.id, v.name, v.type, v.price, v.duration_days, v.included_meals,
  v.breakfast_included, v.lunch_included, v.dinner_included, v.description
from public.organizations o
cross join (values
  ('Weekly Plan', 'WEEKLY', 850::numeric, 7, 21, true, true, true, 'Short-term flexibility for students.'),
  ('Monthly Plan', 'MONTHLY', 2700::numeric, 30, 90, true, true, true, 'All three meals for 30 days.'),
  ('Monthly Lite', 'MONTHLY', 1850::numeric, 30, 60, false, true, true, 'Lunch and dinner for 30 days.')
) as v(name, type, price, duration_days, included_meals, breakfast_included, lunch_included, dinner_included, description)
where o.slug = 'pccoe-mess1'
on conflict (organization_id, name) do update set
  type = excluded.type,
  price = excluded.price,
  duration_days = excluded.duration_days,
  included_meals = excluded.included_meals,
  breakfast_included = excluded.breakfast_included,
  lunch_included = excluded.lunch_included,
  dinner_included = excluded.dinner_included,
  description = excluded.description;
