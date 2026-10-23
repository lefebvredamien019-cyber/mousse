create table if not exists public.mousse_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.mousse_admins enable row level security;
grant select on public.mousse_admins to authenticated;
drop policy if exists "admins can read their own admin assignment" on public.mousse_admins;
create policy "admins can read their own admin assignment"
  on public.mousse_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "mousse admins read all merchant applications" on public.merchant_applications;
create policy "mousse admins read all merchant applications"
  on public.merchant_applications for select to authenticated
  using (exists (select 1 from public.mousse_admins a where a.user_id = (select auth.uid())));
drop policy if exists "mousse admins review merchant applications" on public.merchant_applications;
create policy "mousse admins review merchant applications"
  on public.merchant_applications for update to authenticated
  using (exists (select 1 from public.mousse_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.mousse_admins a where a.user_id = (select auth.uid())));

drop policy if exists "mousse admins read all shops" on public.shops;
create policy "mousse admins read all shops"
  on public.shops for select to authenticated
  using (exists (select 1 from public.mousse_admins a where a.user_id = (select auth.uid())));
drop policy if exists "mousse admins update shops" on public.shops;
create policy "mousse admins update shops"
  on public.shops for update to authenticated
  using (exists (select 1 from public.mousse_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.mousse_admins a where a.user_id = (select auth.uid())));

create or replace function public.review_merchant_application(
  p_application_id uuid,
  p_decision text,
  p_note text default ''
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  application_row public.merchant_applications%rowtype;
  affected integer;
begin
  if p_decision not in ('approved','changes_requested','rejected') then
    raise exception 'Invalid application decision';
  end if;
  select * into application_row
  from public.merchant_applications
  where id = p_application_id
  for update;
  if not found then
    raise exception 'Application not found or access denied';
  end if;
  update public.merchant_applications
    set status = p_decision,
        review_note = left(coalesce(p_note, ''), 1000),
        reviewed_at = now(),
        updated_at = now()
    where id = p_application_id;
  if p_decision = 'approved' then
    update public.shops
      set name = application_row.business_name,
          email = application_row.business_email,
          phone = application_row.phone,
          address = concat_ws(', ', application_row.address, application_row.postal_code, application_row.city),
          description = application_row.description,
          opening_hours = application_row.opening_hours,
          is_published = true,
          updated_at = now()
      where owner_id = application_row.owner_id;
    get diagnostics affected = row_count;
    if affected = 0 then
      raise exception 'No merchant shop exists for this application';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;
revoke all on function public.review_merchant_application(uuid,text,text) from public, anon;
grant execute on function public.review_merchant_application(uuid,text,text) to authenticated;
