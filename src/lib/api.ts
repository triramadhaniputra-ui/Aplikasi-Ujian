const TOKEN_KEY = 'smart_cbt_token';
const EXAM_SESSION_KEY = 'smart_cbt_exam_session';

export function getAuthToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function getExamSessionToken(attemptId: number): string {
  return sessionStorage.getItem(`${EXAM_SESSION_KEY}_${attemptId}`) || '';
}

export function setExamSessionToken(attemptId: number, token: string): void {
  sessionStorage.setItem(`${EXAM_SESSION_KEY}_${attemptId}`, token);
}

export class ApiError extends Error {
  status: number;
  data?: Record<string, unknown>;
  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type MutationListener = (path: string, method: string) => void;
const mutationListeners = new Set<MutationListener>();

export function subscribeApiMutations(listener: MutationListener): () => void {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { onUnauthorized?: () => void } = {}
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? ((await res.json()) as Record<string, unknown>)
    : {};

  if (!res.ok) {
    if (res.status === 401 && options.onUnauthorized) {
      options.onUnauthorized();
    }
    throw new ApiError(
      String(data.error || `Permintaan gagal (${res.status})`),
      res.status,
      data
    );
  }

  const method = (options.method || 'GET').toUpperCase();
  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    !path.startsWith('/api/auth/') &&
    !path.startsWith('/api/settings/restore') &&
    !path.startsWith('/api/questions/parse-word')
  ) {
    mutationListeners.forEach((fn) => {
      try {
        fn(path, method);
      } catch {
        // ignore listener errors
      }
    });
  }

  return data as T;
}

export function buildWsUrl(attemptId?: number): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(getAuthToken() || '');
  const extra = attemptId ? `&attemptId=${attemptId}` : '';
  return `${proto}//${window.location.host}/ws?token=${token}${extra}`;
}
