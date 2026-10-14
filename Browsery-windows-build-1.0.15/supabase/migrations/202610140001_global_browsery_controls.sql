create table if not exists public.browsery_global_state (
  id boolean primary key default true check (id),
  mode text not null default 'active' check (mode in ('active', 'maintenance', 'shutdown')),
  message text not null default '' check (char_length(message) <= 500),
  updated_at timestamptz not null default now()
);

insert into public.browsery_global_state (id) values (true)
on conflict (id) do nothing;

create table if not exists public.browsery_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 1200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists browsery_announcements_active_created_idx
  on public.browsery_announcements (created_at desc)
  where active;

create table if not exists public.browsery_admin_device (
  id boolean primary key default true check (id),
  device_id text not null,
  paired_at timestamptz not null default now()
);

alter table public.browsery_global_state enable row level security;
alter table public.browsery_announcements enable row level security;
alter table public.browsery_admin_device enable row level security;

revoke all on public.browsery_global_state from anon, authenticated;
revoke all on public.browsery_announcements from anon, authenticated;
revoke all on public.browsery_admin_device from anon, authenticated;

-- The Edge Function is the sole reader/writer and uses a server-only key.
-- Authenticated Browsery accounts are managed by Supabase Auth; there is no
-- client-side policy that can change global service state.
