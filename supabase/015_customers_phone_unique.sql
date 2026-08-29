-- =============================================================================
-- GraphicSpark CRM - one customer per phone number
--   (applied 2026-08-29; migration crm_customers_phone_unique)
--
--   `customers.phone` is the natural key. Partial unique index (the column is
--   nullable; only non-null values must be unique). Duplicate insert/update
--   now fails with 23505 -> the UI shows "A customer with this number already
--   exists" (Add/Edit form does a proactive check first; CSV import skips
--   already-registered numbers).
-- =============================================================================

create unique index if not exists customers_phone_uniq
  on public.customers (phone) where phone is not null;
