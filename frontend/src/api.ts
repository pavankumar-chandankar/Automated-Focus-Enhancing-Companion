import type { CoachResponse, Consent, Preferences, Session, Signal } from "./types";

export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let backendKey = "";

export function setBackendKey(value: string) {
  backendKey = value;
}

async function request<T>(route: string, body?: unknown, method?: "GET" | "POST" | "DELETE"): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(route, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(backendKey ? { "x-api-key": backendKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const detail =
        typeof result === "object" && result !== null && "detail" in result
          ? String(result.detail)
          : "Request failed";
      throw new APIError(detail, response.status);
    }
    return result as T;
  } finally {
    clearTimeout(timer);
  }
}

type Variant = "autonomy_v1" | "evidence_v2";

export const API = {
  capabilities: () => request<{ provider_mode: string }>("/v1/capabilities"),

  start: (consent: Consent, preferences: Preferences) =>
    request<Session>("/v1/sessions", { consent, preferences }),

  delete: (id: string) => request<{ deleted: boolean }>(`/v1/sessions/${id}`, undefined, "DELETE"),

  coach: (session_id: string, signal: Signal, goal: string, optional_note: string, prompt_variant: Variant) =>
    request<CoachResponse>("/v1/coach", { session_id, signal, goal, optional_note, prompt_variant }),

  choice: (session_id: string, action: "accept" | "dismiss" | "snooze", intervention_id: string) =>
    request<{ recorded: boolean }>(`/v1/sessions/${session_id}/choices`, { action, intervention_id }),
};
