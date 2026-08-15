import { redirect } from 'next/navigation';

/** Games is the default landing route (D8). */
export default function RootPage() {
  redirect('/games');
}
