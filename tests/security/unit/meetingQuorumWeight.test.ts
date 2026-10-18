import { describe, expect, it } from 'vitest';
import {
  MEETING_QUORUM_RULES,
  majorityRuleForDecisionCategory,
  majoritySatisfied,
  mandatoryAgendaForType,
  quorumMet,
} from '@/lib/meetingCore';

describe('P1-MT · Meeting Core quorum / weight regression', () => {
  it('packages BG_ZUES_2026_09 quorum thresholds', () => {
    expect(MEETING_QUORUM_RULES.quorum_initial_percent).toBe(51);
    expect(MEETING_QUORUM_RULES.quorum_dominant_initial_percent).toBe(75);
    expect(MEETING_QUORUM_RULES.quorum_after_one_hour_percent).toBe(26);
    expect(MEETING_QUORUM_RULES.dominant_owner_threshold_percent).toBe(51);
  });

  it('quorumMet: initial 51% inclusive on ideal parts', () => {
    expect(quorumMet(51, 100, MEETING_QUORUM_RULES.quorum_initial_percent)).toBe(true);
    expect(quorumMet(50.9, 100, MEETING_QUORUM_RULES.quorum_initial_percent)).toBe(false);
    expect(quorumMet(0, 100, MEETING_QUORUM_RULES.quorum_initial_percent)).toBe(false);
    expect(quorumMet(26, 100, MEETING_QUORUM_RULES.quorum_after_one_hour_percent)).toBe(true);
    expect(quorumMet(25.9, 100, MEETING_QUORUM_RULES.quorum_after_one_hour_percent)).toBe(false);
  });

  it('majoritySatisfied: more_than_50_all vs represented', () => {
    // 40 yes of 100 all — fails all-parts, passes if only 70 represented
    expect(
      majoritySatisfied('more_than_50_all_ideal_parts', 40, 70, 100),
    ).toBe(false);
    expect(
      majoritySatisfied('more_than_50_represented_ideal_parts', 40, 70, 100),
    ).toBe(true);
    expect(
      majoritySatisfied('more_than_50_all_ideal_parts', 50.1, 50.1, 100),
    ).toBe(true);
    expect(
      majoritySatisfied('more_than_50_all_ideal_parts', 50, 50, 100),
    ).toBe(false);
  });

  it('majoritySatisfied: 75% and unanimous codes', () => {
    expect(majoritySatisfied('at_least_75_all_ideal_parts', 75, 75, 100)).toBe(true);
    expect(majoritySatisfied('at_least_75_all_ideal_parts', 74.9, 74.9, 100)).toBe(false);
    expect(majoritySatisfied('unanimous_all_ideal_parts', 100, 100, 100)).toBe(true);
    expect(majoritySatisfied('unanimous_all_ideal_parts', 99.9, 99.9, 100)).toBe(false);
  });

  it('mandatory agenda: budget_approval uses all ideal parts; procedural uses represented', () => {
    expect(majorityRuleForDecisionCategory('budget_approval')).toBe(
      'more_than_50_all_ideal_parts',
    );
    expect(majorityRuleForDecisionCategory('procedural')).toBe(
      'more_than_50_represented_ideal_parts',
    );
    const reporting = mandatoryAgendaForType('REPORTING');
    const budget = reporting.find((r) => r.decision_category === 'budget_approval');
    expect(budget?.majority_rule).toBe('more_than_50_all_ideal_parts');
    const chair = reporting.find((r) => r.key === 'chair');
    expect(chair?.majority_rule).toBe('more_than_50_represented_ideal_parts');
  });

  it('unknown majority rule never silently passes', () => {
    expect(majoritySatisfied('invented_rule', 100, 100, 100)).toBe(false);
  });
});
