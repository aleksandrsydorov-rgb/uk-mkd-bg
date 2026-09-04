export type PollCategory = 'покупка' | 'ремонт' | 'опрос';
export type PollStatus = 'открыт' | 'закрыт';
export type PollResult = 'идёт' | 'принято' | 'не принято';
export type SuggestionStatus = 'новая' | 'принята' | 'отклонена';

export const MAJORITY_SHARE = 0.51;

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
  budget_eur?: number | null;
  voting_starts?: string | null;
  result?: PollResult | string | null;
  result_option_id?: number | null;
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

export function propertyVoteWeight(area: number | null | undefined) {
  const n = Number(area ?? 0);
  return n > 0 ? n : 0;
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
  if (category === 'покупка') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  if (category === 'ремонт') return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
  return 'bg-teal-500/15 text-teal-300 border-teal-500/30';
}

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

export function pollDecisionLabel(poll: Poll, accepted: boolean): PollResult {
  if (accepted || poll.result === 'принято') return 'принято';
  if (!isPollAcceptingVotes(poll) || poll.result === 'не принято') return 'не принято';
  return 'идёт';
}
