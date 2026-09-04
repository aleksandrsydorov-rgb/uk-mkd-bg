'use client';

import {
  pollDecisionLabel,
  tallyPoll,
  type AreaShare,
  type Poll,
  type PollOption,
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
}: {
  poll: Poll;
  options: PollOption[];
  votes: PollVote[];
  properties: AreaShare[];
}) {
  const { t } = useI18n();
  const tally = tallyPoll(options, votes, properties);
  const decision = pollDecisionLabel(poll, tally.accepted);
  const start = formatDate(poll.voting_starts);
  const end = formatDate(poll.deadline);

  return (
    <div className="space-y-3">
      {poll.photo_url && (
        <img
          src={poll.photo_url}
          alt={poll.title}
          className="w-full max-h-64 object-cover rounded-xl border border-white/10"
        />
      )}
      {poll.body && (
        <p className="text-sm text-white/70 whitespace-pre-wrap">{poll.body}</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
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
            ? 'border-emerald-600/50 bg-emerald-900/30 text-emerald-200'
            : decision === 'не принято'
              ? 'border-red-700/50 bg-red-900/20 text-red-200'
              : 'border-white/10 bg-white/5 text-white/70'
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
        <div className="text-xs text-white/40">
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
  myOptionId,
  disabled,
  onVote,
  alwaysShowStats = false,
}: {
  poll: Poll;
  options: PollOption[];
  votes: PollVote[];
  properties: AreaShare[];
  myOptionId?: number;
  disabled?: boolean;
  onVote?: (optionId: number) => void;
  alwaysShowStats?: boolean;
}) {
  const { t } = useI18n();
  const tally = tallyPoll(options, votes, properties);
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
                <span className="text-xs text-white/40">
                  {row.weight.toFixed(1)} {t('common.sqm')} · {row.pctOfTotal.toFixed(1)}% · {row.apartments} {t('common.apt')}
                </span>
              )}
            </div>
            {showStats && (
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full ${row.pctOfTotal >= 51 ? 'bg-emerald-400' : 'bg-emerald-500/70'}`}
                  style={{ width: `${Math.min(row.pctOfTotal, 100)}%` }}
                />
              </div>
            )}
          </>
        );
        if (!onVote) {
          return (
            <div key={row.option.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
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
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                : 'border-white/10 bg-white/5 text-white/80 hover:border-white/20'
            } disabled:opacity-60`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
