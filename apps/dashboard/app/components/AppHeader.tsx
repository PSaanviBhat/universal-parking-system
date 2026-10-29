'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearSession, type StaffSession } from '../lib/api';

export default function AppHeader({
  session,
  subtitle,
  children,
}: {
  session: StaffSession;
  subtitle: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();

  function logout() {
    clearSession();
    router.push('/login');
  }

  return (
    <header className="border-b border-slate-800 bg-slate-950 px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4 shadow-md">
      <div className="flex items-center space-x-4">
        <div className="h-10 w-10 bg-blue-600 rounded-lg flex items-center justify-center font-black text-xl text-white shadow">P</div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Universal Parking Platform</h1>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {children}
        {session.role === 'admin' && (
          <nav className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700 text-xs font-semibold">
            <Link href="/" className="px-3 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800">
              Live console
            </Link>
            <Link href="/admin" className="px-3 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800">
              Admin
            </Link>
          </nav>
        )}
        <div className="flex items-center space-x-2 bg-slate-800/80 border border-slate-700/80 px-3 py-1.5 rounded-lg text-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-semibold text-slate-200">{session.user.username}</span>
          <span className="text-slate-500">{session.role}</span>
        </div>
        <button
          onClick={logout}
          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600 border border-red-500/30 hover:border-red-500 text-red-200 hover:text-white rounded-lg text-xs font-semibold transition-all"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
