export interface CreateCustomEventMarketInput {
  title: string;
  outcomes: { label: string; priceAmerican: number }[];
}

export interface CreateCustomEventInput {
  creatorMembershipId: string;
  title: string;
  description?: string;
  startsAt: Date;
  resolvesBy: Date;
  markets: CreateCustomEventMarketInput[];
  /** Injectable clock so schedule validation is testable without sleeping. */
  now?: Date;
}

export type CreateEventError =
  | { code: 'NOT_A_MEMBER' }
  | { code: 'INVALID_TITLE' }
  | { code: 'INVALID_DESCRIPTION' }
  | { code: 'INVALID_SCHEDULE' }
  | { code: 'INVALID_MARKET_COUNT'; count: number; min: number; max: number }
  | {
      code: 'INVALID_MARKET';
      marketIndex: number;
      reason: 'TITLE' | 'OUTCOME_COUNT' | 'DUPLICATE_LABEL' | 'LABEL';
    }
  | { code: 'INVALID_PRICE'; marketIndex: number; outcomeIndex: number };

export type CreateCustomEventResult =
  | { ok: true; eventId: string }
  | { ok: false; error: CreateEventError };

export const MAX_MARKETS_PER_EVENT = 20;
export const MIN_OUTCOMES_PER_MARKET = 2;
export const MAX_OUTCOMES_PER_MARKET = 20;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 1000;
