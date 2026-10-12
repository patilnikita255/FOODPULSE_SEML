# Deploy FoodPulse on Hostinger

FoodPulse uses TanStack Start SSR and Supabase. Deploy the Node server, not only the static `dist` assets.

## 1. Prepare Supabase

1. Rotate the database password that was posted in chat. It is not an app environment variable.
2. In Supabase, keep the Data API enabled. The SQL migrations enable RLS and define table access themselves.
3. From this folder, log into the Supabase CLI and apply all migrations:

   ```sh
   npx supabase login
   npx supabase link --project-ref lvmmboifkavpfqnkcjtq
   npx supabase db push
   ```

4. Run `supabase/seed.sql` in Supabase SQL Editor. It creates the PCCOE organization (`pccoe-mess1`), `PCCOE-MESS1`, and the three plan prices currently shown in the UI. Confirm the prices and tenant names before accepting live payments.
5. Sign up once using the intended administrator email and code `pccoe-mess1`. After the profile exists, replace the email in `supabase/provision-first-admin.sql.example` and run it in SQL Editor to promote that account to `ADMIN`.
6. Deploy the staff invitation function:

   ```sh
   npx supabase functions deploy manage-user
   ```

   The function uses Supabase Edge Function secrets. Never put `SUPABASE_SERVICE_ROLE_KEY` in Hostinger, `.env.example`, or any `VITE_` variable.
7. In Supabase Authentication settings, enable Email, configure SMTP, set the production Site URL, and add both `https://your-domain.example` and `https://your-domain.example/reset-password` to allowed redirect URLs.

## 2. Deploy the app

Hostinger's managed Node.js web apps require Business Web Hosting or a Cloud plan; VPS deployments need manual Node setup. TanStack Start may be detected as **Other**, so configure it explicitly:

- Node.js: **22.x**
- Project/root directory: this `meal-smart-pulse` directory (the directory containing `package.json`)
- Build command: `npm run build`
- Start command: `npm start`
- Entry file if Hostinger requests one: `.output/server/index.mjs`
- Build output directory if requested: `.output`

Set these environment variables in Hostinger's deployment settings (not in the repository):

```text
SUPABASE_PROJECT_ID=lvmmboifkavpfqnkcjtq
SUPABASE_URL=https://lvmmboifkavpfqnkcjtq.supabase.co
SUPABASE_PUBLISHABLE_KEY=<the project's sb_publishable_ key>
VITE_SUPABASE_PROJECT_ID=lvmmboifkavpfqnkcjtq
VITE_SUPABASE_URL=https://lvmmboifkavpfqnkcjtq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<the project's sb_publishable_ key>
NODE_ENV=production
```

Do not add the database password or a service-role key to Hostinger. The browser key is publishable by design; RLS protects database rows.

## 3. After deployment

Test signup with the tenant code, confirm the email, sign in, and verify the Student dashboard. Create manager/admin accounts from the Admin users screen; invited users receive email and their role/mess assignment is stored in Supabase. Test Contact us and confirm the row appears in `contact_submissions` under Supabase Table Editor. Confirm staff can publish menus, record consumption, manage complaints, verify reported payments, and edit plans.

The current payment flow records student-reported offline payments for staff verification. It does not charge cards or process UPI; add a payment provider and server-side webhook before claiming online payment processing.
