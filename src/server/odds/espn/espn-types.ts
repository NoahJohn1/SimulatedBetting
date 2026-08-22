export interface EspnTeamRef {
  id: string;
  abbreviation: string;
  displayName: string;
  logo?: string;
}

export interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  team: EspnTeamRef;
}

export interface EspnStatusType {
  state: string;
  name: string;
  completed: boolean;
}

export interface EspnOddsPriceClose {
  line?: string;
  odds: string;
}

export interface EspnOddsSideClose {
  close: EspnOddsPriceClose;
}

export interface EspnOdds {
  provider: { displayName?: string; name: string };
  pointSpread?: { home: EspnOddsSideClose; away: EspnOddsSideClose };
  total?: { over: EspnOddsSideClose; under: EspnOddsSideClose };
  moneyline?: { home: EspnOddsSideClose; away: EspnOddsSideClose };
}

export interface EspnCompetition {
  id: string;
  status: { type: EspnStatusType };
  competitors: EspnCompetitor[];
  odds?: EspnOdds[];
}

export interface EspnEvent {
  id: string;
  date: string;
  season: { year: number };
  week?: { number: number };
  competitions: EspnCompetition[];
}

export interface EspnScoreboardResponse {
  events: EspnEvent[];
}
