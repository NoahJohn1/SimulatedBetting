import Link from 'next/link';
import { StatusScreen } from '@/components/ui/status-screen';

export default function NotFound() {
  return (
    <StatusScreen title="Page not found" body="There's nothing at this address.">
      <Link href="/" className="text-sm font-medium text-zinc-500 underline">
        Back home
      </Link>
    </StatusScreen>
  );
}
