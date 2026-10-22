-- MOUSSE RLS and grants baseline checks (pgTAP)
-- Run only after schema.sql and the reviewed hardening migration are applied
-- to a disposable/test Supabase project:
--   supabase test db
-- These checks validate catalog configuration, not cross-account behavior.
-- Cross-account CRUD tests must be added before production use.
begin;
select plan(15);

select ok((select relrowsecurity from pg_class where oid = 'public.shops'::regclass), 'RLS enabled on shops');
select ok((select relrowsecurity from pg_class where oid = 'public.products'::regclass), 'RLS enabled on products');
select ok((select relrowsecurity from pg_class where oid = 'public.orders'::regclass), 'RLS enabled on orders');
select ok((select relrowsecurity from pg_class where oid = 'public.order_items'::regclass), 'RLS enabled on order_items');
select ok((select relrowsecurity from pg_class where oid = 'public.shop_affluence'::regclass), 'RLS enabled on shop_affluence');

select ok(has_table_privilege('authenticated', 'public.shops', 'select'), 'authenticated can select shops (RLS still filters rows)');
select ok(has_table_privilege('authenticated', 'public.products', 'select'), 'authenticated can select products (RLS still filters rows)');
select ok(has_table_privilege('authenticated', 'public.orders', 'select'), 'authenticated can select own orders (RLS still filters rows)');
select ok(has_table_privilege('authenticated', 'public.order_items', 'select'), 'authenticated can select own order items (RLS still filters rows)');
select ok(has_table_privilege('authenticated', 'public.shop_affluence', 'select'), 'authenticated can select own shop affluence (RLS still filters rows)');

select ok(not has_table_privilege('anon', 'public.shops', 'select'), 'anon cannot select shops');
select ok(not has_table_privilege('anon', 'public.products', 'select'), 'anon cannot select products');
select ok(not has_table_privilege('anon', 'public.orders', 'select'), 'anon cannot select orders');
select ok(not has_table_privilege('anon', 'public.order_items', 'select'), 'anon cannot select order items');
select ok(not has_table_privilege('anon', 'public.shop_affluence', 'select'), 'anon cannot select shop affluence');

select * from finish();
rollback;
