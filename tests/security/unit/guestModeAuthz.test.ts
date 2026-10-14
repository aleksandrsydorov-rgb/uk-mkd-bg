import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canGuestInsertChat,
  canGuestInsertRequest,
  canOwnerInsertChat,
  guestCabinetAllows,
  GUEST_MAX_ACTIVE_PER_PROPERTY,
  GUEST_RELATION_TYPES,
  isGuestAccessTemporallyValid,
  isGuestChatSender,
  isResidentChatSender,
  pickGuestAccessForProperty,
  requiresValidUntil,
  wouldExceedGuestLimit,
  type GuestAccessContext,
} from '@/lib/guestMode';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261021120000_guest_mode_completion.sql',
);

describe('Guest Mode · relation categories', () => {
  it('covers the four approved guest categories', () => {
    expect([...GUEST_RELATION_TYPES]).toEqual([
      'living_with_owner',
      'co_owner',
      'long_term_tenant',
      'short_term_tenant',
    ]);
  });

  it('requires end date only for short-term tenants', () => {
    expect(requiresValidUntil('short_term_tenant')).toBe(true);
    expect(requiresValidUntil('long_term_tenant')).toBe(false);
    expect(requiresValidUntil('living_with_owner')).toBe(false);
    expect(requiresValidUntil('co_owner')).toBe(false);
  });
});

describe('Guest Mode · cabinet permissions', () => {
  it('allows requests, security, services overview, and chat', () => {
    expect(guestCabinetAllows('maintenance_requests')).toBe(true);
    expect(guestCabinetAllows('security_requests')).toBe(true);
    expect(guestCabinetAllows('available_services_overview')).toBe(true);
    expect(guestCabinetAllows('guest_chat')).toBe(true);
  });

  it('denies meters, finance, voting, book edit, other apartments, polls, meetings', () => {
    expect(guestCabinetAllows('meter_readings')).toBe(false);
    expect(guestCabinetAllows('finance')).toBe(false);
    expect(guestCabinetAllows('owner_voting')).toBe(false);
    expect(guestCabinetAllows('property_book_edit')).toBe(false);
    expect(guestCabinetAllows('other_apartments')).toBe(false);
    expect(guestCabinetAllows('polls')).toBe(false);
    expect(guestCabinetAllows('announcements')).toBe(false);
    expect(guestCabinetAllows('general_meetings')).toBe(false);
  });
});

describe('Guest Mode · chat / request insert policy mirrors', () => {
  it('allows guest chat only with active access and guest sender + access id', () => {
    expect(
      canGuestInsertChat({
        isGuestOnlyOnProperty: true,
        accessActive: true,
        sender: 'guest',
        guestAccessId: 'access-1',
      }),
    ).toBe(true);
    expect(
      canGuestInsertChat({
        isGuestOnlyOnProperty: true,
        accessActive: true,
        sender: 'owner',
        guestAccessId: 'access-1',
      }),
    ).toBe(false);
    expect(
      canGuestInsertChat({
        isGuestOnlyOnProperty: true,
        accessActive: false,
        sender: 'guest',
        guestAccessId: 'access-1',
      }),
    ).toBe(false);
    expect(
      canGuestInsertChat({
        isGuestOnlyOnProperty: true,
        accessActive: true,
        sender: 'guest',
        guestAccessId: null,
      }),
    ).toBe(false);
  });

  it('keeps owner chat insert on owns_property + sender owner', () => {
    expect(canOwnerInsertChat({ ownsProperty: true, sender: 'owner' })).toBe(true);
    expect(canOwnerInsertChat({ ownsProperty: false, sender: 'owner' })).toBe(false);
    expect(canOwnerInsertChat({ ownsProperty: true, sender: 'guest' })).toBe(false);
  });

  it('allows guest request insert only with created_by_role=guest', () => {
    expect(
      canGuestInsertRequest({
        isGuestOnlyOnProperty: true,
        accessActive: true,
        createdByRole: 'guest',
      }),
    ).toBe(true);
    expect(
      canGuestInsertRequest({
        isGuestOnlyOnProperty: true,
        accessActive: true,
        createdByRole: 'owner',
      }),
    ).toBe(false);
  });

  it('distinguishes guest vs owner chat senders', () => {
    expect(isGuestChatSender('guest')).toBe(true);
    expect(isGuestChatSender('owner')).toBe(false);
    expect(isResidentChatSender('guest')).toBe(true);
    expect(isResidentChatSender('owner')).toBe(true);
    expect(isResidentChatSender('uk')).toBe(false);
  });
});

