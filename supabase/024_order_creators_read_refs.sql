-- =============================================================================
-- GraphicSpark CRM - let anyone who works with orders read the reference lists
--   (migration crm_order_creators_read_refs)
--
-- The Add / Edit Order form needs the list of `accounts` and the client's
-- `client_packages` menu. Their SELECT policies only allowed `accounts.view` /
-- `packages.view`, so an agent who can create orders but is NOT meant to see the
-- Accounts / Packages *pages* got empty dropdowns (and a blank Account column on
-- the Orders list).
--
-- Fix: also allow `orders.view`. The nav / page gating in the UI is unchanged
-- (still `can('accounts','view')` / `can('packages','view')`), so those pages
-- stay hidden - only the order screens can now load the lists they reference.
-- Neither list is sensitive (an order-creator already sees package rates in the
-- Add Order package picker).
-- =============================================================================

drop policy if exists acc_select on public.accounts;
create policy acc_select on public.accounts for select to authenticated
  using (
    private.is_active_user() and (
      private.has_perm('accounts', 'view')
      or private.has_perm('orders', 'view')
    )
  );

drop policy if exists cp_select on public.client_packages;
create policy cp_select on public.client_packages for select to authenticated
  using (
    private.is_active_user() and (
      private.has_perm('packages', 'view')
      or private.has_perm('orders', 'view')
    )
  );
