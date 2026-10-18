'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<'operator' | 'admin'>('operator');
  const [username, setUsername] = useState('operator1');
  const [password, setPassword] = useState('Op@12345');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  const handleRoleChange = (newRole: 'operator' | 'admin') => {
    setRole(newRole);
    setError(null);
    if (newRole === 'operator') {
      setUsername('operator1');
      setPassword('Op@12345');
    } else {
      setUsername('superadmin');
      setPassword('Admin@12345');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const endpoint =
      role === 'admin'
        ? `${API_BASE}/api/admin-auth/login`
        : `${API_BASE}/api/operator-auth/login`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || 'Invalid credentials.');
        return;
      }

      localStorage.setItem('parking_token', data.token);
      localStorage.setItem('parking_role', role);
      if (data.operator) {
        localStorage.setItem('parking_user', JSON.stringify(data.operator));
      } else if (data.admin) {
        localStorage.setItem('parking_user', JSON.stringify(data.admin));
      }

      router.push('/');
    } catch (err: any) {
      console.error('Login error:', err);
      setError('Unable to connect to backend server. Make sure it is running on ' + API_BASE);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 bg-blue-600 rounded-xl items-center justify-center font-black text-2xl text-white shadow-lg mb-3">
            P
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Smart Parking Portal</h1>
          <p className="text-sm text-slate-400 mt-1">Authenticate to access operator kiosk & live monitoring</p>
        </div>

        {/* Role Toggle */}
        <div className="flex bg-slate-950 p-1 rounded-xl mb-6 border border-slate-800">
          <button
            type="button"
            onClick={() => handleRoleChange('operator')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              role === 'operator'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Operator
          </button>
          <button
            type="button"
            onClick={() => handleRoleChange('admin')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              role === 'admin'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Administrator
          </button>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
              placeholder="Username"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-950/80 border border-red-800 rounded-xl text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 font-semibold text-sm text-white rounded-xl shadow-lg transition-all disabled:opacity-50 mt-2"
          >
            {loading ? 'Authenticating...' : `Sign in as ${role === 'admin' ? 'Administrator' : 'Operator'}`}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-800 text-center text-xs text-slate-500">
          <p>
            Default operator: <code className="text-slate-300">operator1</code> / <code className="text-slate-300">Op@12345</code>
          </p>
          <p className="mt-1">
            Default admin: <code className="text-slate-300">superadmin</code> / <code className="text-slate-300">Admin@12345</code>
          </p>
        </div>
      </div>
    </div>
  );
}
