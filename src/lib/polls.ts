export type PollCategory = 'покупка' | 'ремонт' | 'опрос';
export type PollStatus = 'открыт' | 'закрыт';
export type PollResult = 'идёт' | 'принято' | 'не принято';
export type SuggestionStatus = 'новая' | 'принята' | 'отклонена';

export const MAJORITY_SHARE = 0.51;
/** Images + PDF per poll; same private bucket as legacy photo_url. */
export const MAX_POLL_ATTACHMENTS = 5;
/** Explicit extensions for the picker (no image/* / MIME jargon in hints). */
export const POLL_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.heic,.bmp,.pdf';

export type PollAttachment = {
  path: string;
  name: string;
  size: number | null;
  contentType: string;
};

export interface Poll {
  id: number;
  created_at: string;
  title: string;
  body: string | null;
  category: PollCategory | string;
  status: PollStatus | string;
  deadline: string | null;
  created_by: string | null;
  photo_url?: string | null;
  /** Ordered attachments; falls back to photo_url when empty. */
  attachments?: PollAttachment[] | null;
  budget_eur?: number | null;
  voting_starts?: string | null;
  result?: PollResult | string | null;
  result_option_id?: number | null;
}

export function isPollAttachmentPdf(att: {
  path?: string | null;
  name?: string | null;
  contentType?: string | null;
}): boolean {
  const mime = String(att.contentType ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (mime === 'application/pdf') return true;
  const source = `${att.name ?? ''} ${att.path ?? ''}`.toLowerCase();
  return /\.pdf(?:$|\?)/.test(source);
}

export function isPollAttachmentImage(att: {
  path?: string | null;
  name?: string | null;
  contentType?: string | null;
}): boolean {
  if (isPollAttachmentPdf(att)) return false;
  const mime = String(att.contentType ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (mime.startsWith('image/')) return true;
  const source = `${att.name ?? ''} ${att.path ?? ''}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp)(?:$|\?)/.test(source);
}

/** Normalize DB/legacy rows into a stable attachment list (max MAX_POLL_ATTACHMENTS). */
export function pollAttachmentList(poll: {
  photo_url?: string | null;
  attachments?: PollAttachment[] | null | unknown;
}): PollAttachment[] {
  const raw = Array.isArray(poll.attachments) ? poll.attachments : [];
  const fromJson: PollAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const path = String(row.path ?? '').trim();
    if (!path) continue;
    const sizeRaw = row.size;
    const size =
      typeof sizeRaw === 'number' && Number.isFinite(sizeRaw)
        ? sizeRaw
        : sizeRaw == null
          ? null
          : Number(sizeRaw);
    fromJson.push({
      path,
      name: String(row.name ?? path.split('/').pop() ?? 'file').trim() || 'file',
      size: size != null && Number.isFinite(size) ? size : null,
      contentType: String(row.contentType ?? row.content_type ?? '').trim() || 'application/octet-stream',
    });
  }
  if (fromJson.length > 0) return fromJson.slice(0, MAX_POLL_ATTACHMENTS);
  const legacy = String(poll.photo_url ?? '').trim();
  if (!legacy) return [];
  return [
    {
      path: legacy,
      name: legacy.split('/').pop() || 'photo',
      size: null,
      contentType: isPollAttachmentPdf({ path: legacy }) ? 'application/pdf' : 'image/jpeg',
    },
  ];
}

/** First image path kept in photo_url for older UI; otherwise first attachment. */
export function pollLegacyPhotoUrl(attachments: PollAttachment[]): string | null {
  const image = attachments.find((a) => isPollAttachmentImage(a));
  return (image ?? attachments[0])?.path ?? null;
}

export function pollAttachmentFromFile(file: File, path: string): PollAttachment {
  return {
    path,
    name: file.name || path.split('/').pop() || 'file',
    size: file.size,
    contentType: (file.type || '').split(';')[0].trim() || 'application/octet-stream',
  };
}

export interface PollOption {
  id: number;
  poll_id: number;
  label: string;
  sort_order: number;
}

export interface PollVote {
  id: number;
  created_at: string;
  poll_id: number;
  option_id: number;
  property_id: number;
  weight?: number | null;
}

export interface PollVoteHistory {
  id: number;
  created_at: string;
  poll_id: number;
  option_id: number;
  property_id: number;
  weight: number | null;
}

export interface PollSuggestion {
  id: number;
  created_at: string;
  property_id: number;
  category: PollCategory | string;
  title: string;
  body: string | null;
  status: SuggestionStatus | string;
}

export interface AreaShare {
  id: number;
  area_sqm: number | null;
}

export function isMissingRelation(
  error: { message?: string } | null | undefined,
  table: string
) {
  if (!error) return false;
  const msg = error.message ?? '';
  return msg.includes(table) || msg.includes('schema cache') || msg.includes('Could not find');
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function propertyVoteWeight(areaOrIdeal: number | null | undefined) {
  const n = Number(areaOrIdeal ?? 0);
  return n > 0 ? n : 0;
}

/** Prefer ideal_parts when present; else area (legacy client tally). */
export function propertyIdealOrAreaWeight(p: {
  ideal_parts_percent?: number | null;
  area_sqm?: number | null;
}) {
  const ideal = Number(p.ideal_parts_percent ?? 0);
  if (ideal > 0) return ideal;
  return propertyVoteWeight(p.area_sqm);
}

export function accountVoteWeight(properties: AreaShare[]) {
  return properties.reduce((sum, p) => sum + propertyVoteWeight(p.area_sqm), 0);
}

export function totalBuildingWeight(properties: AreaShare[]) {
  const sum = properties.reduce((s, p) => s + propertyVoteWeight(p.area_sqm), 0);
  return sum > 0 ? sum : properties.length;
}

export function isPollAcceptingVotes(poll: Poll) {
  if (poll.status !== 'открыт') return false;
  if (poll.result === 'принято') return false;
  const today = todayIsoDate();
  if (poll.voting_starts && poll.voting_starts.slice(0, 10) > today) return false;
  if (poll.deadline && poll.deadline.slice(0, 10) < today) return false;
  return true;
}

export function pollCategoryClass(category: string) {
  if (category === 'покупка') return 'bg-accent-bg text-accent border-accent/25';
  if (category === 'ремонт') return 'bg-warning-bg text-warning border-warning/25';
  return 'bg-surface-secondary text-secondary border-border';
}

export type PollTallyAggregate = {
  poll_id: number;
  option_id: number;
  option_weight: number;
  apartment_count: number;
  total_building_weight: number;
  percentage: number;
};

export function tallyPoll(
  options: PollOption[],
  votes: PollVote[],
  properties: AreaShare[]
) {
  const areaById = new Map(properties.map((p) => [p.id, propertyVoteWeight(p.area_sqm)]));
  const total = totalBuildingWeight(properties);
  const rows = options.map((option) => {
    const related = votes.filter((v) => v.option_id === option.id);
    const weight = related.reduce((sum, v) => {
      const stored = Number(v.weight ?? 0);
      const fallback = areaById.get(v.property_id) ?? 0;
      return sum + (stored > 0 ? stored : fallback);
    }, 0);
    return {
      option,
      apartments: related.length,
      weight,
      pctOfTotal: total > 0 ? (weight / total) * 100 : 0,
    };
  });
  const votedWeight = rows.reduce((s, r) => s + r.weight, 0);
  const winner = [...rows].sort((a, b) => b.weight - a.weight)[0] ?? null;
  const accepted = Boolean(winner && winner.pctOfTotal >= MAJORITY_SHARE * 100);
  return {
    total,
    votedWeight,
    rows,
    winner,
    accepted,
    majorityWeight: total * MAJORITY_SHARE,
  };
}

export type PollTally = ReturnType<typeof tallyPoll>;

export function tallyFromAggregates(
  options: PollOption[],
  aggregates: PollTallyAggregate[],
): PollTally {
  const pollId = options[0]?.poll_id;
  const related = pollId == null ? [] : aggregates.filter((a) => a.poll_id === pollId);
  const total = Number(related[0]?.total_building_weight ?? 0);
  const byOption = new Map(related.map((a) => [a.option_id, a]));
  const rows = options.map((option) => {
    const row = byOption.get(option.id);
    const weight = Number(row?.option_weight ?? 0);
    const pctOfTotal = Number(
      row?.percentage ?? (total > 0 ? (weight / total) * 100 : 0),
    );
    return {
      option,
      apartments: Number(row?.apartment_count ?? 0),
      weight,
      pctOfTotal,
    };
  });
  const votedWeight = rows.reduce((s, r) => s + r.weight, 0);
  const winner =
    [...rows].sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (a.option.sort_order !== b.option.sort_order) return a.option.sort_order - b.option.sort_order;
      return a.option.id - b.option.id;
    })[0] ?? null;
  const accepted = Boolean(winner && total > 0 && winner.weight / total >= MAJORITY_SHARE);
  return {
    total,
    votedWeight,
    rows,
    winner,
    accepted,
    majorityWeight: total * MAJORITY_SHARE,
  };
}

export function pollDecisionLabel(poll: Poll, accepted: boolean): PollResult {
  if (accepted || poll.result === 'принято') return 'принято';
  if (!isPollAcceptingVotes(poll) || poll.result === 'не принято') return 'не принято';
  return 'идёт';
}

/** Closed / finished polls suitable for OS ratification agenda. */
export function isPollReadyForMeetingAgenda(poll: Poll) {
  if (poll.status === 'закрыт') return true;
  return poll.result === 'принято' || poll.result === 'не принято';
}

export function buildPollRatificationAgenda(args: {
  poll: Poll;
  tally: PollTally;
  locale?: string;
}): {
  title: string;
  description: string;
  proposed_decision_text: string;
} {
  const { poll, tally } = args;
  const resultLabel = pollDecisionLabel(poll, tally.accepted);
  const winner = tally.winner;
  const winnerPct = winner ? winner.pctOfTotal.toFixed(1) : '0';
  const lines = [
    `Опрос №${poll.id}: ${poll.title}`,
    poll.body?.trim() ? poll.body.trim() : null,
    poll.budget_eur != null ? `Бюджет: ${poll.budget_eur} €` : null,
    `Статус опроса: ${poll.status}`,
    `Результат опроса: ${resultLabel}`,
    winner
      ? `Лидирующий вариант: «${winner.option.label}» — ${winnerPct}% (вес ${winner.weight.toFixed(2)}, квартир ${winner.apartments})`
      : 'Варианты без голосов.',
    `Учтено веса: ${tally.votedWeight.toFixed(2)} из ${tally.total.toFixed(2)}`,
    '',
    'Варианты:',
    ...tally.rows.map(
      (r) =>
        `• ${r.option.label}: ${r.pctOfTotal.toFixed(1)}% (вес ${r.weight.toFixed(2)}, квартир ${r.apartments})`,
    ),
  ].filter((x): x is string => Boolean(x));

  const title = `Утверждение результата опроса: ${poll.title}`;
  const proposed =
    resultLabel === 'принято' && winner
      ? `Общото събрание утвърждава резултата от допитването №${poll.id} «${poll.title}»: прието е предложението «${winner.option.label}» (${winnerPct}%).`
      : `Общото събрание утвърждава резултата от допитването №${poll.id} «${poll.title}»: решението не е прието по допитването.`;

  return {
    title,
    description: lines.join('\n'),
    proposed_decision_text: proposed,
  };
}

