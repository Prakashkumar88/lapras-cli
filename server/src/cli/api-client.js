// Shared HTTP client for CLI → Render backend communication
// The CLI never connects to Prisma or Google AI directly.
// All secrets stay on the server.

export const LAPRAS_SERVER_URL =
  process.env.LAPRAS_SERVER_URL || "https://lapras-cli.onrender.com";

/**
 * Make an authenticated request to the Lapras backend.
 * @param {string} path - API path e.g. "/api/me"
 * @param {string} token - Access token from ~/.better-auth/token.json
 * @param {RequestInit} options - fetch options (method, body, etc.)
 */
export async function apiRequest(path, token, options = {}) {
  const url = `${LAPRAS_SERVER_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res;
}

/**
 * Convenience wrapper that parses JSON response.
 */
export async function apiGet(path, token) {
  const res = await apiRequest(path, token);
  return res.json();
}

/**
 * Convenience wrapper for POST requests.
 */
export async function apiPost(path, token, body) {
  const res = await apiRequest(path, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.json();
}
