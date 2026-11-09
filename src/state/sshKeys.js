import { signal, computed } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";

// ── SSH keys added to NightFlow ──────────────────────────────────────────────
//
// The app only offers keys the user has added here. Stored per machine in
// localStorage as paths plus display details; key contents are never read or
// stored (the backend only looks at a key's first line and its .pub).
// A project uses a key by carrying `-i <path> -o IdentitiesOnly=yes` in its SSH
// command (utils/sshCommand.js).

const STORAGE_KEY = "nightflow-ssh-keys";

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list.filter((k) => k && typeof k.path === "string") : [];
  } catch {
    return [];
  }
}

/** [{ path, name, keyType, fingerprint, bits, comment, warning, addedAt }] */
export const sshKeys = signal(load());

export const sshKeyByPath = computed(
  () => new Map(sshKeys.value.map((k) => [k.path, k])),
);

function save(list) {
  sshKeys.value = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable: the list still works for this session */
  }
}

const fromInfo = (info) => ({
  path: info.path,
  name: info.name,
  keyType: info.key_type,
  fingerprint: info.fingerprint || null,
  bits: info.bits || null,
  comment: info.comment || null,
  warning: info.warning || null,
  addedAt: new Date().toISOString(),
});

/** Adds keys described by the backend (scan/inspect results); skips duplicates. */
export function addSshKeys(infos) {
  const have = new Set(sshKeys.value.map((k) => k.path));
  const fresh = infos.filter((i) => !have.has(i.path)).map(fromInfo);
  if (fresh.length) save([...sshKeys.value, ...fresh]);
  return fresh.length;
}

export function removeSshKey(path) {
  save(sshKeys.value.filter((k) => k.path !== path));
}

/** Private keys in ~/.ssh, for the picker. */
export const scanSshKeys = () => invoke("scan_ssh_keys");

/** Validates and describes a key anywhere on disk; rejects with a readable message. */
export const inspectSshKey = (path) => invoke("inspect_ssh_key", { path });

/**
 * Re-reads each added key, so moved/deleted files and fixed permissions show
 * up. Keys that can no longer be read keep their entry with a warning.
 */
export async function refreshSshKeys() {
  const next = await Promise.all(
    sshKeys.value.map(async (k) => {
      try {
        const info = await inspectSshKey(k.path);
        return { ...fromInfo(info), addedAt: k.addedAt };
      } catch (err) {
        return { ...k, warning: typeof err === "string" ? err : "This key can no longer be read." };
      }
    }),
  );
  save(next);
}

/**
 * Creates a key pair in ~/.ssh and adds it to NightFlow.
 * Resolves to { key, publicKey } (key is the stored entry).
 */
export async function generateSshKey({ name, keyType, comment, passphrase }) {
  const res = await invoke("generate_ssh_key", {
    name,
    keyType,
    comment,
    passphrase: passphrase || null,
  });
  addSshKeys([res.key]);
  return { key: sshKeyByPath.value.get(res.key.path), publicKey: res.public_key };
}
