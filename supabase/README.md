# FoodPulse Supabase Setup

FoodPulse uses Supabase Auth for email/password identities and PostgreSQL with row-level security for tenant-scoped data. Public browser configuration consists only of `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; never put a service-role key in a `VITE_` variable or browser bundle.

## Apply the database

The migrations in `migrations/` create the core organization, profile, mess, plan, subscription, meal, selection, consumption, payment, feedback, complaint, notification, audit, settings, and contact submission tables; indexes and constraints; RLS; profile provisioning; validated RPCs; updated-at/audit triggers; and Realtime publication membership. Menus automatically create their corresponding meal rows. Contact us submissions can be sent without signing in; only admins can read stored submissions.

From the `meal-smart-pulse` folder, link the existing project and push migrations:

```powershell
npx supabase login
npx supabase link --project-ref lvmmboifkavpfqnkcjtq
npx supabase db push
```

The local `supabase db lint --local` check requires Docker and `npx supabase start`. `db push` needs a Supabase CLI login with database access. Then run `supabase/seed.sql` once in the Supabase SQL Editor to create the PCCOE tenant and the three starter plans from the existing UI.

## Create each college/client tenant

Create one organization and at least one mess before allowing public registration. The organization `slug` is the organization code students enter when they register. The initial PCCOE tenant seed is in `seed.sql`; use the example below for additional clients, changing the values:

```sql
with new_org as (
  insert into public.organizations (name, slug)
  values ('North Campus College', 'north-campus')
  returning id
)
insert into public.messes (organization_id, name, timezone)
select id, 'North Campus Mess', 'Asia/Kolkata' from new_org;
```

Add active plans for the organization and configure `system_settings`. Public signup always provisions the `STUDENT` role. Unknown organization codes are rejected by the auth profile trigger; role cannot be set through signup metadata.

## Provision staff securely

The Admin users screen calls the `manage-user` Supabase Edge Function to invite users and set their roles. Deploy it with `npx supabase functions deploy manage-user`. It verifies the caller is an active administrator in the same organization and uses the server-only Supabase service-role key. The first administrator must be bootstrapped through Supabase SQL Editor using `provision-first-admin.sql.example` after signing up.

Manual provisioning remains available in Supabase Dashboard Auth/SQL Editor. Example after replacing the email and mess name:

```sql
update public.profiles
set role = 'MESS_MANAGER'
where lower(email) = lower('manager@college.edu') and status = 'ACTIVE';

insert into public.mess_managers (user_id, mess_id)
select p.id, m.id
from public.profiles p
join public.messes m on m.name = 'North Campus Mess'
where lower(p.email) = lower('manager@college.edu');
```

Only trusted administrators should assign `ADMIN` or `MESS_MANAGER`. Do not commit real user passwords or a service-role key.

## Auth settings

In Supabase Authentication settings, enable Email provider, choose whether email confirmation is required, set the production Site URL, and add the deployed FoodPulse origin to Redirect URLs. Add `<site-origin>/reset-password` as an allowed redirect. Configure SMTP for reliable college/client delivery; Supabase's default email service is rate-limited for production use.

## Tenant and authorization rules

- RLS is enabled on all application tables. Profile visibility is self/admin, plus students subscribed to a manager's mess.
- Students can read their own subscriptions/payments/feedback/complaints/notifications and change meal selections only through the deadline-validating RPC.
- Managers are scoped by active `mess_managers` rows. Admin access is role-gated.
- `create_subscription` checks student role, active plan, same organization, and the one-active-subscription constraint; it creates an unpaid payment, notification, and audit event.
- `record_meal_consumption` validates quantities and stores generated waste totals/percentage.
- Payment status changes create audit entries and paid notifications through a trigger.
- Realtime publication membership is enabled for notifications, menus, complaints, payments, and meal selections. Subscribe only after the authenticated profile loads, and keep realtime row visibility protected by table RLS.

## Current integration scope

Email/password sign-in, Student signup, session restoration, profile editing, password change, password reset, sign-out, and Contact us submissions use Supabase Auth/database. Sign-in reads the trusted profile role and routes users to their matching dashboard. Public signup is student-only; staff roles are provisioned by a trusted admin. Dashboard reads now load from Supabase under RLS; remaining write paths are being moved from local mock state as documented by the UI module behavior. No production auth accounts are created by these migrations.
