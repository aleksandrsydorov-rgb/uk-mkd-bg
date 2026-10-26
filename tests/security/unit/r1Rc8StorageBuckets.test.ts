import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
} from '@/lib/moduleCore';
import {
  BUILDING_DOCUMENTS_BUCKET,
} from '@/lib/buildingDocuments';
import {
  CHAT_FILES_BUCKET,
  EXPENSE_RECEIPTS_BUCKET,
  INVENTORY_DOCUMENTS_BUCKET,
  POLL_IMAGES_BUCKET,
  REQUEST_PHOTOS_BUCKET,
} from '@/lib/privateMedia';

const REQUIRED_BUCKETS = [
  REQUEST_PHOTOS_BUCKET,
  CHAT_FILES_BUCKET,
  EXPENSE_RECEIPTS_BUCKET,
  POLL_IMAGES_BUCKET,
  BUILDING_DOCUMENTS_BUCKET,
  INVENTORY_DOCUMENTS_BUCKET,
] as const;

const PKG = '98_storage_buckets_baseline.sql';
const MIG = 'supabase/migrations/20261122120000_r1_rc8_storage_buckets_baseline.sql';

describe('R1-RC8 storage buckets distributive baseline', () => {
  it('app storage constants match the six private buckets', () => {
    expect(REQUIRED_BUCKETS).toEqual([
      'request-photos',
      'chat-files',
      'uk-expense-receipts',
      'poll-images',
      'building-documents',
      'inventory-documents',
    ]);
  });

  it('fresh-install packages storage baseline after meetings restore', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain(PKG);
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('97_r1_rc8_restore_general_meeting.sql'),
    );
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('05_auth_staff_helpers.sql'),
    );
  });

  it('package SQL creates all buckets private with limits and policies', () => {
    const sql = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, PKG),
      'utf8',
    );
    for (const id of REQUIRED_BUCKETS) {
      expect(sql).toContain(`'${id}'`);
    }
    expect(sql).toMatch(/set public = false/);
    expect(sql).toMatch(/false,\s*10485760/);
    expect(sql).toMatch(/false,\s*20971520/);
    expect(sql).not.toMatch(/set public = true/);
    expect(sql).toMatch(/file_size_limit/);
    expect(sql).toMatch(/allowed_mime_types/);
    expect(sql).toMatch(/can_read_building_document_path/);
    expect(sql).toMatch(/can_read_request_photo/);
    expect(sql).toMatch(/can_read_chat_file/);
    expect(sql).toMatch(/building_documents_storage_select/);
    expect(sql).toMatch(/building_documents_storage_insert/);
    expect(sql).toMatch(/inventory_documents_storage_select/);
    expect(sql).toMatch(/request_photos_select/);
    expect(sql).toMatch(/chat_files_select/);
    expect(sql).toMatch(/and public\.can_read_building_document_path\(name\)/);
    expect(sql).not.toMatch(/or exists \(\s*select 1 from public\.building_documents/);
    expect(sql).not.toMatch(/is_staff\(\) or public\.is_owner\(\)/);
    expect(sql).toMatch(/storage\.objects/);
    expect(sql).not.toMatch(/alter table storage\.objects enable row level security/i);
  });

  it('chronological migration mirrors package and is inventoried', () => {
    const mig = readFileSync(path.join(process.cwd(), MIG), 'utf8');
    for (const id of REQUIRED_BUCKETS) {
      expect(mig).toContain(`'${id}'`);
    }
    expect(mig).toMatch(/on conflict \(id\) do update/);

    const manifest = JSON.parse(
      readFileSync(
        path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'),
        'utf8',
      ),
    ) as {
      orderedFiles: string[];
      chronologicalMigrationsPackaged: string[];
      chronologicalMigrationTree: string[];
      expectedChronologicalMigrationCount: number;
    };
    expect(manifest.orderedFiles).toContain(PKG);
    expect(manifest.chronologicalMigrationsPackaged).toContain(MIG);
    expect(manifest.chronologicalMigrationTree).toContain(MIG);
    expect(manifest.expectedChronologicalMigrationCount).toBe(
      manifest.chronologicalMigrationTree.length,
    );
  });
});
