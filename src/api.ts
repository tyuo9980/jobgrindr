import { useCallback, useEffect, useState } from 'react';
import type { Application, ApplicationInput, Status, StatusKind } from './types';

export class ApiError extends Error {}

/** The session is missing or expired; the app goes back to the sign-in screen. */
export class SignedOutError extends ApiError {}

const API_BASE = `${import.meta.env.BASE_URL}api`;

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // The server refuses writes without this header; it is its CSRF check.
  const headers: Record<string, string> = { 'X-Jobgrindr': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw new SignedOutError(data?.error ?? 'Sign in required');
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The user's calendar date. Status changes are stamped with it. */
export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export interface StatusInput {
  name: string;
  color: string;
  kind: StatusKind;
}

export function useJobData(onSignedOut: () => void) {
  const [apps, setApps] = useState<Application[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof SignedOutError) onSignedOut();
      else setError((err as Error).message);
    },
    [onSignedOut],
  );

  const refreshStatuses = useCallback(
    async () => setStatuses(await request<Status[]>('GET', '/statuses')),
    [],
  );

  useEffect(() => {
    Promise.all([request<Status[]>('GET', '/statuses'), request<Application[]>('GET', '/applications')])
      .then(([s, a]) => {
        setStatuses(s);
        setApps(a);
      })
      .catch(fail)
      .finally(() => setLoading(false));
  }, [fail]);

  /** Runs a mutation, surfacing its error instead of throwing. Returns whether it worked. */
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError(null);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const upsert = (app: Application) =>
    setApps((prev) =>
      prev.some((a) => a.id === app.id) ? prev.map((a) => (a.id === app.id ? app : a)) : [app, ...prev],
    );

  return {
    apps,
    statuses,
    loading,
    error,
    dismissError: () => setError(null),

    createApplication: (input: ApplicationInput) =>
      run(async () => {
        upsert(await request<Application>('POST', '/applications', { ...input, today: today() }));
        await refreshStatuses();
      }),

    updateApplication: (id: number, input: Partial<ApplicationInput>) =>
      run(async () => {
        upsert(await request<Application>('PATCH', `/applications/${id}`, { ...input, today: today() }));
        await refreshStatuses();
      }),

    deleteApplication: (id: number) =>
      run(async () => {
        await request('DELETE', `/applications/${id}`);
        setApps((prev) => prev.filter((a) => a.id !== id));
        await refreshStatuses();
      }),

    createStatus: (input: StatusInput) =>
      run(async () => setStatuses(await request<Status[]>('POST', '/statuses', input))),

    updateStatus: (id: number, input: Partial<StatusInput>) =>
      run(async () => setStatuses(await request<Status[]>('PATCH', `/statuses/${id}`, input))),

    deleteStatus: (id: number) =>
      run(async () => setStatuses(await request<Status[]>('DELETE', `/statuses/${id}`))),

    reorderStatuses: (ids: number[]) =>
      run(async () => setStatuses(await request<Status[]>('PUT', '/statuses/order', { ids }))),
  };
}
