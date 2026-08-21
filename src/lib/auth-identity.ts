export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
export const INTERNAL_AUTH_DOMAIN = "users.hush.invalid";

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string) {
  return USERNAME_PATTERN.test(normalizeUsername(value));
}

export function usernameToInternalEmail(value: string) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error("Username non valido");
  }
  return `${username}@${INTERNAL_AUTH_DOMAIN}`;
}

export function isStrongEnoughPassword(value: string) {
  return value.length >= 12;
}
