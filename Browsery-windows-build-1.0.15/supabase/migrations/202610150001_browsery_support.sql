-- Help & Support tickets. Only the browsery-global-control Edge Function
-- (service role) reads or writes these tables. Users act through the function
-- with their own session token; the owner uses the Owner panel.
create table if not exists public.browsery_support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null default '' check (char_length(email) <= 254),
  category text not null default 'other' check (category in ('bug', 'account', 'feature', 'question', 'other')),
  subject text not null check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  app_version text not null default '' check (char_length(app_version) <= 32),
  platform text not null default '' check (char_length(platform) <= 40),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists browsery_support_tickets_user_idx
  on public.browsery_support_tickets (user_id, created_at desc);
create index if not exists browsery_support_tickets_status_idx
  on public.browsery_support_tickets (status, created_at desc);
create index if not exists browsery_support_tickets_created_idx
  on public.browsery_support_tickets (created_at desc);

create table if not exists public.browsery_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.browsery_support_tickets (id) on delete cascade,
  author text not null check (author in ('user', 'owner')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists browsery_support_messages_ticket_idx
  on public.browsery_support_messages (ticket_id, created_at);
create index if not exists browsery_support_messages_created_idx
  on public.browsery_support_messages (created_at desc);

-- RLS on with no policies: anon/authenticated clients cannot touch tickets.
alter table public.browsery_support_tickets enable row level security;
alter table public.browsery_support_messages enable row level security;
revoke all on public.browsery_support_tickets from anon, authenticated;
revoke all on public.browsery_support_messages from anon, authenticated;
