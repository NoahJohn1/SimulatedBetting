import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { upsertOAuthUser } from './identity';

/**
 * Auth.js wiring. Google only for now — Apple is deferred, and adding it later is a second
 * entry in `providers` plus credentials, with no schema change, because identity is keyed
 * on (provider, providerAccountId) in our own `users` table.
 *
 * There is no Auth.js database adapter on purpose. Sessions are JWTs, and the only thing
 * persisted is our own `users` row, written through `upsertOAuthUser` on each sign-in. That
 * keeps one identity table rather than mirroring Auth.js's own.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/sign-in',
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || account.provider !== 'google' || !profile?.sub) return false;

      await upsertOAuthUser({
        provider: 'GOOGLE',
        providerAccountId: profile.sub,
        email: profile.email ?? '',
        displayName: profile.name ?? profile.email ?? 'Member',
        avatarUrl: typeof profile.picture === 'string' ? profile.picture : null,
      });

      // Everyone may sign in; PENDING users get the holding screen. The approval gate is an
      // authorization check on every request, not a sign-in refusal.
      return true;
    },

    async jwt({ token, account, profile }) {
      if (account && profile?.sub) {
        // Our own user id is resolved once at sign-in and carried on the token, so no
        // request has to look the user up by provider id.
        const user = await upsertOAuthUser({
          provider: 'GOOGLE',
          providerAccountId: profile.sub,
          email: profile.email ?? '',
          displayName: profile.name ?? profile.email ?? 'Member',
          avatarUrl: typeof profile.picture === 'string' ? profile.picture : null,
        });
        token.userId = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
});
