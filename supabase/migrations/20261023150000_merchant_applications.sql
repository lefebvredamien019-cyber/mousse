create table if not exists public.merchant_applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null,
  legal_name text not null default '',
  siret text not null,
  category text not null,
  manager_name text not null,
  business_email text not null,
  phone text not null default '',
  website text not null default '',
  address text not null,
  postal_code text not null,
  city text not null,
  network text not null default '',
  link_request boolean not null default false,
  opening_hours text not null default '',
  description text not null default '',
  products_services text not null default '',
  requested_tools text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','submitted','resubmitted','changes_requested','approved','rejected')),
  review_note text not null default '',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_applications_siret_check check (siret ~ '^[0-9]{14}$')
);

alter table public.merchant_applications enable row level security;
grant select, insert, update on public.merchant_applications to authenticated;

drop policy if exists "owners read own merchant application" on public.merchant_applications;
create policy "owners read own merchant application"
  on public.merchant_applications for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "owners create own merchant application" on public.merchant_applications;
create policy "owners create own merchant application"
  on public.merchant_applications for insert to authenticated
  with check (owner_id = (select auth.uid()) and status in ('draft','submitted'));

drop policy if exists "owners update own merchant application" on public.merchant_applications;
create policy "owners update own merchant application"
  on public.merchant_applications for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create or replace function public.guard_merchant_application_review_fields()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = old.owner_id then
    if new.status not in ('draft','submitted','resubmitted') then
      raise exception 'Application review status can only be changed by MOUSSE reviewers';
    end if;
    if new.review_note is distinct from old.review_note or new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'Application review fields are read-only';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_applications_guard_review_fields on public.merchant_applications;
create trigger merchant_applications_guard_review_fields
  before update on public.merchant_applications
  for each row execute function public.guard_merchant_application_review_fields();