describe('Guest Mode · limits and expiry', () => {
  it('enforces max 2 active guests', () => {
    expect(GUEST_MAX_ACTIVE_PER_PROPERTY).toBe(2);
    expect(wouldExceedGuestLimit(0)).toBe(false);
    expect(wouldExceedGuestLimit(1)).toBe(false);
    expect(wouldExceedGuestLimit(2)).toBe(true);
    expect(wouldExceedGuestLimit(1, 2)).toBe(true);
  });

  it('treats expired or revoked access as inactive', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(
      isGuestAccessTemporallyValid({
        status: 'active',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2026-12-31T00:00:00Z',
        now,
      }),
    ).toBe(true);
    expect(
      isGuestAccessTemporallyValid({
        status: 'active',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2026-10-01T00:00:00Z',
        now,
      }),
    ).toBe(false);
    expect(
      isGuestAccessTemporallyValid({
        status: 'revoked',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: null,
        now,
      }),
    ).toBe(false);
    expect(
      isGuestAccessTemporallyValid({
        status: 'expired',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2026-12-31T00:00:00Z',
        now,
      }),
    ).toBe(false);
  });

  it('picks guest context only for the selected apartment', () => {
    const rows: GuestAccessContext[] = [
      {
        access_id: 'a1',
        property_id: 10,
        apartment_number: '101',
        relation_type: 'long_term_tenant',
        valid_from: '2026-01-01T00:00:00Z',
        valid_until: null,
        email: 'g@example.com',
      },
      {
        access_id: 'a2',
        property_id: 20,
        apartment_number: '202',
        relation_type: 'short_term_tenant',
        valid_from: '2026-01-01T00:00:00Z',
        valid_until: '2026-11-01T00:00:00Z',
        email: 'g@example.com',
      },
    ];
    expect(pickGuestAccessForProperty(rows, 20)?.access_id).toBe('a2');
    expect(pickGuestAccessForProperty(rows, 99)).toBeNull();
  });
});

describe('Guest Mode · completion migration evidence', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('adds DB max-2 trigger, unique active email, and expire-on-write path', () => {
    expect(sql).toContain('trg_property_guest_accesses_enforce');
    expect(sql).toContain('max 2 active guests per property');
    expect(sql).toContain('property_guest_accesses_one_active_email_uidx');
    expect(sql).toContain('guest_access_expire_stale');
  });

  it('adds guest insert policies and chat guest identity columns', () => {
    expect(sql).toContain('requests_owner_guest_insert');
    expect(sql).toContain('chat_messages_owner_guest_insert');
    expect(sql).toContain('guest_access_id');
    expect(sql).toContain("sender = 'guest'");
    expect(sql).toContain("created_by_role = 'guest'");
  });

  it('extends storage helpers and security creator role to guests', () => {
    expect(sql).toContain('has_active_guest_access(v_property_id)');
    expect(sql).toContain('has_active_guest_access(m.property_id)');
    expect(sql).toContain("p_created_by_role not in ('owner', 'admin', 'guest')");
    expect(sql).toContain("v_role := 'guest'");
  });

  it('exposes guest context RPCs for UI labeling', () => {
    expect(sql).toContain('get_my_active_guest_access');
    expect(sql).toContain('list_my_guest_access_contexts');
    expect(sql).toContain('guest_mode_module_enabled');
  });

  it('requires short_term_tenant valid_until at RPC level', () => {
    expect(sql).toContain('short_term_tenant requires valid_until');
  });
});
