-- =====================================================================
--  WhatsApp gateway mode (GREEN-API). Run once, after messaging.sql.
--  Adds the "gateway" sending mode plus a daily limit and a gap between
--  messages, so a linked number sends slowly and looks human.
-- =====================================================================
alter type public.whatsapp_mode add value if not exists 'gateway';

alter table public.messaging_settings
  add column if not exists whatsapp_daily_limit integer not null default 120
    check (whatsapp_daily_limit between 1 and 1000),
  add column if not exists whatsapp_gap_seconds integer not null default 8
    check (whatsapp_gap_seconds between 5 and 120);
