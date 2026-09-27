/**
 * Fetch an API endpoint with the browser's same-origin session cookie.
 * Explicitly setting credentials keeps session behavior consistent for
 * sensitive finance and inventory requests.
 */
export const SESSION_EXPIRED_EVENT = "finance-session-expired";

export function notifySessionExpired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

export async function fetchWithSession(
  input: RequestInfo | URL,
  init: RequestInit = {},
  notifyUnauthorized = true,
): Promise<Response> {
  const response = await fetch(input, { credentials: "same-origin", ...init });
  if (notifyUnauthorized && response.status === 401) notifySessionExpired();
  return response;
}