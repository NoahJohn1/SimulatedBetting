import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { signIn } from '@/server/auth/config';
import { getSessionUser } from '@/server/auth/session';

export default async function SignInPage() {
  const user = await getSessionUser();
  if (user) redirect('/');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">SimulatedBetting</h1>
        <p className="mt-3 max-w-xs text-balance text-sm text-ink-muted">
          Play-money sportsbook. No real money is involved at any point.
        </p>
      </div>

      <form
        action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/' });
        }}
      >
        <Button type="submit">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
            <path
              fill="#4285F4"
              d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.11 0 5.72-1.03 7.62-2.8l-3.72-2.88c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.540-2.03-6.45-4.75H1.71v2.98A11.5 11.5 0 0 0 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.55 14.67a6.9 6.9 0 0 1 0-4.41V7.28H1.71a11.51 11.51 0 0 0 0 10.37l3.84-2.98Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.71 1.2 15.1 0 12 0 7.48 0 3.57 2.6 1.71 6.38l3.84 2.98C6.46 6.78 9 4.75 12 4.75Z"
            />
          </svg>
          Continue with Google
        </Button>
      </form>
    </main>
  );
}
