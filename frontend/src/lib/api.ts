const TOKEN_KEY = "reachinbox_token";

import type {
  AuthUser,
  EmailListResponse,
  SchedulePayload,
  ScheduleResponse,
  SearchResponse,
  Sender,
  SlackStatus,
  UserResponse,
} from "../types";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Decode the JWT payload (no verification — presentation only). */
export function decodeToken(token: string): AuthUser | null {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(decodeURIComponent(escape(json)));
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      avatar: payload.avatar ?? null,
    };
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, auth = true } = opts;
  const params = query
    ? "?" +
      Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}${params}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    clearToken();
    window.location.assign("/login");
    throw new ApiError("Unauthorized", 401);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? "Something went wrong";
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const api = {
  auth: {
    login(): void {
      // Full browser redirect to the real Google OAuth flow.
      window.location.assign("/api/auth/google");
    },
    demo(): Promise<{ user: AuthUser; token: string }> {
      return request("/auth/demo", { method: "POST", auth: false });
    },
    me(): Promise<UserResponse> {
      return request<UserResponse>("/auth/me");
    },
    logout(): Promise<{ ok: boolean }> {
      return request("/auth/logout", { method: "POST", auth: false });
    },
  },
  emails: {
    schedule(payload: SchedulePayload): Promise<ScheduleResponse> {
      return request("/emails/schedule", { method: "POST", body: payload });
    },
    scheduled(from = 0, size = 50): Promise<EmailListResponse> {
      return request("/emails/scheduled", { query: { from, size } });
    },
    sent(from = 0, size = 50): Promise<EmailListResponse> {
      return request("/emails/sent", { query: { from, size } });
    },
  },
  senders: {
    list(): Promise<Sender[]> {
      return request("/search/senders");
    },
  },
  search: {
    emails(q: string, from = 0, size = 50): Promise<SearchResponse> {
      return request("/search/emails", { query: { q, from, size } });
    },
  },
  slack: {
    status(): Promise<SlackStatus> {
      return request("/slack/status");
    },
    connect(): Promise<{ url: string }> {
      return request("/slack/connect");
    },
    disconnect(): Promise<{ ok: boolean }> {
      return request("/slack/disconnect", { method: "POST" });
    },
  },
};