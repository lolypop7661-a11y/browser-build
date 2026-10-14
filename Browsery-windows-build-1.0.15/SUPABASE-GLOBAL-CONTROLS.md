# Browsery global accounts and owner controls

This project now contains the shared-service integration for global Browsery accounts, announcements, maintenance mode, and the shutdown lock. It is intentionally **not active until a Supabase project is created, configured, and deployed**. No Supabase credentials or admin secret are included in the source or installer.

## What runs where

- Browsery users create/sign in to global accounts through Supabase Auth. These accounts authenticate only; Browsery profile sync is not implemented by this feature.
- Browsery installs read the public global status and active announcements from the Edge Function.
- The owner controls are only usable from the installed desktop app. The admin secret is saved using Windows-backed secure storage on the owner PC. The first successful admin command pairs a random installation ID in the database; another install with the same key is rejected.
- The Edge Function alone has the Supabase server key. The database tables have RLS enabled and no direct `anon`/`authenticated` table access.
- Clients poll every 15 seconds while Browsery is running. A device that is offline cannot receive a change until it reconnects. The shutdown control is a global browsing lock screen; it cannot power off another person’s computer.

## One-time Supabase setup

1. Create a Supabase project and enable email/password sign-up in Authentication. Configure email delivery if you want account confirmation emails to reach users reliably.
2. Link this source folder to the project using the Supabase CLI, then apply the schema and deploy the function:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   npx supabase functions deploy browsery-global-control
   ```

3. Create a random secret of at least 32 characters. Add it as the Supabase Edge Function secret named `BROWSERY_ADMIN_SECRET` using the Supabase dashboard or CLI. Use the exact same value only in the owner PC’s Browsery Network panel. Do not commit it, put it in the installer, or send it to users.
4. Copy the project URL and its **publishable** key (or legacy `anon` key) from the Supabase dashboard into `electron/global-control-config.json`:

   ```json
   {
     "supabaseUrl": "https://YOUR_PROJECT_REF.supabase.co",
     "supabaseAnonKey": "YOUR_PUBLIC_PUBLISHABLE_KEY"
   }
   ```

   The publishable/anon key is public and is not an admin credential. Never use a Supabase `secret` or `service_role` key here.
5. Build and publish a new Browsery release. All users need that configured build before they can receive the shared announcements and control state.
6. On your own installed Browsery, open **Owner** in the toolbar → **Browsery Network**. Paste the `BROWSERY_ADMIN_SECRET` and save it. Your first successful admin action pairs that installation with the server.

If you replace or wipe the owner PC’s Browsery profile, the old device ID stays paired. To move admin control, reset the single row in `public.browsery_admin_device` through the Supabase SQL editor, then save the secret on the replacement PC and perform an admin action. Treat this as an owner-only recovery operation.

## Security references

- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Auth sign-up](https://supabase.com/docs/reference/javascript/auth-signup)

