import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  INV3_BUCKET,
  INV3_MAX_BYTES,
  INV3_MIGRATION,
  analyzeInv3MigrationSql,
  buildInventoryDocumentPath,
  concurrentFindingPhotosDoNotCollide,
  inventoryFileSizeOk,
  inventoryMimeAllowed,
  inventoryObjectNameOk,
  inventorySafeFilename,
} from '@/lib/inventory';

const MIGRATION = path.resolve(process.cwd(), INV3_MIGRATION);

function sql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

describe('INV-3 · migration packaging', () => {
  it('orders after INV-2 and defines private bucket + RPCs', () => {
    const names = readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    expect(names).toContain('20261102120000_inv3_inventory_documents_storage.sql');
    expect(names.indexOf('20261102120000_inv3_inventory_documents_storage.sql')).toBeGreaterThan(
      names.indexOf('20261101120000_inv2_inventory_operations.sql'),
    );
    const a = analyzeInv3MigrationSql(sql());
    expect(a.missingRpcs).toEqual([]);
    expect(a.hasBucket).toBe(true);
    expect(a.bucketIsPrivate).toBe(true);
    expect(a.hasPathHelpers).toBe(true);
    expect(a.hasRegisterRpc).toBe(true);
    expect(a.hasArchiveSupersede).toBe(true);
    expect(a.hasStoragePolicies).toBe(true);
    expect(a.noPublicUrls).toBe(true);
    expect(a.noFinanceSideEffects).toBe(true);
    expect(a.moduleNotAutoEnabled).toBe(true);
    expect(sql()).toContain(INV3_BUCKET);
    expect(sql()).toContain('public = false');
  });

  it('denies owners by default and blocks direct client metadata writes', () => {
    const text = sql();
    expect(text).toMatch(/Owners have no inventory document access/i);
    expect(text).toContain('revoke insert, update, delete on table public.inventory_documents');
    expect(text).toContain('inventory_documents_storage_update');
    expect(text).toContain('using (false)');
  });
});

describe('INV-3 · path isolation & upload rules', () => {
  it('accepts canonical paths and rejects traversal / wrong shape', () => {
    const ok = buildInventoryDocumentPath({
      installKey: 'default',
      scope: 'asset',
      targetId: UUID_A,
      fileId: UUID_B,
      extension: 'jpg',
    });
    expect(inventoryObjectNameOk(ok)).toBe(true);
    expect(inventoryObjectNameOk('inventory/default/asset/../etc/passwd')).toBe(false);
    expect(inventoryObjectNameOk(`inventory/other/asset/${UUID_A}/${UUID_B}.jpg`)).toBe(true);
    expect(inventoryObjectNameOk(`building-documents/${UUID_A}.pdf`)).toBe(false);
    expect(inventoryObjectNameOk(`inventory/default/asset/${UUID_A}/not-a-uuid.jpg`)).toBe(false);
  });

  it('rejects unsupported MIME and oversized files', () => {
    expect(inventoryMimeAllowed('image/jpeg')).toBe(true);
    expect(inventoryMimeAllowed('application/pdf')).toBe(true);
    expect(inventoryMimeAllowed('application/x-msdownload')).toBe(false);
    expect(inventoryMimeAllowed('text/html')).toBe(false);
    expect(inventoryFileSizeOk(1024)).toBe(true);
    expect(inventoryFileSizeOk(INV3_MAX_BYTES)).toBe(true);
    expect(inventoryFileSizeOk(INV3_MAX_BYTES + 1)).toBe(false);
    expect(inventoryFileSizeOk(-1)).toBe(false);
  });

  it('sanitizes filenames', () => {
    expect(inventorySafeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(inventorySafeFilename('Act №1.pdf')).toMatch(/Act/);
    expect(inventorySafeFilename('')).toBe('file');
  });
});

describe('INV-3 · multi-user finding photos', () => {
  it('unique file ids never collide (no accidental replacement)', () => {
    const p1 = buildInventoryDocumentPath({
      installKey: 'default',
      scope: 'session-item',
      targetId: UUID_A,
      fileId: UUID_B,
      extension: 'jpg',
    });
    const p2 = buildInventoryDocumentPath({
      installKey: 'default',
      scope: 'session-item',
      targetId: UUID_A,
      fileId: UUID_C,
      extension: 'jpg',
    });
    expect(concurrentFindingPhotosDoNotCollide([p1, p2])).toBe(true);
    expect(concurrentFindingPhotosDoNotCollide([p1, p1])).toBe(false);
  });
});

describe('INV-3 · history & finance markers', () => {
  it('preserves docs across lifecycle via soft archive / supersede', () => {
    const text = sql();
    expect(text).toContain('archived_at');
    expect(text).toContain('superseded_by_id');
    expect(text).toContain('inventory_archive_document');
    expect(text).toContain('inventory_supersede_document');
    expect(text).toContain('document_added');
    expect(text).not.toMatch(/insert into public\.uk_expenses\b/i);
    expect(text).not.toMatch(/charge_support_fee/i);
  });
});
