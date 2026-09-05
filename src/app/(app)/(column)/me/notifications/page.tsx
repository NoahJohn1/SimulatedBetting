import type { Metadata } from 'next';
import type { NotificationType } from '@/db/schema';
import { requireApprovedMember } from '@/server/auth/session';
import { getNotificationPreferences } from '@/server/notify/preferences';
import { NotificationForm, type NotificationOption } from './notification-form';

export const metadata: Metadata = { title: 'Email' };

/** The six types that send, with copy that says what would stop arriving. */
const OPTIONS: NotificationOption[] = [
  {
    type: 'WAGER_OFFERED',
    label: 'Wagers offered to you',
    description: 'When somebody challenges you directly',
  },
  {
    type: 'OFFER_EXPIRING',
    label: 'Offers about to expire',
    description: 'Before an offer lapses and the credits go back',
  },
  {
    type: 'DISPUTE_NEEDS_RULING',
    label: 'Disputes needing a ruling',
    description: 'Admins only — something is waiting on you',
  },
  {
    type: 'ACCOUNT_APPROVED',
    label: 'Account approved',
    description: 'Once, when an admin lets you in',
  },
  {
    type: 'BETS_SETTLED',
    label: 'Your bets settled',
    description: 'A daily summary of how everything resolved',
  },
  {
    type: 'ALLOWANCE_PAID',
    label: 'Weekly allowance',
    description: 'When the weekly allowance lands',
  },
];

export default async function NotificationPreferencesPage() {
  const member = await requireApprovedMember();
  const prefs = await getNotificationPreferences(member.userId);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Email</h1>
        <p className="text-sm text-ink-muted">
          Everything is on unless you turn it off. Nothing here changes what you see in the app —
          only what arrives in your inbox.
        </p>
      </header>

      <NotificationForm
        options={OPTIONS}
        muted={prefs.mutedTypes as NotificationType[]}
        emailsEnabled={prefs.emailsEnabled}
      />
    </div>
  );
}
