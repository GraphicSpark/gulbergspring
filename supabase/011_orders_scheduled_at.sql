-- =============================================================================
-- GraphicSpark CRM - optional booking date & time on an order
--   (applied 2026-08-28; migration crm_orders_scheduled_at)
--
--   orders.scheduled_at = when the customer is booked in for the service.
--   Nullable / optional - the Add Order form has a "Date & time (optional)" field.
-- =============================================================================

alter table public.orders
  add column if not exists scheduled_at timestamptz;
