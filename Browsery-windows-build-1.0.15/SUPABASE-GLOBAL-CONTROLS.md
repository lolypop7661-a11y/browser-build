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

## Owner account (recommended)

Instead of (or as well as) the device-paired key, you can make your own Browsery account the owner. The Owner button then appears on any computer where you are signed in to that account, and survives reinstalls.

1. In Supabase, open **Authentication → Users**, find your Browsery account, and copy its **UID**.
2. Open **Edge Functions → Secrets** (or run `npx supabase secrets set ...`) and add `BROWSERY_OWNER_USER_IDS` with that UID. Separate several owners with commas.
3. Redeploy the function so it has the owner-account check: `npx supabase functions deploy browsery-global-control`.
4. Restart Browsery (version 1.0.19 or later) and sign in with that account. The **Owner** button appears in the toolbar.

The server checks your session token with Supabase Auth on every owner request, so the list cannot be faked from the app. Owner accounts cannot be banned from the Owner panel. Anyone who signs in to your account gets owner controls, so use a strong, unique password.

## Sign-up without email confirmation, protected by a human check

Browsery accounts no longer use confirmation emails. Instead, sign-up and sign-in open a small Cloudflare Turnstile window. Supabase checks the Turnstile token on its own servers, so calling the public sign-up endpoint directly does not skip the check.

1. In Cloudflare, open **Turnstile → Add widget**. Add the hostname `lolypop7661-a11y.github.io` (or another domain you own; Browsery answers that hostname locally inside the check window, so nothing has to be hosted there). Use the **Managed** widget mode.
2. Copy the **site key** into `electron/global-control-config.json` as `captchaSiteKey`. If you used a different hostname, set `captchaHost` to it. The site key is public.
3. In Supabase, go to **Authentication → Bot and Abuse Protection**, turn on **Enable CAPTCHA protection**, choose **Turnstile**, and paste the Turnstile **secret key** there. The secret key goes only in Supabase, never in Browsery.
4. In Supabase, go to **Authentication → Sign In / Providers → Email** and turn off **Confirm email**.
5. Build and publish a new Browsery release. Older installs do not send a captcha token, so they can no longer sign in or sign up once step 3 is on. Do steps 3 and 4 when the new release is out.

If `captchaSiteKey` is empty, Browsery skips the check window. Supabase will then reject the request if CAPTCHA protection is turned on.

Accounts created earlier that never confirmed their email may still be refused. Confirm them under **Authentication → Users**, or delete them so the person can sign up again.

## Security references

- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Auth sign-up](https://supabase.com/docs/reference/javascript/auth-signup)

