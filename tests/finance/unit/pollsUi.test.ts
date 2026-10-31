import { describe, expect, it } from 'vitest';
import {
  pollAdminLifecycle,
  pollAdminLifecycleLabelKey,
  pollCardSummary,
  pollDecisionTone,
  validatePollCreateInput,
} from '@/lib/pollsUi';
import type { Poll } from '@/lib/polls';

describe('Task 17 · polls UI helpers', () => {
  const base: Poll = {
    id: 1,
    created_at: '2026-01-01T00:00:00Z',
    title: 'Test',
    body: null,
    category: 'опрос',
    status: 'открыт',
    deadline: '2099-12-31',
    created_by: 'УК',
    voting_starts: '2020-01-01',
    result: 'идёт',
  };

  it('maps lifecycle and decision tones without changing tally rules', () => {
    expect(pollAdminLifecycle(base)).toBe('open');
    expect(pollAdminLifecycle({ ...base, status: 'закрыт' })).toBe('closed');
    expect(pollAdminLifecycleLabelKey('scheduled')).toBe('admin.pollLifeScheduled');
    expect(pollDecisionTone('принято')).toBe('success');
    expect(pollDecisionTone('идёт')).toBe('warning');
  });

  it('summarizes cards and validates create input', () => {
    const summary = pollCardSummary(
      base,
      [
        { id: 10, poll_id: 1, label: 'За', sort_order: 0 },
        { id: 11, poll_id: 1, label: 'Против', sort_order: 1 },
      ],
      [{ id: 1, created_at: '2026-01-02', poll_id: 1, option_id: 10, property_id: 5, weight: 40 }],
      [{ id: 5, area_sqm: 40 }],
    );
    expect(summary.voteCount).toBe(1);
    expect(summary.leadingLabel).toBe('За');
    expect(summary.decision).toBe('принято');

    expect(validatePollCreateInput({ title: '', options: ['A', 'B'] })).toEqual({
      ok: false,
      errorKey: 'admin.pollErrTitle',
    });
    expect(validatePollCreateInput({ title: 'T', options: ['A'] })).toEqual({
      ok: false,
      errorKey: 'admin.pollErrOptions',
    });
    expect(validatePollCreateInput({ title: 'T', options: ['A', 'B'] })).toEqual({ ok: true });
  });
});
