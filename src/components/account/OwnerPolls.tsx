'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { labelPollCategory, labelPollDecision } from '@/i18n/labels';
import { PollOptionBars } from '@/components/PollPanel';
import {
  isPollAcceptingVotes,
  pollDecisionLabel,
  tallyFromAggregates,
  type Poll,
  type PollOption,
  type PollTallyAggregate,
  type PollVote,
} from '@/lib/polls';
import { formatOwnerDate } from '@/lib/ownerFormat';
import {
  CompactCard,
  EmptyState,
  PillTabs,
  SectionHeader,
  StatusBadge,
  TextLinkButton,
} from '@/components/account/ownerUi';

function pollTone(decision: string): 'neutral' | 'info' | 'success' | 'danger' {
  if (decision === 'принято') return 'success';
  if (decision === 'не принято') return 'danger';
  return 'info';
}

export function OwnerPolls({
  polls,
  pollOptions,
  pollVotes,
  pollTallies,
  myPropertyIds,
  myVoteWeight,
  votingPollId,
  onVote,
}: {
  polls: Poll[];
  pollOptions: PollOption[];
  pollVotes: PollVote[];
  pollTallies: PollTallyAggregate[];
  myPropertyIds: number[];
  myVoteWeight: number;
  votingPollId: number | null;
  onVote: (poll: Poll, optionId: number) => void;
}) {
  const { t, dateLocale } = useI18n();
  const [filter, setFilter] = useState<'active' | 'done' | 'all'>('active');
  const [openId, setOpenId] = useState<number | null>(null);

  const active = polls.filter((p) => isPollAcceptingVotes(p));
  const done = polls.filter((p) => !isPollAcceptingVotes(p));
  const shown = filter === 'active' ? active : filter === 'done' ? done : polls;

  const sorted = useMemo(
    () => [...shown].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [shown],
  );

  return (
    <div className="space-y-3">
      <SectionHeader title={t('account.polls')} secondary={t('account.pollsLead')} />
      <p className="text-xs text-muted">{t('account.pollsNotMeeting')}</p>
      {polls.length > 0 ? (
        <PillTabs
          items={[
            { id: 'active', label: t('account.filterActive'), count: active.length },
            { id: 'done', label: t('account.filterDone'), count: done.length },
            { id: 'all', label: t('account.filterAll') },
          ]}
          value={filter}
          onChange={setFilter}
        />
      ) : null}
      {sorted.length === 0 ? (
        <EmptyState
          title={filter === 'active' ? t('account.noActivePolls') : t('account.noPolls')}
          text={t('account.pollsEmptyHint')}
        />
      ) : (
        sorted.map((poll) => {
          const options = pollOptions.filter((o) => o.poll_id === poll.id).sort((a, b) => a.sort_order - b.sort_order);
          const votesForPoll = pollVotes.filter((v) => v.poll_id === poll.id);
          const myVote = votesForPoll.find((v) => myPropertyIds.includes(v.property_id));
          const open = isPollAcceptingVotes(poll);
          const tally = tallyFromAggregates(options, pollTallies);
          const decision = pollDecisionLabel(poll, tally.accepted);
          const expanded = openId === poll.id || (filter === 'active' && open && sorted.length === 1);
          const start = poll.voting_starts ? formatOwnerDate(poll.voting_starts, dateLocale) : null;
          const end = poll.deadline ? formatOwnerDate(poll.deadline, dateLocale) : null;
          const myOption = options.find((o) => o.id === myVote?.option_id);
          return (
            <CompactCard key={poll.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{poll.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{labelPollCategory(poll.category, t)}</p>
                </div>
                <StatusBadge
                  label={open ? t('account.pollStOpen') : labelPollDecision(decision, t)}
                  tone={open ? 'info' : pollTone(decision)}
                />
              </div>
              {poll.body ? <p className="mt-2 line-clamp-2 text-sm text-secondary">{poll.body}</p> : null}
              {(start || end) ? (
                <p className="mt-2 text-xs text-muted">
                  {start && end ? `${start} – ${end}` : end ?? start}
                </p>
              ) : null}
              {!open ? (
                <p className="mt-2 text-sm text-secondary">
                  {t('account.pollResult')}: {labelPollDecision(decision, t)}
                </p>
              ) : null}
              {expanded ? (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  {poll.body ? <p className="text-sm text-secondary whitespace-pre-wrap">{poll.body}</p> : null}
                  {open && end ? (
                    <p className="text-xs text-muted">{t('account.pollUntil', { d: end })}</p>
                  ) : null}
                  {open && myVoteWeight > 0 ? (
                    <p className="text-xs text-secondary">{t('account.yourWeight', { n: myVoteWeight.toFixed(1) })}</p>
                  ) : null}
                  {myVote ? (
                    <p className="text-sm text-accent">
                      {t('account.yourVote')}: {myOption?.label ?? '—'} · {t('account.voteLockedShort')}
                    </p>
                  ) : null}
                  <PollOptionBars
                    poll={poll}
                    options={options}
                    tally={tally}
                    myOptionId={myVote?.option_id}
                    disabled={!open || Boolean(myVote) || votingPollId === poll.id}
                    onVote={open && !myVote ? (optionId) => onVote(poll, optionId) : undefined}
                    alwaysShowStats={!open}
                  />
                  {!open ? (
                    <p className="text-xs text-muted">
                      {t('poll.stats', { voted: tally.votedWeight.toFixed(1), total: tally.total.toFixed(1) })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-2">
                <TextLinkButton onClick={() => setOpenId(expanded ? null : poll.id)}>
                  {expanded
                    ? t('common.close')
                    : open
                      ? t('account.openPoll')
                      : t('account.viewPollResults')}
                </TextLinkButton>
              </div>
            </CompactCard>
          );
        })
      )}
    </div>
  );
}
