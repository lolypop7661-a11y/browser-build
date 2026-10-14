create table if not exists public.browsery_admin_config (
  id boolean primary key default true check (id),
  config jsonb not null default '{"signupsEnabled":true,"minimumVersion":"","releaseUrl":"","releaseNotes":"","maintenanceStart":"","maintenanceEnd":"","features":{"ai":true,"extensions":true,"voice":true,"music":true,"vpn":true}}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.browsery_admin_config (id) values (true)
on conflict (id) do nothing;

create table if not exists public.browsery_admin_audit (
  id bigint generated always as identity primary key,
  action text not null check (char_length(action) <= 80),
  target text not null default '' check (char_length(target) <= 254),
  device_id text not null check (char_length(device_id) <= 64),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists browsery_admin_audit_created_idx
  on public.browsery_admin_audit (created_at desc);

alter table public.browsery_admin_config enable row level security;
alter table public.browsery_admin_audit enable row level security;
revoke all on public.browsery_admin_config from anon, authenticated;
revoke all on public.browsery_admin_audit from anon, authenticated;
