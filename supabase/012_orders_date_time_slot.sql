-- =============================================================================
-- GraphicSpark CRM - split the optional booking "date & time" into two fields
--   (applied 2026-08-28; migration crm_orders_split_date_time_slot)
--
--   orders.scheduled_date = date     (optional)
--   orders.scheduled_time = time     (optional, a 30-min slot e.g. 12:30:00)
--   Replaces the earlier single `scheduled_at timestamptz` (011).
--   The Add/Edit Order form picks a date + a grouped time slot
--   (Early Morning / Morning / Noon / Afternoon / Evening / Night) -
--   slot list in src/lib/slots.js.
-- =============================================================================

alter table public.orders drop column if exists scheduled_at;

alter table public.orders
  add column if not exists scheduled_date date,
  add column if not exists scheduled_time time;
