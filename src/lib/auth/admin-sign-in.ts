// Pure helper.

const ADMIN_PATH = /^\/admin(?:\/[A-Za-z0-9._~-]+)*\/?$/;

/** Sign-in URL that returns to the requested admin page; non-admin paths fall back to /admin. */
export function adminSignInPath(pathname: string): string {
  const path = (pathname ?? "").split(/[?#]/)[0];
  const next = ADMIN_PATH.test(path) && !path.includes("..") ? path : "/admin";
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
