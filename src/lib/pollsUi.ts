/**
 * Task 17 — Polls admin presentation helpers only.
 * Does not change voting, tally rules, or access control.
 */

import {
  isPollAcceptingVotes,
  pollDecisionLabel,
  tallyPoll,
  type AreaShare,
  type Poll,
  type PollOption,
  type PollResult,
  type PollVote,
} from '@/lib/polls';

export type PollAdminLifecycle = 'open' | 'scheduled' | 'closed' | 'finished';

export function pollAdminLifecycle(poll: Poll): PollAdminLifecycle {
  if (poll.status === 'закрыт') return 'closed';
  if (poll.result === 'принято' || poll.result === 'не принято') return 'finished';
  if (isPollAcceptingVotes(poll)) return 'open';
  return 'scheduled';
}

export function pollAdminLifecycleLabelKey(life: PollAdminLifecycle): string {
  if (life === 'open') return 'admin.pollLifeOpen';
  if (life === 'scheduled') return 'admin.pollLifeScheduled';
  if (life === 'closed') return 'admin.pollLifeClosed';
  return 'admin.pollLifeFinished';
}

export function pollAdminLifecycleTone(
  life: PollAdminLifecycle,
): 'info' | 'warning' | 'neutral' | 'success' {
  if (life === 'open') return 'info';
  if (life === 'scheduled') return 'warning';
  if (life === 'finished') return 'success';
  return 'neutral';
}

export function pollDecisionTone(
  decision: PollResult,
): 'success' | 'danger' | 'warning' {
  if (decision === 'принято') return 'success';
  if (decision === 'не принято') return 'danger';
  return 'warning';
}

export function pollCardSummary(
  poll: Poll,
  options: PollOption[],
  votes: PollVote[],
  properties: AreaShare[],
): {
  lifecycle: PollAdminLifecycle;
  decision: PollResult;
  voteCount: number;
  leadingLabel: string | null;
  leadingPct: number | null;
} {
  const relatedVotes = votes.filter((v) => v.poll_id === poll.id);
  const relatedOptions = options.filter((o) => o.poll_id === poll.id);
  const tally = tallyPoll(relatedOptions, relatedVotes, properties);
  const decision = pollDecisionLabel(poll, tally.accepted);
  return {
    lifecycle: pollAdminLifecycle(poll),
    decision,
    voteCount: relatedVotes.length,
    leadingLabel: tally.winner?.option.label ?? null,
    leadingPct: tally.winner ? tally.winner.pctOfTotal : null,
  };
}

export function validatePollCreateInput(input: {
  title: string;
  options: string[];
}): { ok: true } | { ok: false; errorKey: string } {
  if (!String(input.title ?? '').trim()) {
    return { ok: false, errorKey: 'admin.pollErrTitle' };
  }
  const opts = input.options.map((o) => String(o ?? '').trim()).filter(Boolean);
  if (opts.length < 2) {
    return { ok: false, errorKey: 'admin.pollErrOptions' };
  }
  return { ok: true };
}
