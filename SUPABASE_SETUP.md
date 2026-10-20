# Supabase setup

Daymark uses Supabase Auth for accounts and PostgreSQL with row-level security for task data. Each row is owned by the signed-in user. Do not put a Supabase `service_role` key in this project; the browser should only use the publishable/anon key.

## Create and connect a project

1. Create a project at [supabase.com](https://supabase.com/) and wait for its database to finish provisioning.
2. In the Supabase SQL Editor, run the contents of [`supabase-schema.sql`](./supabase-schema.sql).
3. In Supabase project settings, copy the project URL and the publishable key (or legacy anon key).
4. Replace the placeholders in [`supabase-config.js`](./supabase-config.js) with those two public values.
\5. In **Authentication → URL Configuration**, set the Site URL to `http://localhost:8000` for local testing and add `http://localhost:8000/**` to the Redirect URLs allowlist. Keep any deployed URLs you use in that allowlist too. A `file://` page is not a valid redirect origin.
6. From this project folder, run `npm run dev` and open `http://localhost:8000`. Choose **Create an account**; the confirmation link will return to the same origin. Open that link on the same computer where the local server is running, then sign in.

The project URL and publishable/anon key are intended for browser use. Database row-level security is what prevents one account from accessing another account's tasks. Never use a service-role or secret key in `supabase-config.js`.

## Existing browser tasks

When an account has no cloud tasks, Daymark asks before importing tasks already stored in this browser. Declining leaves that local data untouched. Once imported, new task and list changes are saved to the signed-in account and are available on other devices using that account.
