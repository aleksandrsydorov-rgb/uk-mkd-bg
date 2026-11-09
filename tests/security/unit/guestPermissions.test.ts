import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  emptyGuestPermissions,
  filterGrantableActions,
  guestPermissionsNonempty,
  guestPermissionsSelected,
  parseGuestPermissions,
  permissionsPayload,
  toggleGuestPermission,
} from '@/lib/guestPermissions';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261130230000_r1_rc8_guest_permissions.sql',
);

describe('Guest permissions catalog', () => {
  it('defaults to empty (nothing allowed)', () => {
    expect(guestPermissionsNonempty(emptyGuestPermissions())).toBe(false);
    expect(guestPermissionsSelected(parseGuestPermissions({}))).toEqual([]);
  });

  it('ignores unknown / forbidden keys from client payload', () => {
    const parsed = parseGuestPermissions({
      'water.submit_readings': true,
      finance: true,
      owner_voting: true,
      'chat.with_uk': 'yes',
    });
    expect(parsed).toEqual({ 'water.submit_readings': true });
    expect(permissionsPayload(parsed)).toEqual({ 'water.submit_readings': true });
  });

  it('only lists grantable actions for enabled modules', () => {
    const actions = filterGrantableActions(['water', 'chat']);
    const keys = actions.map((a) => a.action);
    expect(keys).toContain('water.submit_readings');
    expect(keys).toContain('chat.with_uk');
    expect(keys).toContain('services.overview');
    expect(keys).not.toContain('electricity.submit_readings');
    expect(keys).not.toContain('security.own');
  });

  it('toggles without mutating previous object', () => {
    const base = emptyGuestPermissions();
    const next = toggleGuestPermission(base, 'requests.own', true);
    expect(base).toEqual({});
    expect(next).toEqual({ 'requests.own': true });
    expect(toggleGuestPermission(next, 'requests.own', false)).toEqual({});
  });
});

describe('Guest permissions migration evidence', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('stores permissions jsonb default empty and sanitizes grants', () => {
    expect(sql).toContain('add column if not exists permissions jsonb not null default');
    expect(sql).toContain('guest_sanitize_permissions');
    expect(sql).toContain('guest_has_action');
    expect(sql).toContain('select at least one permission');
  });

  it('scopes RLS to action + own guest rows / chat thread', () => {
    expect(sql).toContain("guest_has_action(property_id, 'requests.own')");
    expect(sql).toContain("guest_has_action(property_id, 'chat.with_uk')");
    expect(sql).toContain('guest_caller_access_id(property_id)');
    expect(sql).toContain("guest_has_action(property_id, 'security.own')");
  });

  it('requires guest_visible for announcements/documents and patches meter submit', () => {
    expect(sql).toContain('guest_visible');
    expect(sql).toContain("guest_has_action(p_property_id, 'water.submit_readings')");
    expect(sql).toContain("guest_has_action(p_property_id, 'electricity.submit_readings')");
    expect(sql).toContain('guest_list_meters_for_submit');
  });
});
