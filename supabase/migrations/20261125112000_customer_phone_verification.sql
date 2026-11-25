create table if not exists public.customer_phone_otps (
  phone_hash text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  last_sent_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.customer_phone_otps enable row level security;
revoke all on table public.customer_phone_otps from anon, authenticated;
grant all on table public.customer_phone_otps to service_role;
