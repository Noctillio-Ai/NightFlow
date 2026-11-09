import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import {
  sshKeys,
  sshKeyByPath,
  addSshKeys,
  removeSshKey,
  scanSshKeys,
  inspectSshKey,
  refreshSshKeys,
  generateSshKey,
} from "../state/sshKeys.js";
import { sshKeyPath, withSshKey, isUsableKeyPath, sshHost } from "../utils/sshCommand.js";
import { platform } from "../state/dashboard.js";
import { isTopDialog } from "./Dialog.jsx";

// ── Icons ──

const I = {
  key: <><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  warn: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></>,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
};

function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {I[name]}
    </svg>
  );
}

const shortFp = (fp) => (fp ? (fp.length > 26 ? `${fp.slice(0, 22)}…` : fp) : null);
const keyKind = (k) => [k.keyType || k.key_type, k.bits].filter(Boolean).join(" ");
const tildePath = (p) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

/** Escape closes only this dialog, even when it sits on top of the wizard. */
function useOwnEscape(onClose, ref) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (!isTopDialog(ref.current)) return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
}

// ── Add keys dialog ──

/**
 * Lists the private keys in ~/.ssh to tick, plus a path field for keys kept
 * elsewhere. Nothing is added until the user confirms.
 * onAdded(paths) receives the paths that were added.
 */
