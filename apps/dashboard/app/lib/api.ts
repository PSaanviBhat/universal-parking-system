export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export type StaffRole = 'operator' | 'admin';

export interface StaffSession {
  token: string;
  role: StaffRole;
  user: { id: string; username: string; facilityId?: string; facilityName?: string };
}

export function loadSession(): StaffSession | null {
  try {
    const token = localStorage.getItem('parking_token');
    const role = localStorage.getItem('parking_role') as StaffRole | null;
    const user = JSON.parse(localStorage.getItem('parking_user') || 'null');
    if (!token || !role || !user) return null;
    return { token, role, user };
  } catch {
    return null;
  }
}

export function saveSession(session: StaffSession): void {
  localStorage.setItem('parking_token', session.token);
  localStorage.setItem('parking_role', session.role);
  localStorage.setItem('parking_user', JSON.stringify(session.user));
}

export function clearSession(): void {
  localStorage.removeItem('parking_token');
  localStorage.removeItem('parking_role');
  localStorage.removeItem('parking_user');
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * fetch() against the backend with the staff token. Throws ApiError with the
 * server's message on non-2xx; a 401 clears the session and sends the user to /login.
 */
export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const session = loadSession();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(init.headers || {}),
    },
  });

  if (res.status === 401) {
    clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }

  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.message || `Request failed (${res.status}).`);
  }
  return body as T;
}

/** Fetches a binary resource (e.g. a gate QR PNG) as an object URL. */
export async function apiBlobUrl(path: string): Promise<string> {
  const session = loadSession();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status}).`);
  return URL.createObjectURL(await res.blob());
}

export const rupees = (n: number | string | null | undefined) => `₹${Number(n || 0).toFixed(2)}`;

export const timeOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

export const dateTimeOf = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
