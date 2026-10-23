-- These functions are invoked by PostgreSQL event/row triggers, not directly by browser clients.
-- Trigger execution continues to work after removing direct RPC privileges.
revoke all on function public.enforce_shop_order_settings() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
