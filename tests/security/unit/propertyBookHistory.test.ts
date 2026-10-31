import { describe, expect, it } from 'vitest';
import {
  presentPropertyBookHistoryEntry,
  propertyBookHistoryDetails,
  propertyBookHistoryTitle,
} from '@/lib/propertyBookHistory';

const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    key,
  );
};

describe('propertyBookHistory presentation', () => {
  it('titles property updates with apartment number', () => {
    expect(
      propertyBookHistoryTitle(
        { entity: 'property', action: 'update', changes: {} },
        '15',
        t,
      ),
    ).toBe('admin.bookHistoryTitlePropertyUpdate');
    // reduce keeps key; ensure params applied when message has placeholder
    const titled = t('Изменены данные апартамента №{n}', { n: '15' });
    expect(titled).toBe('Изменены данные апартамента №15');
  });

  it('humanizes field diffs without JSON dumps', () => {
    const lines = propertyBookHistoryDetails(
      {
        entity: 'property',
        action: 'update',
        changes: {
          area_sqm: { old: 48, new: 52.5 },
          ownership_type: { old: 'sole', new: 'shared' },
        },
      },
      t,
    );
    expect(lines).toEqual([
      'admin.bookHistoryDetailChange',
      'admin.bookHistoryDetailChange',
    ]);
    expect(
      t('admin.bookHistoryDetailChange', {
        field: 'Площадь',
        from: '48',
        to: '52.5',
      }),
    ).toBe('admin.bookHistoryDetailChange');
  });

  it('presents compact owner insert snapshot', () => {
    const presented = presentPropertyBookHistoryEntry(
      {
        id: '1',
        changed_at: '2026-01-02T10:00:00Z',
        changed_by_email: 'admin@example.com',
        entity: 'owner',
        action: 'insert',
        changes: {
          snapshot: {
            first_name: 'Иван',
            last_name: 'Петров',
            email: 'ivan@example.com',
          },
        },
      },
      '15',
      t,
    );
    expect(presented.title).toBe('admin.bookHistoryTitleOwnerAddApt');
    expect(presented.details[0]).toBe('admin.bookHistoryDetailOwnerSnapshot');
  });

  it('applies apartment placeholder in real copy shape', () => {
    expect(
      presentPropertyBookHistoryEntry(
        {
          id: '2',
          changed_at: '2026-01-02T10:00:00Z',
          changed_by_email: null,
          entity: 'property',
          action: 'update',
          changes: { floor: { old: 2, new: 3 } },
        },
        '15',
        (key, params) => {
          const catalog: Record<string, string> = {
            'admin.bookHistoryTitlePropertyUpdate': 'Изменены данные апартамента №{n}',
            'admin.bookHistoryDetailChange': '{field}: {from} → {to}',
            'admin.bookHistFieldFloor': 'Этаж',
            'admin.bookHistEmptyValue': '—',
          };
          const template = catalog[key] ?? key;
          if (!params) return template;
          return Object.entries(params).reduce(
            (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
            template,
          );
        },
      ),
    ).toEqual({
      title: 'Изменены данные апартамента №15',
      details: ['Этаж: 2 → 3'],
    });
  });
});
