// The password never leaves the browser. We send a PBKDF2 proof instead; the SpacetimeDB module
// stores a salted, iterated hash of that proof (spacetimedb/src/reducers/accounts.ts).
const ITERATIONS = 150_000;

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase();
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const MIN_PASSWORD_LENGTH = 8;

export async function passwordProof(username: string, password: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(`stockup:v1:${normalizeUsername(username)}`),
      iterations: ITERATIONS,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
