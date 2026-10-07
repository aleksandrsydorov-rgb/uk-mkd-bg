-- Allow draft metadata writes for meeting_type (Meeting Core).
-- Column-level grants from SH-2C2 omitted meeting_type; UI now sets it on create/save.

grant update (meeting_type) on table public.general_meetings to authenticated;
grant insert (meeting_type) on table public.general_meetings to authenticated;