export function AddSshKeysDialog({ onClose, onAdded, initialMode = "existing", host = "" }) {
  const [mode, setMode] = useState(initialMode); // "existing" | "create"
  const [found, setFound] = useState(null); // null while scanning
  const [scanError, setScanError] = useState("");
  const [extra, setExtra] = useState([]); // keys checked via the path field
  const [selected, setSelected] = useState(() => new Set());
  const [path, setPath] = useState("");
  const [checking, setChecking] = useState(false);
  const [pathError, setPathError] = useState("");
  const dialogRef = useRef(null);
  useOwnEscape(onClose, dialogRef);

  const added = sshKeyByPath.value;

  useEffect(() => {
    scanSshKeys()
      .then((list) => setFound(Array.isArray(list) ? list : []))
      .catch((err) => {
        setFound([]);
        setScanError(typeof err === "string" ? err : "Couldn't read ~/.ssh");
      });
  }, []);

  const rows = [...(found || []), ...extra.filter((e) => !(found || []).some((f) => f.path === e.path))];
  const selectable = (k) => !added.has(k.path) && isUsableKeyPath(k.path);

  function toggle(k) {
    if (!selectable(k)) return;
    const next = new Set(selected);
    next.has(k.path) ? next.delete(k.path) : next.add(k.path);
    setSelected(next);
  }

  async function checkPath() {
    if (!path.trim()) return;
    setChecking(true);
    setPathError("");
    try {
      const info = await inspectSshKey(path.trim());
      if (added.has(info.path)) {
        setPathError(`${info.name} is already added.`);
      } else {
        setExtra((x) => (x.some((e) => e.path === info.path) ? x : [...x, info]));
        if (isUsableKeyPath(info.path)) setSelected((s) => new Set(s).add(info.path));
        setPath("");
      }
    } catch (err) {
      setPathError(typeof err === "string" ? err : "Couldn't read that file.");
    } finally {
      setChecking(false);
    }
  }

  function confirm() {
    const picks = rows.filter((k) => selected.has(k.path));
    addSshKeys(picks);
    onAdded?.(picks.map((k) => k.path));
    onClose();
  }

  // Portalled to <body>: the wizard and settings panels animate with
  // transforms, which would otherwise trap this fixed overlay inside them.
  return createPortal(
    <div class="wizard-overlay ssk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} class="ssk-dialog" role="dialog" aria-modal="true" aria-labelledby="ssk-title">
        <header class="ssk-head">
          <span class="ssk-head-icon"><Icon name="key" size={20} /></span>
          <div class="ssk-head-text">
            <h2 id="ssk-title">{mode === "create" ? "Create an SSH key" : "Add SSH keys"}</h2>
            <p>
              {mode === "create"
                ? "Generate a new key pair in ~/.ssh and add it to NightFlow."
                : "Pick the keys NightFlow may use. Only the key you choose for a project is offered to its server."}
            </p>
          </div>
          <button class="ssk-icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>

        <div class="ssk-tabs" role="tablist" aria-label="How to add a key">
          {[["existing", "Choose existing", "folder"], ["create", "Create new", "spark"]].map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id ? "true" : "false"}
              class={`ssk-tab${mode === id ? " is-active" : ""}`}
              onClick={() => setMode(id)}
            >
              <Icon name={icon} size={14} /> {label}
            </button>
          ))}
        </div>

        {mode === "create" ? (
          <CreateKeyPane
            existingNames={new Set([...(found || []).map((k) => k.name), ...sshKeys.value.map((k) => k.name)])}
            host={host}
            onDone={(path) => { onAdded?.([path]); onClose(); }}
            onCancel={onClose}
          />
        ) : (
        <>
        <div class="ssk-body">
          <div class="ssk-subhead">
            <span>In ~/.ssh</span>
            {found && <span class="ssk-count">{found.length} found</span>}
          </div>
          {found === null ? (
            <div class="ssk-empty"><span class="ssk-spinner" /> Looking for keys…</div>
          ) : rows.length === 0 ? (
            <div class="ssk-empty">{scanError || "No private keys in ~/.ssh. Add one by path below."}</div>
          ) : (
            <div class="ssk-list" role="group" aria-label="Keys to add">
              {rows.map((k) => {
                const isAdded = added.has(k.path);
                const on = isAdded || selected.has(k.path);
                const usable = isUsableKeyPath(k.path);
                return (
                  <button
                    key={k.path}
                    type="button"
                    role="checkbox"
                    aria-checked={on ? "true" : "false"}
                    class={`ssk-pick${on ? " is-on" : ""}${isAdded ? " is-added" : ""}`}
                    disabled={isAdded || !usable}
                    onClick={() => toggle(k)}
                  >
                    <span class="ssk-check" aria-hidden="true">{on && <Icon name="check" size={12} />}</span>
                    <span class="ssk-key-text">
                      <span class="ssk-key-line">
                        <span class="ssk-key-name">{k.name}</span>
                        {keyKind(k) && <span class="ssk-chip">{keyKind(k)}</span>}
                        {isAdded && <span class="ssk-chip ssk-chip--ok">Added</span>}
                      </span>
                      <span class="ssk-key-meta">
                        {shortFp(k.fingerprint) || "Fingerprint unavailable (encrypted key without .pub)"}
                        {k.comment && <> · {k.comment}</>}
                      </span>
                      {!found?.some((f) => f.path === k.path) && <span class="ssk-key-path">{tildePath(k.path)}</span>}
                      {k.warning && (
                        <span class="ssk-warn"><Icon name="warn" size={12} /> {k.warning}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div class="ssk-subhead"><span>From another location</span></div>
          <div class="ssk-path-row">
            <span class="ssk-path-icon"><Icon name="folder" size={15} /></span>
            <input
              class="ssk-input"
              type="text"
              placeholder="/path/to/private_key"
              value={path}
              spellcheck={false}
              autoComplete="off"
              onInput={(e) => { setPath(e.target.value); setPathError(""); }}
              onKeyDown={(e) => e.key === "Enter" && checkPath()}
            />
            <button class="ssk-btn" onClick={checkPath} disabled={!path.trim() || checking}>
              {checking ? "Checking…" : "Check key"}
            </button>
          </div>
          {pathError && <p class="ssk-error" role="alert">{pathError}</p>}
        </div>

        <footer class="ssk-foot">
          <span class="ssk-foot-note">Keys stay where they are; NightFlow stores only their paths.</span>
          <button class="ssk-btn" onClick={onClose}>Cancel</button>
          <button class="ssk-btn ssk-btn--primary" onClick={confirm} disabled={selected.size === 0}>
            {selected.size === 0 ? "Add keys" : `Add ${selected.size} key${selected.size === 1 ? "" : "s"}`}
          </button>
        </footer>
        </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Create a key ──

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older webviews: fall back to a temporary selection.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      class="ssk-btn ssk-btn--sm"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
    >
      <Icon name={done ? "check" : "copy"} size={13} /> {done ? "Copied" : label}
    </button>
  );
}

const KEY_TYPES = [
  { id: "ed25519", label: "Ed25519", note: "Recommended. Small, fast and secure." },
  { id: "rsa", label: "RSA 4096", note: "For older servers that don't accept Ed25519." },
];

/** First free "nightflow_<type>[_n]" name. */
function suggestName(type, taken) {
  const base = `nightflow_${type}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

const NAME_RE = /^(?!\.)[A-Za-z0-9._-]{1,64}$/;

function CreateKeyPane({ existingNames, host, onDone, onCancel }) {
  const [type, setType] = useState("ed25519");
  const [name, setName] = useState(() => suggestName("ed25519", existingNames));
  const [nameEdited, setNameEdited] = useState(false);
  const [comment, setComment] = useState("nightflow");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { key, publicKey }

  const isMac = platform.value === "macos";
  const nameOk = NAME_RE.test(name) && !name.endsWith(".pub");
  const nameTaken = existingNames.has(name);
  const mismatch = passphrase !== "" && confirm !== "" && passphrase !== confirm;
  const canCreate = nameOk && !nameTaken && !busy && (passphrase === "" || passphrase === confirm);

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    try {
      const res = await generateSshKey({ name, keyType: type, comment: comment.trim(), passphrase });
      setResult({ ...res, usedPassphrase: passphrase !== "" });
      setPassphrase("");
      setConfirm("");
    } catch (err) {
      setError(typeof err === "string" ? err : "Couldn't create the key.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const pubPath = `${tildePath(result.key.path)}.pub`;
    const installCmd = `ssh-copy-id -i ${pubPath} ${host || "user@host"}`;
    const usedPassphrase = !!result.usedPassphrase;
    return (
      <>
        <div class="ssk-body">
          <div class="ssk-created">
            <span class="ssk-created-icon"><Icon name="check" size={18} /></span>
            <span class="ssk-key-text">
              <span class="ssk-key-line">
                <span class="ssk-key-name">{result.key.name}</span>
                <span class="ssk-chip">{keyKind(result.key)}</span>
                <span class="ssk-chip ssk-chip--ok">Added to NightFlow</span>
              </span>
              <span class="ssk-key-meta">{result.key.fingerprint}</span>
              <span class="ssk-key-path">{tildePath(result.key.path)}</span>
            </span>
          </div>

          <div class="ssk-subhead"><span>Public key</span></div>
          <div class="ssk-code">
            <pre>{result.publicKey}</pre>
            <CopyButton text={result.publicKey} />
          </div>

          <div class="ssk-subhead"><span>Let it log in</span></div>
          <p class="ssk-help">
            Add the public key to <code>~/.ssh/authorized_keys</code> on {host ? <code>{host}</code> : "the server"}, or paste it
            into your provider's SSH keys page. From a terminal that can already reach the server:
          </p>
          <div class="ssk-code">
            <pre>{installCmd}</pre>
            <CopyButton text={installCmd} />
          </div>
          {usedPassphrase && (
            <p class="ssk-help ssk-help--note">
              <Icon name="warn" size={13} /> NightFlow connects without a terminal, so it can't ask for the passphrase. Load the key into
              your agent first: <code>{isMac ? `ssh-add --apple-use-keychain ${tildePath(result.key.path)}` : `ssh-add ${tildePath(result.key.path)}`}</code>
            </p>
          )}
        </div>
        <footer class="ssk-foot">
          <span class="ssk-foot-note">The private key never leaves this machine.</span>
          <button class="ssk-btn ssk-btn--primary" onClick={() => onDone(result.key.path)}>Done</button>
        </footer>
      </>
    );
  }

  return (
    <>
      <div class="ssk-body">
        <div class="ssk-subhead"><span>Key type</span></div>
        <div class="ssk-types" role="radiogroup" aria-label="Key type">
          {KEY_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={type === t.id ? "true" : "false"}
              class={`ssk-pick ssk-type${type === t.id ? " is-on" : ""}`}
              onClick={() => {
                setType(t.id);
                if (!nameEdited) setName(suggestName(t.id, existingNames));
              }}
            >
              <span class="ssk-radio" aria-hidden="true" />
              <span class="ssk-key-text">
                <span class="ssk-key-name">{t.label}</span>
                <span class="ssk-type-note">{t.note}</span>
              </span>
            </button>
          ))}
        </div>

        <div class="ssk-form">
          <label class="ssk-field">
            <span class="ssk-label">File name</span>
            <span class="ssk-input-wrap">
              <span class="ssk-prefix">~/.ssh/</span>
              <input
                class="ssk-input"
                type="text"
                value={name}
                spellcheck={false}
                autoComplete="off"
                onInput={(e) => { setName(e.target.value.trim()); setNameEdited(true); setError(""); }}
              />
            </span>
            {!nameOk && name && <span class="ssk-error">Letters, numbers, ".", "_" and "-" only, not starting with a dot.</span>}
            {nameOk && nameTaken && <span class="ssk-error">~/.ssh/{name} already exists.</span>}
          </label>
          <label class="ssk-field">
            <span class="ssk-label">Comment <span class="ssk-optional">Optional</span></span>
            <span class="ssk-input-wrap">
              <input class="ssk-input" type="text" value={comment} placeholder="e.g. you@laptop" spellcheck={false} onInput={(e) => setComment(e.target.value)} />
            </span>
            <span class="ssk-hint">Shown next to the key on servers, to tell keys apart.</span>
          </label>
          <label class="ssk-field">
            <span class="ssk-label">Passphrase <span class="ssk-optional">Optional</span></span>
            <span class="ssk-input-wrap">
              <input class="ssk-input" type="password" value={passphrase} autoComplete="new-password" onInput={(e) => setPassphrase(e.target.value)} />
            </span>
            <span class="ssk-hint">Encrypts the key on disk. NightFlow will then need it loaded in ssh-agent.</span>
          </label>
          {passphrase && (
            <label class="ssk-field">
              <span class="ssk-label">Confirm passphrase</span>
              <span class="ssk-input-wrap">
                <input class="ssk-input" type="password" value={confirm} autoComplete="new-password" onInput={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
              </span>
              {mismatch && <span class="ssk-error">Passphrases don't match.</span>}
            </label>
          )}
        </div>
        {error && <p class="ssk-error" role="alert">{error}</p>}
      </div>
      <footer class="ssk-foot">
        <span class="ssk-foot-note">Creates <code>~/.ssh/{nameOk ? name : "…"}</code> and its <code>.pub</code>.</span>
        <button class="ssk-btn" onClick={onCancel}>Cancel</button>
        <button
          class="ssk-btn ssk-btn--primary"
          disabled={!canCreate}
          onClick={create}
        >
          {busy ? <><span class="ssk-spinner" /> Creating…</> : "Create key"}
        </button>
      </footer>
    </>
  );
}

// ── Key picker for a project's SSH command ──

const ADD = "__add__";
const DEFAULT = "";

/**
 * Chooses which added key a project's SSH command uses. Changing it rewrites
 * the command (`-i … -o IdentitiesOnly=yes`); "SSH config & agent" removes the
 * key flags again. The last option opens the Add keys dialog.
 */
export function SshKeySelect({ command, onChange, disabled, id, selectClass = "", wrapClass = "" }) {
  const [adding, setAdding] = useState(false);
  const current = sshKeyPath(command);
  const keys = sshKeys.value;
  const known = current ? sshKeyByPath.value.get(current) : null;
  const warning = known?.warning;

  return (
    <div class="ssk-select">
      <span class={wrapClass}>
        <select
          id={id}
          class={selectClass}
          value={current || DEFAULT}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === ADD) {
              e.target.value = current || DEFAULT;
              setAdding(true);
              return;
            }
            onChange(withSshKey(command, v || null));
          }}
        >
          <option value={DEFAULT}>SSH config &amp; agent (default)</option>
          {keys.map((k) => (
            <option key={k.path} value={k.path}>
              {k.name}{keyKind(k) ? ` · ${keyKind(k)}` : ""}
            </option>
          ))}
          {current && !known && <option value={current}>Custom: {current}</option>}
          <option value={ADD}>＋ Add or create a key…</option>
        </select>
      </span>
      {known && (
        <span class="ssk-key-meta" title={known.path}>
          {known.fingerprint || "Fingerprint unavailable"} · {tildePath(known.path)}
        </span>
      )}
      {warning && <span class="ssk-warn"><Icon name="warn" size={12} /> {warning}</span>}
      {adding && (
        <AddSshKeysDialog
          host={sshHost(command)}
          onClose={() => setAdding(false)}
          onAdded={(paths) => {
            // Adding from the picker also selects the (first) new key.
            if (paths[0]) onChange(withSshKey(command, paths[0]));
          }}
        />
      )}
    </div>
  );
}

// ── Manager for the settings page ──

/** Keys added to the app, with add / refresh / remove. */
export function SshKeysManager({ projectCommand }) {
  const [adding, setAdding] = useState(null); // null | "existing" | "create"
  const [refreshing, setRefreshing] = useState(false);
  const keys = sshKeys.value;
  const inUse = sshKeyPath(projectCommand);

  useEffect(() => {
    if (sshKeys.value.length) refreshSshKeys().catch(() => {});
  }, []);

  return (
    <div class="ssk-manager">
      <div class="ssk-toolbar">
        <p class="ssk-lede">
          {keys.length
            ? "Projects can use any of these keys. Pick one per project under Connection."
            : "No keys added yet. Remote projects use your SSH config and agent until you add one."}
        </p>
        {keys.length > 0 && (
          <button
            class="ssk-btn"
            onClick={async () => { setRefreshing(true); await refreshSshKeys().catch(() => {}); setRefreshing(false); }}
            disabled={refreshing}
            title="Re-check files and permissions"
          >
            <Icon name="refresh" size={14} /> {refreshing ? "Checking…" : "Re-check"}
          </button>
        )}
        <button class="ssk-btn" onClick={() => setAdding("create")}>
          <Icon name="spark" size={14} /> Create key
        </button>
        <button class="ssk-btn ssk-btn--primary" onClick={() => setAdding("existing")}>
          <Icon name="plus" size={14} /> Add keys
        </button>
      </div>

      {keys.length > 0 && (
        <div class="ssk-cards">
          {keys.map((k) => (
            <div key={k.path} class={`ssk-card${k.warning ? " has-warning" : ""}${inUse === k.path ? " is-in-use" : ""}`}>
              <span class="ssk-card-icon"><Icon name="key" size={16} /></span>
              <span class="ssk-key-text">
                <span class="ssk-key-line">
                  <span class="ssk-key-name">{k.name}</span>
                  {keyKind(k) && <span class="ssk-chip">{keyKind(k)}</span>}
                  {inUse === k.path && <span class="ssk-chip ssk-chip--tone">This project</span>}
                </span>
                <span class="ssk-key-meta" title={k.fingerprint || ""}>
                  {k.fingerprint || "Fingerprint unavailable"}
                </span>
                <span class="ssk-key-path" title={k.path}>{tildePath(k.path)}{k.comment ? ` · ${k.comment}` : ""}</span>
                {k.warning && <span class="ssk-warn"><Icon name="warn" size={12} /> {k.warning}</span>}
              </span>
              <button
                class="ssk-icon-btn ssk-remove"
                onClick={() => removeSshKey(k.path)}
                title={inUse === k.path ? "Remove from NightFlow (this project keeps using it until you change its key)" : "Remove from NightFlow"}
                aria-label={`Remove ${k.name}`}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddSshKeysDialog
          initialMode={adding}
          host={projectCommand ? sshHost(projectCommand) : ""}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
