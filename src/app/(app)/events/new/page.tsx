import { requireApprovedMember } from '@/server/auth/session';
import { EventForm } from './event-form';

export default async function NewEventPage() {
  await requireApprovedMember();

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <h1 className="text-lg font-semibold">Create an event</h1>
      <EventForm />
    </div>
  );
}
