-- MOUSSE security hardening migration
-- Apply only to the MOUSSE Supabase project after reviewing the schema.
-- This intentionally denies browser/anonymous access until explicit public-read
-- views and server-side order creation are implemented.
begin;

alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shop_affluence enable row level security;

-- Remove implicit/default client grants, then grant only authenticated CRUD.
-- RLS policies from schema.sql continue to scope rows to each shop owner.
revoke all on table public.shops, public.products, public.orders,
  public.order_items, public.shop_affluence from anon, authenticated;

grant select, insert, update, delete on table public.shops,
  public.products, public.orders, public.order_items,
  public.shop_affluence to authenticated;

-- The existing owner policies provide row scoping. Reassert the intended
-- role explicitly and use auth.uid() as the ownership identity.
-- Existing policy definitions are kept; this migration does not make
-- commerce profiles publicly readable or allow anonymous order insertion.

-- Reduce direct execution of the signup trigger function.
revoke all on function public.create_shop_for_new_user() from public, anon, authenticated;
grant execute on function public.create_shop_for_new_user() to service_role;

commit;
