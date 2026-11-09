// Helpers for the project's SSH command string ("ssh [flags] user@host").
//
// The backend splits this string on whitespace everywhere it runs ssh or scp,
// so a key chosen in the app is expressed as flags in the command itself:
//   ssh -i /path/to/key -o IdentitiesOnly=yes user@host
// IdentitiesOnly makes ssh offer only that key instead of every key in the
// agent and ~/.ssh (which can also trip "Too many authentication failures").

const IDENTITIES_ONLY = "IdentitiesOnly=yes";

const tokens = (cmd) => String(cmd || "").trim().split(/\s+/).filter(Boolean);

/** Path given with -i, or null when the command relies on ssh defaults. */
export function sshKeyPath(cmd) {
  const t = tokens(cmd);
  for (let i = 1; i < t.length; i++) {
    if (t[i] === "-i" && t[i + 1]) return t[i + 1];
    if (t[i].startsWith("-i") && t[i].length > 2) return t[i].slice(2);
  }
  return null;
}

/**
 * The command with its key set to `keyPath`, or with key flags removed when
 * `keyPath` is null. Other flags and the destination are kept as they were.
 */
export function withSshKey(cmd, keyPath) {
  const t = tokens(cmd);
  if (!t.length) return keyPath ? `ssh -i ${keyPath} -o ${IDENTITIES_ONLY}` : "";
  const [bin, ...rest] = t;
  const kept = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-i") { i++; continue; }
    if (a.startsWith("-i") && a.length > 2) continue;
    if (a === "-o" && /^IdentitiesOnly=/i.test(rest[i + 1] || "")) { i++; continue; }
    if (/^-oIdentitiesOnly=/i.test(a)) continue;
    kept.push(a);
  }
  const keyFlags = keyPath ? ["-i", keyPath, "-o", IDENTITIES_ONLY] : [];
  return [bin, ...keyFlags, ...kept].join(" ");
}

/** "user@host" (or the last argument), for labels. */
export function sshHost(cmd) {
  const t = tokens(cmd);
  if (t.length < 2) return t[0] || "";
  return t.find((p, i) => i > 0 && p.includes("@") && !p.startsWith("-")) || t[t.length - 1];
}

/** A key path the commands here can carry (no whitespace). */
export const isUsableKeyPath = (p) => !!p && !/\s/.test(p);
