-- SH-2D low hardening: excess grant reduction and storage MIME/size limits.
-- Does not change business logic, finance calculations, or GM lifecycle/quorum/voting.
-- Does not modify application row data.

begin;

-- ---------------------------------------------------------------------------
-- L2. PostgREST-unused table privileges on GM / document tables
-- ---------------------------------------------------------------------------

revoke truncate, trigger, references on table public.building_documents from authenticated;
revoke truncate, trigger, references on table public.general_meetings from authenticated;
revoke truncate, trigger, references on table public.general_meeting_agenda_items from authenticated;
revoke truncate, trigger, references on table public.general_meeting_decisions from authenticated;
revoke truncate, trigger, references on table public.general_meeting_files from authenticated;
revoke truncate, trigger, references on table public.general_meeting_online_links from authenticated;
revoke truncate, trigger, references on table public.general_meeting_participants from authenticated;
revoke truncate, trigger, references on table public.general_meeting_quorum_checks from authenticated;
revoke truncate, trigger, references on table public.general_meeting_vote_events from authenticated;
revoke truncate, trigger, references on table public.general_meeting_votes from authenticated;

-- Trigger-only lock. SECURITY DEFINER; return type trigger. No frontend RPC.
revoke all on function public.protect_meeting_results_lock() from public;
revoke execute on function public.protect_meeting_results_lock() from anon, authenticated;

-- Formula helpers. No frontend/API caller. Inner SECURITY DEFINER RPCs
-- still execute them as the function owner.
revoke all on function public.gm_threshold_met(numeric, text, numeric) from public;
revoke execute on function public.gm_threshold_met(numeric, text, numeric)
  from anon, authenticated;

revoke all on function public.gm_quorum_required_percent(text, text) from public;
revoke execute on function public.gm_quorum_required_percent(text, text)
  from anon, authenticated;

revoke all on function public.gm_apply_majority_preset(text) from public;
revoke execute on function public.gm_apply_majority_preset(text)
  from anon, authenticated;

-- No public-table grants to anon. No anonymous INSERT path. Authenticated
-- USAGE/SELECT/UPDATE on these sequences stay in place for identity inserts.
revoke usage, select, update on sequence
  public.announcements_id_seq,
  public.apartment_guests_id_seq,
  public.apartment_pets_id_seq,
  public.chat_messages_id_seq,
  public.meter_readings_id_seq,
  public.n525_commands_id_seq,
  public.owner_email_id_seq,
  public.owner_transfers_id_seq,
  public.poll_options_id_seq,
  public.poll_suggestions_id_seq,
  public.poll_vote_history_id_seq,
  public.poll_votes_id_seq,
  public.polls_id_seq,
  public.properties_id_seq,
  public.property_absence_periods_id_seq,
  public.property_registry_people_id_seq,
  public.staff_id_seq,
  public.support_fee_ledger_id_seq,
  public.uk_expenses_id_seq
from anon;

-- ---------------------------------------------------------------------------
-- L3. Bucket upload limits. Existing objects are compatible (empty media
-- buckets; building-documents has 3 application/pdf objects, max 742177 bytes).
-- ---------------------------------------------------------------------------

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/bmp'
  ]
where id in ('request-photos', 'poll-images', 'uk-expense-receipts');

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
where id = 'chat-files';

update storage.buckets
set
  file_size_limit = 20971520,
  allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
where id = 'building-documents';

commit;
