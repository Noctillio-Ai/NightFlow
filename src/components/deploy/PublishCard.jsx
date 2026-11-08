import { useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../../utils/notifications.js";
import { useEscape } from "../../hooks/useEscape.js";
import { taskClassFor, sshFor, Field, Note, CheckIcon, UploadIcon, Svg } from "./shared.jsx";

const LICENSE_OPTIONS = [
  { id: "apache-2.0", label: "Apache 2.0" },
  { id: "mit", label: "MIT" },
  { id: "cc-by-4.0", label: "CC BY 4.0" },
  { id: "cc-by-sa-4.0", label: "CC BY-SA 4.0" },
  { id: "cc-by-nc-4.0", label: "CC BY-NC 4.0" },
  { id: "gpl-3.0", label: "GPL 3.0" },
  { id: "other", label: "Other" },
];

const HubIcon = ({ size }) => (
  <Svg size={size}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Svg>
);
const CloseIcon = ({ size }) => <Svg size={size}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>;

/** Side card + dialog: upload the checkpoint and a model card to the Hugging Face Hub. */
export function PublishCard({ run, project, hp }) {
  const taskType = run.taskType || project?.taskType || "Classification";
  const backbone = run.backbone || run.model || "unknown";

  const [open, setOpen] = useState(false);
  const [hfToken, setHfToken] = useState("");
  const [hfUsername, setHfUsername] = useState("");
  const [hfModelName, setHfModelName] = useState(run.name || run.id);
  const [isPrivate, setIsPrivate] = useState(false);
  const [title, setTitle] = useState(`${backbone} — ${taskType}`);
  const [description, setDescription] = useState(`${taskType} model trained with ${backbone} backbone using NightFlow + AutoTimm.`);
  const [license, setLicense] = useState("apache-2.0");
  const [tags, setTags] = useState(`nightflow, ${taskType.toLowerCase().replace(/ /g, "-")}, ${backbone}, computer-vision`);
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");

  const loading = status === "loading";
  useEscape(open && !loading, () => setOpen(false));

  const repoId = `${hfUsername.trim()}/${hfModelName.trim()}`;
  const missing = [!hfToken.trim() && "token", !hfUsername.trim() && "username", !hfModelName.trim() && "repository name"].filter(Boolean);

  async function push() {
    if (missing.length || !project) return;
    setStatus("loading");
    setError("");
    setResultUrl("");
    try {
      const result = await invoke("push_to_hub", {
        params: {
          projectPath: project.projectPath,
          runId: run.id,
          runName: run.name || run.id,
          repoId,
          hfToken: hfToken.trim(),
          taskClass: taskClassFor(taskType, project),
          taskType,
          backbone,
          numClasses: hp.num_classes || hp.numClasses || project?.numClasses || 10,
          imageSize: hp.image_size || hp.imageSize || 224,
          bestAcc: run.bestAcc || null,
          testAcc: run.testAcc || null,
          sshCommand: sshFor(project),
          private: isPrivate,
          modelName: title.trim(),
          description: description.trim(),
          license,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean).join(","),
        },
      });
      setStatus("done");
      setResultUrl(result.url);
      notify("Pushed to Hub", `Model uploaded to ${result.url}`);
    } catch (err) {
      setStatus("error");
      setError(String(err));
      notify("Push failed", String(err));
    }
  }

  return (
    <>
      <section class="rd-card dpm-hub">
        <div class="dpm-hub-row">
          <span class="dpm-hub-icon"><HubIcon size={18} /></span>
          <div class="dpm-hub-text">
            <strong>Hugging Face Hub</strong>
            {status === "done" && resultUrl ? (
              <a href={resultUrl} target="_blank" rel="noopener noreferrer" class="dpm-hub-link">{resultUrl.replace(/^https?:\/\//, "")}</a>
            ) : (
              <span>Share with a model card</span>
            )}
          </div>
          <button type="button" class="dash-btn dash-btn--sm" onClick={() => setOpen(true)}>
            {status === "done" ? <><CheckIcon size={13} /> Published</> : "Publish"}
          </button>
        </div>
      </section>

      {open && (
        <div class="modal-overlay" onClick={() => !loading && setOpen(false)}>
          <div class="modal-dialog dpm-modal" role="dialog" aria-modal="true" aria-labelledby="dpm-hub-title" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h2 class="modal-title" id="dpm-hub-title"><HubIcon size={17} /> Publish to Hugging Face</h2>
              <button type="button" class="modal-close-btn" onClick={() => setOpen(false)} disabled={loading} aria-label="Close"><CloseIcon size={16} /></button>
            </div>

            <div class="dpm-modal-body">
              <div class="dpm-group-label">Repository</div>
              <Field label="Access token" hint={<>Needs write access. Create one at <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer">huggingface.co/settings/tokens</a></>}>
                <input type="password" value={hfToken} onInput={(e) => setHfToken(e.currentTarget.value)} placeholder="hf_…" autocomplete="off" spellcheck={false} />
              </Field>
              <div class="dpm-field">
                <span class="dpm-field-label">Repository</span>
                <div class="dpm-repo">
                  <input type="text" value={hfUsername} onInput={(e) => setHfUsername(e.currentTarget.value)} placeholder="username" aria-label="Username or organization" spellcheck={false} />
                  <span aria-hidden="true">/</span>
                  <input type="text" value={hfModelName} onInput={(e) => setHfModelName(e.currentTarget.value)} placeholder="model-name" aria-label="Repository name" spellcheck={false} />
                </div>
              </div>
              <label class="dpm-switch">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.currentTarget.checked)} />
                <span class="dpm-switch-track"><span class="dpm-switch-thumb" /></span>
                Private repository
              </label>

              <div class="dpm-group-label dpm-group-label--sep">Model card</div>
              <Field label="Title">
                <input type="text" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
              </Field>
              <Field label="Description">
                <textarea rows={2} value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
              </Field>
              <div class="dpm-field-pair">
                <Field label="License">
                  <select value={license} onChange={(e) => setLicense(e.currentTarget.value)}>
                    {LICENSE_OPTIONS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </Field>
                <Field label="Tags">
                  <input type="text" value={tags} onInput={(e) => setTags(e.currentTarget.value)} />
                </Field>
              </div>

              {status === "done" && resultUrl && <Note>Published to <a href={resultUrl} target="_blank" rel="noopener noreferrer">{resultUrl}</a></Note>}
              {error && <Note tone="err">{error}</Note>}
            </div>

            <div class="modal-footer dpm-modal-foot">
              <span class="dpm-hint">
                {missing.length && !loading ? `Enter your ${missing.join(", ")}.` : <>Needs <code>huggingface_hub</code> on the training machine.</>}
              </span>
              <button type="button" class="dash-btn dash-btn--primary" onClick={push} disabled={loading || missing.length > 0}>
                {loading ? <span class="download-spinner" /> : <UploadIcon size={14} />}
                {loading ? "Uploading…" : status === "done" ? "Publish again" : "Publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
