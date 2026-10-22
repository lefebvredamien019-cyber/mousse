-- MOUSSE RLS regression test plan (pgTAP)
-- Run with: supabase test db
-- These tests are intentionally explicit about the expected security boundary.
-- They must run against a disposable MOUSSE Supabase project with schema.sql
-- and the hardening migration applied. Never run destructive tests on production.
begin;
select plan(5);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.shops'::regclass),
  'RLS enabled on shops'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.products'::regclass),
  'RLS enabled on products'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.orders'::regclass),
  'RLS enabled on orders'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.order_items'::regclass),
  'RLS enabled on order_items'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.shop_affluence'::regclass),
  'RLS enabled on shop_affluence'
);

select * from finish();
rollback;
