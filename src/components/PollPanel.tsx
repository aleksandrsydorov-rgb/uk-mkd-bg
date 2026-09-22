'use client';

import {
  pollDecisionLabel,
  tallyPoll,
  type AreaShare,
  type Poll,
  type PollOption,
  type PollTally,
  type PollVote,
} from '@/lib/polls';
import { useI18n } from '@/i18n/I18nProvider';

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.slice(0, 10).split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}.${m}.${y}`;
}

export function PollDetails({
  poll,
  options,
  votes,
  properties,
  tally: tallyProp,
}: {
  poll: Poll;
  options: PollOption[];
  votes?: PollVote[];
  properties?: AreaShare[];
  tally?: PollTally;
}) {
  const { t } = useI18n();
  const tally = tallyProp ?? tallyPoll(options, votes ?? [], properties ?? []);
  const decision = pollDecisionLabel(poll, tally.accepted);
  const start = formatDate(poll.voting_starts);
  const end = formatDate(poll.deadline);

  return (
    <div className="space-y-3">
      {poll.photo_url && (
        <img
          src={poll.photo_url}
          alt={poll.title}
          className="w-full max-h-64 object-cover rounded-xl border border-border"
        />
      )}
      {poll.body && (
        <p className="text-sm text-secondary whitespace-pre-wrap">{poll.body}</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {poll.budget_eur != null && Number(poll.budget_eur) > 0 && (
          <span>{t('poll.budget', { n: Number(poll.budget_eur).toFixed(2) })}</span>
        )}
        {(start || end) && (
          <span>
            {t('poll.voting', { start: start ?? t('poll.now'), end: end ?? t('poll.noDeadline') })}
          </span>
        )}
        <span>
          {t('poll.weight', { n: tally.majorityWeight.toFixed(1) })}
        </span>
      </div>
      <div
        className={`rounded-lg border px-3 py-2 text-sm ${
          decision === 'принято'
            ? 'border-success/30 bg-success-bg text-success'
            : decision === 'не принято'
              ? 'border-danger/30 bg-danger-bg text-danger'
              : 'border-border bg-surface-secondary text-secondary'
        }`}
      >
        {decision === 'принято' && (
          <span>
            {t('poll.accepted', { label: tally.winner?.option.label ?? '', pct: String(tally.winner?.pctOfTotal.toFixed(1) ?? '0') })}
          </span>
        )}
        {decision === 'не принято' && (
          <span>
            {t('poll.rejected')}
          </span>
        )}
        {decision === 'идёт' && (
          <span>
            {t('poll.running')}
          </span>
        )}
      </div>
      {(decision !== 'идёт' || tally.accepted) && (
        <div className="text-xs text-muted">
          {t('poll.stats', { voted: tally.votedWeight.toFixed(1), total: tally.total.toFixed(1) })}
        </div>
      )}
    </div>
  );
}

export function PollOptionBars({
  poll,
  options,
  votes,
  properties,
  tally: tallyProp,
  myOptionId,
  disabled,
  onVote,
  alwaysShowStats = false,
}: {
  poll: Poll;
  options: PollOption[];
  votes?: PollVote[];
  properties?: AreaShare[];
  tally?: PollTally;
  myOptionId?: number;
  disabled?: boolean;
  onVote?: (optionId: number) => void;
  alwaysShowStats?: boolean;
}) {
  const { t } = useI18n();
  const tally = tallyProp ?? tallyPoll(options, votes ?? [], properties ?? []);
  const showStats =
    alwaysShowStats ||
    tally.accepted ||
    pollDecisionLabel(poll, tally.accepted) !== 'идёт';

  return (
    <div className="space-y-2">
      {tally.rows.map((row) => {
        const selected = myOptionId === row.option.id;
        const inner = (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{row.option.label}</span>
              {showStats && (
                <span className="text-xs text-muted">
                  {row.weight.toFixed(1)} {t('common.sqm')} · {row.pctOfTotal.toFixed(1)}% · {row.apartments} {t('common.apt')}
                </span>
              )}
            </div>
            {showStats && (
              <div className="mt-2 h-1.5 rounded-full bg-hover overflow-hidden">
                <div
                  className={`h-full ${row.pctOfTotal >= 51 ? 'bg-accent' : 'bg-accent'}`}
                  style={{ width: `${Math.min(row.pctOfTotal, 100)}%` }}
                />
              </div>
            )}
          </>
        );
        if (!onVote) {
          return (
            <div
              key={row.option.id}
              className={`rounded-lg border px-3 py-2 ${
                selected
                  ? 'border-accent/30 bg-accent-bg text-accent'
                  : 'border-border bg-surface'
              }`}
            >
              {inner}
            </div>
          );
        }
        return (
          <button
            key={row.option.id}
            type="button"
            disabled={disabled}
            onClick={() => onVote(row.option.id)}
            className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
              selected
                ? 'border-accent/30 bg-accent-bg text-accent'
                : 'border-border bg-surface-secondary text-secondary hover:border-border-strong'
            } disabled:opacity-60`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
