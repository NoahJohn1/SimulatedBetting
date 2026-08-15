import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  /** Our own `users.id` is carried on the session, so callers never resolve it themselves. */
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
  }
}
