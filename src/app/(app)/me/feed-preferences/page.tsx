import type { FeedEventType } from '@/db/schema';
import { requireApprovedMember } from '@/server/auth/session';
import { getMutedTypes } from '@/server/feed/preferences';
import { PreferencesForm, type PreferenceOption } from './preferences-form';

/** Every type a member can mute, with copy that says what they'd stop seeing. */
const OPTIONS: PreferenceOption[] = [
  { type: 'BET_PLACED', label: 'Bets placed', description: 'When somebody places a bet' },
  { type: 'BET_SETTLED', label: 'Bets settled', description: 'How everyone’s bets resolved' },
  { type: 'MEMBER_JOINED', label: 'New members', description: 'When somebody joins the season' },
  { type: 'ALLOWANCE_PAID', label: 'Weekly allowance', description: 'The weekly allowance card' },
  { type: 'ADMIN_ADJUSTMENT', label: 'Admin adjustments', description: 'Balance changes made by an admin' },
  { type: 'MILESTONE_LEAD_CHANGE', label: 'Lead changes', description: 'When the standings lead changes hands' },
  { type: 'MILESTONE_BIG_WIN', label: 'Big wins', description: 'Payouts of 10× or better' },
  { type: 'MILESTONE_PARLAY_HIT', label: 'Parlay hits', description: 'Parlays of four legs or more cashing' },
];

export default async function FeedPreferencesPage() {
  const member = await requireApprovedMember();
  const muted: FeedEventType[] = await getMutedTypes(member.userId);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Feed filters</h1>
        <p className="text-sm text-zinc-500">
          Turn anything off to hide it from your feed. Nothing is deleted — turning it back on
          brings the history with it.
        </p>
      </header>

      <PreferencesForm options={OPTIONS} muted={muted} />
    </div>
  );
}
