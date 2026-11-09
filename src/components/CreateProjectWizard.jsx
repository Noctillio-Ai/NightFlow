import { CsvColumnFields } from "./CsvColumnFields.jsx";
import { invoke } from "@tauri-apps/api/core";
import { useState, useRef, useEffect } from "preact/hooks";
import { platform } from "../state/dashboard.js";
import {
  wizardOpen,
  wizardStep,
  wizardData,
  wizardCanProceed,
  closeWizard,
  wizardNext,
  wizardBack,
  wizardSetField,
  wizardCreate,
  STEP_COUNT,
  STEP_LABELS,
  TASK_TYPES,
  MODEL_CATEGORIES,
  YOLOX_MODEL_CATEGORIES,
  DETECTION_MODEL_CATEGORIES,
  SEGMENTATION_MODEL_CATEGORIES,
  DETECTION_ARCHS,
  SEG_HEAD_TYPES,
  DATASET_FORMATS,
  trainPathError,
  valPathError,
  testPathError,
} from "../state/projects.js";
import {
  wizardTutorialDismissed,
  wizardStepTips,
  maybeStartWizardTutorial,
  dismissWizardTutorial,
} from "../state/tutorial.js";
import { useEscape } from "../hooks/useEscape.js";
import { SshKeySelect } from "./SshKeys.jsx";
import { sshKeyPath, sshHost } from "../utils/sshCommand.js";
import { chooseImportFile } from "../state/transfer.js";
import { projectsBase, pathPlatform, isDefaultProjectPath } from "../utils/projectPaths.js";
import { ImportDialog } from "./ProjectTransfer.jsx";

// ── Icons (24px stroke set, matching the rest of the app) ──

const ICONS = {
  plug: <><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></>,
  laptop: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M2 20h20" /></>,
  server: <><rect x="2" y="3" width="20" height="8" rx="2" /><rect x="2" y="13" width="20" height="8" rx="2" /><path d="M6 7h.01M6 17h.01" /></>,
  pencil: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="1.5" /></>,
  cpu: <><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>,
  checkCircle: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 18l-6-6 6-6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
  bulb: <><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" /></>,
  tag: <><path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4Z" /><path d="M7 7h.01" /></>,
  tags: <><path d="M9 5H2v7l6.3 6.3a1 1 0 0 0 1.4 0l5.6-5.6a1 1 0 0 0 0-1.4Z" /><path d="m15 5 6.3 6.3a1 1 0 0 1 0 1.4L17 17" /><path d="M6 9h.01" /></>,
  layers: <><path d="m12 2 10 5-10 5L2 7Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>,
  shapes: <><circle cx="7.5" cy="7.5" r="4.5" /><rect x="12" y="12" width="9" height="9" rx="1.5" /></>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></>,
  scale: <><path d="M12 3v18M5 21h14M3 7h18" /><path d="m6 7-3 7a3 3 0 0 0 6 0Z" /><path d="m18 7-3 7a3 3 0 0 0 6 0Z" /></>,
  cloud: <path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4 12.5 3.5 3.5 0 0 0 6.5 19Z" />,
  flask: <><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></>,
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  table: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>,
  braces: <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  building: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />,
};

function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const TASK_ICONS = {
  Classification: "tag",
  "Multi-Label Classification": "tags",
  "Object Detection": "scan",
  "Semantic Segmentation": "layers",
  "Instance Segmentation": "shapes",
};
const TIER_ICONS = { Edge: "phone", Balanced: "scale", Cloud: "cloud", Research: "flask" };
const FORMAT_ICONS = {
  Folder: "folder",
  CSV: "table",
  JSONL: "braces",
  "COCO JSON": "braces",
  COCO: "braces",
  "PNG Masks": "image",
  Cityscapes: "building",
  VOC: "folder",
};

// Per-step header copy and icon. Order matches `steps` below.
const STEP_META = [
  { icon: "plug", title: "Where should training run?", desc: "Train on this machine, or connect to a GPU server over SSH." },
  { icon: "pencil", title: "Name your project", desc: "Pick something you'll recognise later. We'll create a folder for it." },
  { icon: "scan", title: "Choose a task", desc: "What should the model learn to do with your images?" },
  { icon: "cpu", title: "Pick a backbone tier", desc: "Trade speed for accuracy based on where the model will be deployed." },
  { icon: "database", title: "Connect your dataset", desc: "Tell NightFlow how your data is laid out and where it lives." },
  { icon: "sliders", title: "Training settings", desc: "Optional. Leave anything blank to use the recommended defaults." },
  { icon: "checkCircle", title: "Review and create", desc: "Check the details below. You can change most of them later." },
];

// ── Shared building blocks ──

/** A selectable card used for every single-choice list in the wizard. */
function Choice({ icon, label, desc, selected, disabled, badge, onSelect }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected ? "true" : "false"}
      class={`wizard-category wz-choice${selected ? " selected" : ""}${disabled ? " disabled" : ""}`}
      disabled={disabled}
      onClick={disabled ? undefined : onSelect}
    >
      {icon && (
        <span class="wz-choice-icon">
          <Icon name={icon} />
        </span>
      )}
      <span class="wz-choice-text">
        <span class="wizard-category-name">
          {label}
          {badge && <span class="wizard-coming-soon-badge">{badge}</span>}
        </span>
        {desc && <span class="wizard-category-desc">{desc}</span>}
      </span>
      <span class="wz-radio" aria-hidden="true" />
    </button>
  );
}

function Field({ label, htmlFor, required, optional, hint, wide, children }) {
  return (
    <div class={`wz-field${wide ? " wz-field--wide" : ""}`}>
      <label class="wz-label" for={htmlFor}>
        {label}
        {required && <span class="wizard-required-indicator" aria-hidden="true">*</span>}
        {optional && <span class="wizard-optional-indicator">Optional</span>}
      </label>
      {children}
      {hint && <p class="wz-hint">{hint}</p>}
    </div>
  );
}

function Section({ title, children, aside }) {
  return (
    <section class="wz-section">
      <div class="wz-section-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const enterToContinue = (e) => {
  if (e.key === "Enter" && wizardCanProceed.value) wizardNext();
};

// ── Wizard Tutorial Tip ──

function WizardTip({ stepIndex }) {
  if (wizardTutorialDismissed.value) return null;
  const tip = wizardStepTips[stepIndex];
  if (!tip) return null;

  return (
    <div class="wizard-tip" role="note">
      <div class="wizard-tip-icon">
        <Icon name="bulb" size={16} />
      </div>
      <div class="wizard-tip-content">
        <strong class="wizard-tip-title">Tip</strong>
        <p class="wizard-tip-body">{tip.body}</p>
      </div>
      <button class="wizard-tip-dismiss" onClick={dismissWizardTutorial} title="Hide tips" aria-label="Hide tips">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

// ── Step 0: SSH ──

function StepSSH() {
  const d = wizardData.value;
  const isRemote = d.connectionType === "remote";
  const [testStatus, setTestStatus] = useState("idle"); // "idle" | "testing" | "success" | "error"
  const [testMessage, setTestMessage] = useState("");

  const connectionTypes = [
    { id: "localhost", icon: "laptop", label: "This machine", desc: "Train locally on your own CPU or GPU" },
    { id: "remote", icon: "server", label: "Remote instance", desc: "Connect to a GPU server over SSH" },
  ];

  const isValidSshCommand = (cmd) => {
    const parts = cmd.trim().split(/\s+/);
    return parts.length >= 2 && parts[0] === "ssh";
  };

  const handleTestSSH = async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const msg = await invoke("test_ssh", { sshCommand: d.sshCommand });
      setTestStatus("success");
      setTestMessage(msg);
    } catch (err) {
      setTestStatus("error");
      setTestMessage(typeof err === "string" ? err : "Connection failed");
    }
  };

  return (
    <div class="wz-stack">
      <div class="wz-choice-grid" role="radiogroup" aria-label="Where training runs">
        {connectionTypes.map((type) => (
          <Choice
            key={type.id}
            icon={type.icon}
            label={type.label}
            desc={type.desc}
            selected={d.connectionType === type.id}
            onSelect={() => {
              wizardSetField("connectionType", type.id);
              setTestStatus("idle");
              setTestMessage("");
              if (type.id === "localhost") {
                wizardSetField("sshCommand", "localhost");
              } else {
                wizardSetField("sshCommand", "");
              }
            }}
          />
        ))}
      </div>

      {isRemote && (
        <Section title="SSH connection">
          <Field
            label="SSH command"
            htmlFor="wz-ssh"
            required
            hint={<>The same command you'd run in a terminal, e.g. <code>ssh -p 2222 user@gpu-server</code>.</>}
          >
            <div class="wz-input-row">
              <input
                id="wz-ssh"
                class="wizard-input wizard-input-mono"
                type="text"
                placeholder="ssh user@gpu-server.example.com"
                value={d.sshCommand}
                onInput={(e) => {
                  wizardSetField("sshCommand", e.target.value);
                  setTestStatus("idle");
                  setTestMessage("");
                }}
                onKeyDown={enterToContinue}
                autoComplete="off"
                spellcheck={false}
                autoFocus
              />
              <button
                type="button"
                class="wizard-btn wizard-btn-secondary wizard-ssh-test-btn"
                onClick={handleTestSSH}
                disabled={
                  !isValidSshCommand(d.sshCommand) || testStatus === "testing"
                }
              >
                {testStatus === "testing" ? <span class="wizard-ssh-spinner" /> : <Icon name="plug" size={15} />}
                {testStatus === "testing" ? "Testing…" : "Test connection"}
              </button>
            </div>
          </Field>
          <Field
            label="SSH key"
            htmlFor="wz-ssh-key"
            hint={
              sshKeyPath(d.sshCommand)
                ? "Only this key is offered to the server."
                : "Uses your SSH config and agent. Pick a key to use just that one."
            }
          >
            <SshKeySelect
              id="wz-ssh-key"
              command={d.sshCommand}
              selectClass="wizard-input"
              onChange={(cmd) => {
                wizardSetField("sshCommand", cmd);
                setTestStatus("idle");
                setTestMessage("");
              }}
            />
          </Field>
          {testMessage && (
            <div class={`wizard-ssh-test-result ${testStatus}`} role="status">
              <span class="wizard-ssh-test-icon">
                <Icon name={testStatus === "success" ? "check" : "x"} size={14} />
              </span>
              <span class="wizard-ssh-test-message">{testMessage}</span>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ── Step 1: Name ──

function StepName() {
  const d = wizardData.value;

  const sanitizeName = (name) => {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  // Remote projects live on the server, so their folder is always "~/…".
  const DEFAULT_BASE = projectsBase(pathPlatform(d.connectionType, platform.value));

  const derivedPath = d.name
    ? `${DEFAULT_BASE}${sanitizeName(d.name)}`
    : DEFAULT_BASE;

  // Auto while the path is still a default (in either path style), so going
  // back and switching between local and remote keeps it in the right style.
  const pathIsAuto = useRef(isDefaultProjectPath(d.projectPath, d.name));
  useEffect(() => {
    if (pathIsAuto.current && d.projectPath !== derivedPath) wizardSetField("projectPath", derivedPath);
  }, [derivedPath]);

  const handleNameInput = (e) => {
    const name = e.target.value;
    wizardSetField("name", name);
    if (pathIsAuto.current) {
      const sanitized = sanitizeName(name);
      wizardSetField(
        "projectPath",
        sanitized ? `${DEFAULT_BASE}${sanitized}` : DEFAULT_BASE,
      );
    }
  };

  const handlePathInput = (e) => {
    const val = e.target.value;
    if (val) {
      wizardSetField("projectPath", val);
      pathIsAuto.current = false;
    } else {
      wizardSetField("projectPath", derivedPath);
      pathIsAuto.current = true;
    }
  };

  const effectivePath = pathIsAuto.current ? derivedPath : d.projectPath;

  return (
    <div class="wz-stack">
      <Field label="Project name" htmlFor="wz-name" required>
        <input
          id="wz-name"
          class="wizard-input wz-input-lg"
          type="text"
          placeholder="e.g. ImageNet Classifier"
          value={d.name}
          onInput={handleNameInput}
          onKeyDown={enterToContinue}
          autoComplete="off"
          autoFocus
        />
      </Field>

      <Field
        label="Project folder"
        htmlFor="wz-path"
        optional
        hint="Leave blank to use the default location, named after your project."
      >
        <input
          id="wz-path"
          class="wizard-input wizard-input-mono"
          type="text"
          value={pathIsAuto.current ? "" : d.projectPath}
          placeholder={derivedPath}
          onInput={handlePathInput}
          onKeyDown={enterToContinue}
          spellcheck={false}
        />
      </Field>

      <div class="wz-path-preview">
        <span class="wz-path-preview-icon"><Icon name="folder" size={16} /></span>
        <span class="wz-path-preview-text">
          <span class="wz-path-preview-label">Files will be saved to</span>
          <code>{effectivePath}</code>
        </span>
      </div>
    </div>
  );
}

// ── Step 2: Task Type ──

const TASK_EXAMPLES = {
  Classification: (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      <defs>
        <linearGradient id="cls-photo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4a90d9" stop-opacity="0.15" />
          <stop offset="100%" stop-color="#67b26f" stop-opacity="0.15" />
        </linearGradient>
      </defs>
      {/* Photo card */}
      <rect
        x="20"
        y="16"
        width="84"
        height="84"
        rx="10"
        fill="url(#cls-photo)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      <rect
        x="28"
        y="24"
        width="68"
        height="50"
        rx="6"
        fill="var(--wz-tone)"
        opacity="0.06"
      />
      {/* Stylized photo icon */}
      <circle cx="48" cy="42" r="6" fill="var(--wz-tone)" opacity="0.18" />
      <polygon
        points="32,68 52,46 72,58 88,48 88,68"
        fill="var(--wz-tone)"
        opacity="0.12"
      />
      <text
        x="62"
        y="88"
        text-anchor="middle"
        font-size="8"
        font-weight="500"
        fill="var(--text-muted)"
      >
        image.jpg
      </text>
      {/* Arrow */}
      <path
        d="M112,58 L134,58"
        stroke="var(--text-muted)"
        stroke-width="1.5"
        stroke-linecap="round"
        marker-end="url(#cls-arrow)"
      />
      <polygon
        id="cls-arr"
        points="134,55 140,58 134,61"
        fill="var(--text-muted)"
      />
      {/* Output label card */}
      <rect
        x="148"
        y="34"
        width="56"
        height="48"
        rx="8"
        fill="var(--wz-tone)"
        opacity="0.08"
        stroke="var(--wz-tone)"
        stroke-width="1.2"
      />
      <text
        x="176"
        y="54"
        text-anchor="middle"
        font-size="10"
        font-weight="600"
        fill="var(--wz-tone)"
      >
        Cat
      </text>
      <text
        x="176"
        y="68"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        97.3%
      </text>
      {/* Bottom bar chart */}
      <text x="30" y="122" font-size="7" fill="var(--text-muted)">
        cat
      </text>
      <rect
        x="50"
        y="115"
        width="130"
        height="10"
        rx="3"
        fill="var(--wz-tone)"
        opacity="0.08"
      />
      <rect
        x="50"
        y="115"
        width="124"
        height="10"
        rx="3"
        fill="var(--wz-tone)"
        opacity="0.5"
      />
      <text x="30" y="138" font-size="7" fill="var(--text-muted)">
        dog
      </text>
      <rect
        x="50"
        y="131"
        width="130"
        height="10"
        rx="3"
        fill="var(--wz-tone)"
        opacity="0.08"
      />
      <rect
        x="50"
        y="131"
        width="18"
        height="10"
        rx="3"
        fill="var(--text-muted)"
        opacity="0.25"
      />
      <text x="30" y="154" font-size="7" fill="var(--text-muted)">
        bird
      </text>
      <rect
        x="50"
        y="147"
        width="130"
        height="10"
        rx="3"
        fill="var(--wz-tone)"
        opacity="0.08"
      />
      <rect
        x="50"
        y="147"
        width="6"
        height="10"
        rx="3"
        fill="var(--text-muted)"
        opacity="0.15"
      />
      <text
        x="110"
        y="174"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        One label per image
      </text>
    </svg>
  ),
  "Multi-Label Classification": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      <defs>
        <linearGradient id="ml-photo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e8a035" stop-opacity="0.15" />
          <stop offset="100%" stop-color="#5b9bd5" stop-opacity="0.15" />
        </linearGradient>
      </defs>
      {/* Photo card */}
      <rect
        x="20"
        y="24"
        width="84"
        height="84"
        rx="10"
        fill="url(#ml-photo)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      <rect
        x="28"
        y="32"
        width="68"
        height="50"
        rx="6"
        fill="var(--wz-tone)"
        opacity="0.06"
      />
      <circle cx="48" cy="48" r="6" fill="#e8a035" opacity="0.2" />
      <polygon
        points="32,76 52,54 72,66 88,56 88,76"
        fill="#5b9bd5"
        opacity="0.12"
      />
      <text
        x="62"
        y="98"
        text-anchor="middle"
        font-size="8"
        font-weight="500"
        fill="var(--text-muted)"
      >
        scene.jpg
      </text>
      {/* Arrow */}
      <path
        d="M112,66 L134,66"
        stroke="var(--text-muted)"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <polygon points="134,63 140,66 134,69" fill="var(--text-muted)" />
      {/* Tag list */}
      <rect
        x="148"
        y="28"
        width="56"
        height="22"
        rx="11"
        fill="var(--wz-tone)"
        opacity="0.12"
        stroke="var(--wz-tone)"
        stroke-width="1"
      />
      <text
        x="176"
        y="43"
        text-anchor="middle"
        font-size="8.5"
        font-weight="600"
        fill="var(--wz-tone)"
      >
        beach
      </text>
      <rect
        x="148"
        y="56"
        width="56"
        height="22"
        rx="11"
        fill="#e8a035"
        opacity="0.12"
        stroke="#e8a035"
        stroke-width="1"
      />
      <text
        x="176"
        y="71"
        text-anchor="middle"
        font-size="8.5"
        font-weight="600"
        fill="#e8a035"
      >
        sunset
      </text>
      <rect
        x="148"
        y="84"
        width="56"
        height="22"
        rx="11"
        fill="#5b9bd5"
        opacity="0.12"
        stroke="#5b9bd5"
        stroke-width="1"
      />
      <text
        x="176"
        y="99"
        text-anchor="middle"
        font-size="8.5"
        font-weight="600"
        fill="#5b9bd5"
      >
        ocean
      </text>
      {/* Checkmarks */}
      <path
        d="M152,39 l3,3 l6,-6"
        fill="none"
        stroke="var(--wz-tone)"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M152,67 l3,3 l6,-6"
        fill="none"
        stroke="#e8a035"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M152,95 l3,3 l6,-6"
        fill="none"
        stroke="#5b9bd5"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      {/* Confidence bars */}
      <text x="24" y="130" font-size="7" fill="var(--text-muted)">
        beach
      </text>
      <rect
        x="56"
        y="123"
        width="50"
        height="8"
        rx="2.5"
        fill="var(--wz-tone)"
        opacity="0.4"
      />
      <text x="110" y="130" font-size="7" fill="var(--text-muted)">
        91%
      </text>
      <text x="24" y="144" font-size="7" fill="var(--text-muted)">
        sunset
      </text>
      <rect
        x="56"
        y="137"
        width="44"
        height="8"
        rx="2.5"
        fill="#e8a035"
        opacity="0.4"
      />
      <text x="104" y="144" font-size="7" fill="var(--text-muted)">
        87%
      </text>
      <text x="24" y="158" font-size="7" fill="var(--text-muted)">
        ocean
      </text>
      <rect
        x="56"
        y="151"
        width="38"
        height="8"
        rx="2.5"
        fill="#5b9bd5"
        opacity="0.4"
      />
      <text x="98" y="158" font-size="7" fill="var(--text-muted)">
        78%
      </text>
      <text
        x="110"
        y="174"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Multiple labels per image
      </text>
    </svg>
  ),
  "Object Detection": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      {/* Image background */}
      <rect
        x="14"
        y="10"
        width="192"
        height="130"
        rx="10"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      {/* Ground */}
      <rect
        x="14"
        y="110"
        width="192"
        height="30"
        rx="0"
        fill="var(--text-muted)"
        opacity="0.04"
      />
      {/* Box A — tall rectangle */}
      <rect
        x="28"
        y="26"
        width="48"
        height="80"
        rx="3"
        fill="var(--wz-tone)"
        opacity="0.07"
        stroke="var(--wz-tone)"
        stroke-width="2"
      />
            {/* Small corner marks */}
      <line
        x1="28"
        y1="26"
        x2="36"
        y2="26"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <line
        x1="28"
        y1="26"
        x2="28"
        y2="34"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="26"
        x2="68"
        y2="26"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="26"
        x2="76"
        y2="34"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <line
        x1="28"
        y1="106"
        x2="36"
        y2="106"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <line
        x1="28"
        y1="106"
        x2="28"
        y2="98"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="106"
        x2="68"
        y2="106"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <line
        x1="76"
        y1="106"
        x2="76"
        y2="98"
        stroke="var(--wz-tone)"
        stroke-width="2.5"
      />
      <rect x="22" y="18" width="60" height="15" rx="4" fill="var(--wz-tone)" />
      <text
        x="52"
        y="29"
        text-anchor="middle"
        font-size="8"
        font-weight="600"
        fill="#0b0b14"
      >
        person 92%
      </text>
      {/* Box B — wide rectangle */}
      <rect
        x="94"
        y="54"
        width="80"
        height="52"
        rx="3"
        fill="#e8a035"
        opacity="0.07"
        stroke="#e8a035"
        stroke-width="2"
      />
            <line
        x1="94"
        y1="54"
        x2="102"
        y2="54"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="94"
        y1="54"
        x2="94"
        y2="62"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="54"
        x2="166"
        y2="54"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="54"
        x2="174"
        y2="62"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="94"
        y1="106"
        x2="102"
        y2="106"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="94"
        y1="106"
        x2="94"
        y2="98"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="106"
        x2="166"
        y2="106"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <line
        x1="174"
        y1="106"
        x2="174"
        y2="98"
        stroke="#e8a035"
        stroke-width="2.5"
      />
      <rect x="94" y="46" width="48" height="15" rx="4" fill="#e8a035" />
      <text
        x="118"
        y="57"
        text-anchor="middle"
        font-size="8"
        font-weight="600"
        fill="white"
      >
        car 88%
      </text>
      {/* Legend */}
      <rect
        x="30"
        y="150"
        width="10"
        height="10"
        rx="2"
        fill="var(--wz-tone)"
        opacity="0.5"
      />
      <text x="44" y="159" font-size="8" fill="var(--text-muted)">
        person
      </text>
      <rect
        x="90"
        y="150"
        width="10"
        height="10"
        rx="2"
        fill="#e8a035"
        opacity="0.5"
      />
      <text x="104" y="159" font-size="8" fill="var(--text-muted)">
        car
      </text>
      <text
        x="110"
        y="176"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Bounding boxes with class + confidence
      </text>
    </svg>
  ),
  "Semantic Segmentation": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      {/* Left image — grayscale placeholder */}
      <rect
        x="8"
        y="16"
        width="88"
        height="88"
        rx="8"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      <rect
        x="8"
        y="16"
        width="88"
        height="35"
        rx="8"
        fill="var(--text-muted)"
        opacity="0.06"
      />
      <rect
        x="8"
        y="68"
        width="88"
        height="36"
        fill="var(--text-muted)"
        opacity="0.04"
      />
      <rect
        x="36"
        y="36"
        width="32"
        height="42"
        fill="var(--text-muted)"
        opacity="0.08"
      />
      <text
        x="52"
        y="114"
        text-anchor="middle"
        font-size="7.5"
        font-weight="500"
        fill="var(--text-muted)"
      >
        Input
      </text>
      {/* Arrow */}
      <path
        d="M102,60 L116,60"
        stroke="var(--text-muted)"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <polygon points="116,57 122,60 116,63" fill="var(--text-muted)" />
      {/* Right image — colored mask */}
      <rect
        x="128"
        y="16"
        width="88"
        height="88"
        rx="8"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      {/* Sky region */}
      <rect
        x="128"
        y="16"
        width="88"
        height="35"
        rx="8"
        fill="#5b9bd5"
        opacity="0.35"
      />
      {/* Building region */}
      <rect
        x="156"
        y="36"
        width="32"
        height="42"
        fill="#e8a035"
        opacity="0.35"
      />
      {/* Ground region */}
      <rect
        x="128"
        y="68"
        width="88"
        height="36"
        fill="#70ad47"
        opacity="0.35"
      />
      <text
        x="172"
        y="114"
        text-anchor="middle"
        font-size="7.5"
        font-weight="500"
        fill="var(--text-muted)"
      >
        Mask
      </text>
      {/* Color legend */}
      <rect
        x="24"
        y="130"
        width="12"
        height="12"
        rx="3"
        fill="#5b9bd5"
        opacity="0.5"
      />
      <text
        x="40"
        y="140"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Sky
      </text>
      <rect
        x="74"
        y="130"
        width="12"
        height="12"
        rx="3"
        fill="#e8a035"
        opacity="0.5"
      />
      <text
        x="90"
        y="140"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Building
      </text>
      <rect
        x="140"
        y="130"
        width="12"
        height="12"
        rx="3"
        fill="#70ad47"
        opacity="0.5"
      />
      <text
        x="156"
        y="140"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Ground
      </text>
      {/* Pixel grid hint */}
      <line
        x1="128"
        y1="51"
        x2="216"
        y2="51"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <line
        x1="128"
        y1="68"
        x2="216"
        y2="68"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <line
        x1="156"
        y1="16"
        x2="156"
        y2="104"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <line
        x1="188"
        y1="16"
        x2="188"
        y2="104"
        stroke="white"
        stroke-width="0.3"
        opacity="0.4"
      />
      <text
        x="110"
        y="162"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Every pixel gets a class color
      </text>
    </svg>
  ),
  "Instance Segmentation": (
    <svg viewBox="0 0 220 180" class="wizard-task-svg">
      {/* Image background */}
      <rect
        x="14"
        y="10"
        width="192"
        height="120"
        rx="10"
        fill="var(--bg-primary)"
        stroke="var(--border-color)"
        stroke-width="1.2"
      />
      {/* Instance A — filled blob with border */}
      <rect
        x="24"
        y="28"
        width="52"
        height="78"
        rx="20"
        fill="var(--wz-tone)"
        opacity="0.15"
        stroke="var(--wz-tone)"
        stroke-width="2"
        stroke-dasharray="5 3"
      />
      <rect x="24" y="18" width="52" height="16" rx="5" fill="var(--wz-tone)" />
      <text
        x="50"
        y="29"
        text-anchor="middle"
        font-size="7.5"
        font-weight="600"
        fill="white"
      >
        person #1
      </text>
      {/* Instance B — filled blob with border */}
      <rect
        x="86"
        y="36"
        width="46"
        height="70"
        rx="18"
        fill="#c960cf"
        opacity="0.15"
        stroke="#c960cf"
        stroke-width="2"
        stroke-dasharray="5 3"
      />
      <rect x="86" y="26" width="46" height="16" rx="5" fill="#c960cf" />
      <text
        x="109"
        y="37"
        text-anchor="middle"
        font-size="7.5"
        font-weight="600"
        fill="white"
      >
        person #2
      </text>
      {/* Instance C — wider blob */}
      <ellipse
        cx="170"
        cy="82"
        rx="30"
        ry="22"
        fill="#e8a035"
        opacity="0.15"
        stroke="#e8a035"
        stroke-width="2"
        stroke-dasharray="5 3"
      />
      <rect x="148" y="52" width="44" height="16" rx="5" fill="#e8a035" />
      <text
        x="170"
        y="63"
        text-anchor="middle"
        font-size="7.5"
        font-weight="600"
        fill="white"
      >
        dog #1
      </text>
      {/* Legend */}
      <rect
        x="16"
        y="142"
        width="12"
        height="12"
        rx="3"
        fill="var(--wz-tone)"
        opacity="0.4"
        stroke="var(--wz-tone)"
        stroke-width="1"
      />
      <text
        x="32"
        y="152"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Instance 1
      </text>
      <rect
        x="88"
        y="142"
        width="12"
        height="12"
        rx="3"
        fill="#c960cf"
        opacity="0.4"
        stroke="#c960cf"
        stroke-width="1"
      />
      <text
        x="104"
        y="152"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Instance 2
      </text>
      <rect
        x="160"
        y="142"
        width="12"
        height="12"
        rx="3"
        fill="#e8a035"
        opacity="0.4"
        stroke="#e8a035"
        stroke-width="1"
      />
      <text
        x="176"
        y="152"
        font-size="8"
        font-weight="500"
        fill="var(--text-secondary)"
      >
        Instance 3
      </text>
      <text
        x="110"
        y="174"
        text-anchor="middle"
        font-size="8"
        fill="var(--text-muted)"
      >
        Unique mask + ID per object instance
      </text>
    </svg>
  ),
};

function StepTaskType() {
  const d = wizardData.value;
  const isDetection = d.taskType === "Object Detection";
  const isSeg = d.taskType === "Semantic Segmentation";
  const selectedTask = TASK_TYPES.find((t) => t.id === d.taskType);

  return (
    <div class="wz-stack">
      <div class="wz-split">
        <div class="wizard-category-list" role="radiogroup" aria-label="Task type">
          {TASK_TYPES.map((t) => {
            const isDisabled =
              t.id === "Multi-Label Classification" ||
              t.id === "Semantic Segmentation" ||
              t.id === "Instance Segmentation";
            return (
              <Choice
                key={t.id}
                icon={TASK_ICONS[t.id]}
                label={t.label}
                desc={t.desc}
                selected={d.taskType === t.id}
                disabled={isDisabled}
                badge={isDisabled ? "Coming soon" : null}
                onSelect={() => {
                  wizardSetField("taskType", t.id);
                  wizardSetField("datasetFormat", "");
                  wizardSetField("lossFn", "");
                }}
              />
            );
          })}
        </div>
        <div class="wz-preview wizard-task-preview">
          <div class="wizard-structure-header">Example output</div>
          <div class="wz-preview-art">
            {selectedTask ? (
              TASK_EXAMPLES[selectedTask.id]
            ) : (
              <p class="wz-preview-empty">Select a task to see what the model will produce.</p>
            )}
          </div>
        </div>
      </div>
      {isDetection && (
        <Section title="Detection architecture">
          <div class="wz-seg" role="radiogroup" aria-label="Detection architecture">
            {DETECTION_ARCHS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={d.detectionArch === a ? "true" : "false"}
                class={`wz-seg-btn${d.detectionArch === a ? " is-active" : ""}`}
                onClick={() => wizardSetField("detectionArch", a)}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>
        </Section>
      )}
      {isSeg && (
        <Section title="Segmentation head">
          <div class="wz-seg" role="radiogroup" aria-label="Segmentation head">
            {SEG_HEAD_TYPES.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={d.segHeadType === h ? "true" : "false"}
                class={`wz-seg-btn${d.segHeadType === h ? " is-active" : ""}`}
                onClick={() => wizardSetField("segHeadType", h)}
              >
                {h === "deeplabv3plus" ? "DeepLabV3+" : "FCN"}
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Model category preview data ──

// Benchmarks: timm v0.9, ImageNet-1K, 224×224, V100 batch=1
const MODEL_PREVIEWS = {
  Edge: {
    speed: 95,
    accuracy: 55,
    params: "1.97–6.11M",
    latency: "1.0–3.0 ms",
    gflops: "0.10–0.60 GMACs",
    target: "Mobile, IoT, Edge TPU",
    topAcc: "65.4–78.5%",
  },
  Balanced: {
    speed: 62,
    accuracy: 75,
    params: "5.3–12.2M",
    latency: "3.0–6.0 ms",
    gflops: "0.60–1.80 GMACs",
    target: "API servers, desktop apps",
    topAcc: "77.7–81.6%",
  },
  Cloud: {
    speed: 35,
    accuracy: 88,
    params: "86.7–196.5M",
    latency: "6.0–14.0 ms",
    gflops: "15.4–61.6 GMACs",
    target: "GPU servers, batch inference",
    topAcc: "83.7–86.3%",
  },
  Research: {
    speed: 15,
    accuracy: 96,
    params: "304.1–660.3M",
    latency: "12.0–35.0 ms",
    gflops: "61.6–525.0 GMACs",
    target: "A100 / H100 GPUs",
    topAcc: "88.6–90.0%",
  },
};

function getModelSource(d) {
  if (d.taskType === "Object Detection" && d.detectionArch === "yolox")
    return YOLOX_MODEL_CATEGORIES;
  if (d.taskType === "Object Detection") return DETECTION_MODEL_CATEGORIES;
  if (
    d.taskType === "Semantic Segmentation" ||
    d.taskType === "Instance Segmentation"
  )
    return SEGMENTATION_MODEL_CATEGORIES;
  return MODEL_CATEGORIES;
}

function ModelPreview({ category, modelSource }) {
  const info = (modelSource || MODEL_CATEGORIES)[category];
  const preview = MODEL_PREVIEWS[category];
  if (!info || !preview) return null;

  return (
    <div class="wz-preview wizard-model-preview">
      <div class="wizard-structure-header">{category} tier</div>
      {/* Speed vs Accuracy bars */}
      <div class="wizard-model-bars">
        {[
          ["Speed", preview.speed, "wizard-model-bar-speed"],
          ["Accuracy", preview.accuracy, "wizard-model-bar-acc"],
        ].map(([label, pct, cls]) => (
          <div key={label} class="wizard-model-bar-row">
            <span class="wizard-model-bar-label">{label}</span>
            <div class="wizard-model-bar-track" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div class={`wizard-model-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
      </div>
      {/* Stats grid */}
      <div class="wizard-model-stats">
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.params}</span>
          <span class="wizard-model-stat-label">Parameters</span>
        </div>
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.latency}</span>
          <span class="wizard-model-stat-label">Latency</span>
        </div>
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.gflops}</span>
          <span class="wizard-model-stat-label">GMACs</span>
        </div>
        <div class="wizard-model-stat">
          <span class="wizard-model-stat-value">{preview.topAcc}</span>
          <span class="wizard-model-stat-label">Top-1 ImageNet</span>
        </div>
        <div class="wizard-model-stat" style={{ gridColumn: "1 / -1" }}>
          <span class="wizard-model-stat-value">{preview.target}</span>
          <span class="wizard-model-stat-label">Deploy Target</span>
        </div>
      </div>
      {info.models?.length > 0 && (
        <div class="wz-model-list">
          <span class="wizard-structure-sample-label">Includes</span>
          <div class="wz-chips">
            {info.models.slice(0, 4).map((m) => (
              <code key={m} class="wz-chip" title={m}>{m}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Model Category ──

function StepModelCategory() {
  const d = wizardData.value;
  const source = getModelSource(d);
  const categories = Object.keys(source);

  return (
    <div class="wz-split">
      <div class="wizard-category-list" role="radiogroup" aria-label="Backbone tier">
        {categories.map((cat) => (
          <Choice
            key={cat}
            icon={TIER_ICONS[cat] || "cpu"}
            label={cat}
            desc={source[cat].desc}
            selected={d.modelCategory === cat}
            onSelect={() => wizardSetField("modelCategory", cat)}
          />
        ))}
      </div>
      {d.modelCategory ? (
        <ModelPreview category={d.modelCategory} modelSource={source} />
      ) : (
        <div class="wz-preview">
          <div class="wizard-structure-header">Tier details</div>
          <div class="wz-preview-art">
            <p class="wz-preview-empty">Select a tier to compare speed, accuracy and size.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dataset structure previews (AutoTimm conventions) ──

const STRUCTURE_PREVIEWS = {
  // ── Classification ──
  "Classification::Folder": {
    label: "ImageFolder",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train/", indent: 1 },
      { name: "cat/", indent: 2 },
      { name: "img_001.jpg", indent: 3, file: true },
      { name: "img_002.jpg", indent: 3, file: true },
      { name: "dog/", indent: 2 },
      { name: "img_003.jpg", indent: 3, file: true },
      { name: "val/", indent: 1 },
      { name: "cat/", indent: 2 },
      { name: "dog/", indent: 2 },
    ],
    note: "Subdirectory names are used as class labels.",
  },
  "Classification::CSV": {
    label: "CSV",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, label",
    sample: "images/img_001.jpg,cat\nimages/img_002.jpg,dog",
  },
  "Classification::JSONL": {
    label: "JSONL",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "One JSON object per line.",
    sample:
      '{"image": "images/img_001.jpg", "label": "cat"}\n{"image": "images/img_002.jpg", "label": "dog"}',
  },
  // ── Multi-Label Classification ──
  "Multi-Label Classification::CSV": {
    label: "CSV (Multi-Label)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, cat, dog (one 0/1 column per label)",
    sample:
      "image_path,cat,dog\nimages/img_001.jpg,1,0\nimages/img_002.jpg,0,1",
  },
  "Multi-Label Classification::JSONL": {
    label: "JSONL (Multi-Label)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "Labels as a JSON array.",
    sample:
      '{"image": "images/img_001.jpg", "labels": ["beach", "sunset"]}\n{"image": "images/img_002.jpg", "labels": ["mountain"]}',
  },
  // ── Object Detection ──
  "Object Detection::COCO JSON": {
    label: "COCO JSON",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "annotations/", indent: 1 },
      { name: "instances_train.json", indent: 2, file: true },
      { name: "instances_val.json", indent: 2, file: true },
      { name: "train/", indent: 1 },
      { name: "000001.jpg", indent: 2, file: true },
      { name: "val/", indent: 1 },
      { name: "000002.jpg", indent: 2, file: true },
    ],
    note: "Standard COCO format with images, annotations, and categories.",
  },
  "Object Detection::CSV": {
    label: "CSV (Detection)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, x_min, y_min, x_max, y_max, label",
    sample:
      "images/img_001.jpg,10,20,150,200,cat\nimages/img_001.jpg,180,30,300,180,dog",
  },
  "Object Detection::JSONL": {
    label: "JSONL (Detection)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
    ],
    note: "Each line: image + list of bounding boxes.",
    sample:
      '{"image": "images/img_001.jpg", "boxes": [\n  {"bbox": [10,20,150,200], "label": "cat"}\n]}',
  },
  // ── Semantic Segmentation ──
  "Semantic Segmentation::PNG Masks": {
    label: "PNG Masks",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "images/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "img_001.jpg", indent: 3, file: true },
      { name: "val/", indent: 2 },
      { name: "img_002.jpg", indent: 3, file: true },
      { name: "masks/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "img_001.png", indent: 3, file: true },
      { name: "val/", indent: 2 },
      { name: "img_002.png", indent: 3, file: true },
    ],
    note: "Mask pixel values correspond to class indices (0, 1, 2, …).",
  },
  "Semantic Segmentation::COCO": {
    label: "COCO Segmentation",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "annotations/", indent: 1 },
      { name: "panoptic_train.json", indent: 2, file: true },
      { name: "panoptic_val.json", indent: 2, file: true },
      { name: "train/", indent: 1 },
      { name: "000001.jpg", indent: 2, file: true },
      { name: "val/", indent: 1 },
      { name: "000002.jpg", indent: 2, file: true },
    ],
    note: "COCO panoptic format with segmentation polygons.",
  },
  "Semantic Segmentation::Cityscapes": {
    label: "Cityscapes",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "leftImg8bit/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "aachen/", indent: 3 },
      { name: "aachen_000000_leftImg8bit.png", indent: 4, file: true },
      { name: "gtFine/", indent: 1 },
      { name: "train/", indent: 2 },
      { name: "aachen/", indent: 3 },
      { name: "aachen_000000_gtFine_labelIds.png", indent: 4, file: true },
    ],
    note: "Standard Cityscapes directory layout with city subfolders.",
  },
  "Semantic Segmentation::VOC": {
    label: "Pascal VOC",
    tree: [
      { name: "VOCdevkit/", indent: 0 },
      { name: "VOC2012/", indent: 1 },
      { name: "JPEGImages/", indent: 2 },
      { name: "2007_000001.jpg", indent: 3, file: true },
      { name: "SegmentationClass/", indent: 2 },
      { name: "2007_000001.png", indent: 3, file: true },
      { name: "ImageSets/", indent: 2 },
      { name: "Segmentation/", indent: 3 },
      { name: "train.txt", indent: 4, file: true },
      { name: "val.txt", indent: 4, file: true },
    ],
    note: "VOC segmentation masks with ImageSets split files.",
  },
  "Semantic Segmentation::CSV": {
    label: "CSV (Segmentation)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "img_001.jpg", indent: 2, file: true },
      { name: "masks/", indent: 1 },
      { name: "img_001.png", indent: 2, file: true },
    ],
    note: "CSV columns: image_path, mask_path",
    sample:
      "images/img_001.jpg,masks/img_001.png\nimages/img_002.jpg,masks/img_002.png",
  },
  "Semantic Segmentation::JSONL": {
    label: "JSONL (Segmentation)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "masks/", indent: 1 },
    ],
    note: "Each line maps image to mask path.",
    sample: '{"image": "images/img_001.jpg", "mask": "masks/img_001.png"}',
  },
  // ── Instance Segmentation ──
  "Instance Segmentation::COCO JSON": {
    label: "COCO Instance",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "annotations/", indent: 1 },
      { name: "instances_train.json", indent: 2, file: true },
      { name: "instances_val.json", indent: 2, file: true },
      { name: "train/", indent: 1 },
      { name: "000001.jpg", indent: 2, file: true },
      { name: "val/", indent: 1 },
      { name: "000002.jpg", indent: 2, file: true },
    ],
    note: "COCO format with per-instance segmentation polygons and bboxes.",
  },
  "Instance Segmentation::CSV": {
    label: "CSV (Instance)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.csv", indent: 1, file: true },
      { name: "val.csv", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "masks/", indent: 1 },
    ],
    note: "CSV columns: image_path, mask_path, label, instance_id",
    sample:
      "images/img_001.jpg,masks/img_001_0.png,person,0\nimages/img_001.jpg,masks/img_001_1.png,car,1",
  },
  "Instance Segmentation::JSONL": {
    label: "JSONL (Instance)",
    tree: [
      { name: "dataset/", indent: 0 },
      { name: "train.jsonl", indent: 1, file: true },
      { name: "val.jsonl", indent: 1, file: true },
      { name: "images/", indent: 1 },
      { name: "masks/", indent: 1 },
    ],
    note: "Each line: image + list of instance annotations.",
    sample:
      '{"image": "images/img_001.jpg", "instances": [\n  {"mask": "masks/001_0.png", "label": "person"}\n]}',
  },
};

const TreeIconFolder = () => (
  <svg
    class="wizard-tree-icon wizard-tree-icon-dir"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const TreeIconFile = () => (
  <svg
    class="wizard-tree-icon wizard-tree-icon-file"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function StructurePreview({ taskType, format }) {
  const key = `${taskType}::${format}`;
  const info = STRUCTURE_PREVIEWS[key];
  if (!info) return null;

  return (
    <div class="wz-preview wizard-structure-preview">
      <div class="wizard-structure-header">Expected layout</div>
      <div class="wizard-structure-tree">
        {info.tree.map((item, i) => (
          <div
            key={i}
            class="wizard-tree-line"
            style={{ paddingLeft: `${item.indent * 16}px` }}
          >
            <span class={item.file ? "wizard-tree-file" : "wizard-tree-dir"}>
              {item.file ? <TreeIconFile /> : <TreeIconFolder />}
              {item.name}
            </span>
          </div>
        ))}
      </div>
      {info.sample && (
        <div class="wizard-structure-sample">
          <div class="wizard-structure-sample-label">Example</div>
          <pre class="wizard-structure-code">{info.sample}</pre>
        </div>
      )}
      <div class="wizard-structure-note">{info.note}</div>
    </div>
  );
}

// ── Step 4: Dataset Format ──

function StepDataset() {
  const d = wizardData.value;
  const formats = DATASET_FORMATS[d.taskType] || [];
  const isCsvOrJsonl = d.datasetFormat === "CSV" || d.datasetFormat === "JSONL";
  const needsFolderPath = d.datasetFormat && !isCsvOrJsonl; // All formats except CSV/JSONL need folder path
  // Detection reads its class count from the annotations instead of asking for it.
  const isDetection = d.taskType === "Object Detection";
  const fileExtension =
    d.datasetFormat === "CSV"
      ? "csv"
      : d.datasetFormat === "JSONL"
        ? "jsonl"
        : null;

  const handleFolderPathInput = (e) => {
    const value = e.target.value;
    wizardSetField("folderPath", value);
  };

  // Auto-detect class names when folder path or train path changes
  useEffect(() => {
    const path = d.datasetFormat === "Folder" ? d.folderPath : d.trainPath;
    if (!path || !path.trim()) {
      wizardSetField("classNames", []);
      return;
    }
    const format = d.datasetFormat || "Folder";
    const sshCmd = d.connectionType === "remote" ? d.sshCommand : null;
    let cancelled = false;
    invoke("browse_dataset", {
      path: path.trim(),
      format,
      sshCommand: sshCmd,
      offset: 0,
      limit: 0,
      classFilter: null,
      imageFolder: d.imageFolderPath || null,
      imageColumn: d.imageColumn?.trim() || null,
      labelColumn: d.labelColumn?.trim() || null,
      labelColumns: d.taskType === "Multi-Label Classification" ? (d.labelColumns || "").split(",").map((v) => v.trim()).filter(Boolean) : null,
      search: null,
      split: null,
    }).then((result) => {
      if (!cancelled && result?.class_counts) {
        const names = Object.keys(result.class_counts).sort();
        wizardSetField("classNames", names);
        if (isDetection ? names.length > 0 : names.length >= 2 && !d.numClasses) {
          wizardSetField("numClasses", names.length);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [d.folderPath, d.trainPath, d.datasetFormat, d.imageFolderPath, d.imageColumn, d.labelColumn, d.labelColumns]);

  // COCO detection: count the categories in the annotation file.
  useEffect(() => {
    if (!isDetection || d.datasetFormat !== "COCO JSON" || d.connectionType === "remote" || !d.folderPath.trim()) return;
    let cancelled = false;
    invoke("validate_dataset_structure", {
      path: d.folderPath.trim(),
      taskType: d.taskType,
      format: d.datasetFormat,
    }).then((result) => {
      const categories = Number(result?.info?.categories);
      if (!cancelled) wizardSetField("numClasses", categories > 0 ? categories : "");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [d.folderPath, d.datasetFormat, d.taskType, d.connectionType]);

  const handleTrainPathInput = (e) => {
    wizardSetField("trainPath", e.target.value);
  };

  const handleValPathInput = (e) => {
    wizardSetField("valPath", e.target.value);
  };

  const handleTestPathInput = (e) => {
    wizardSetField("testPath", e.target.value);
  };

  const winPath = platform.value === "windows";
  const classNames = Array.isArray(d.classNames) ? d.classNames : [];

  return (
    <div class="wz-stack">
      <div class="wz-split">
        <div class="wizard-category-list" role="radiogroup" aria-label="Dataset format">
          {formats.map((f) => (
            <Choice
              key={f.id}
              icon={FORMAT_ICONS[f.id] || "folder"}
              label={f.label}
              desc={f.desc}
              selected={d.datasetFormat === f.id}
              onSelect={() => {
                wizardSetField("datasetFormat", f.id);
                // Clear validation errors when changing format
                trainPathError.value = "";
                valPathError.value = "";
                testPathError.value = "";
              }}
            />
          ))}
        </div>
        {d.datasetFormat ? (
          <StructurePreview taskType={d.taskType} format={d.datasetFormat} />
        ) : (
          <div class="wz-preview">
            <div class="wizard-structure-header">Expected layout</div>
            <div class="wz-preview-art">
              <p class="wz-preview-empty">Select a format to see how files should be organised.</p>
            </div>
          </div>
        )}
      </div>

      {d.datasetFormat && (
        <Section
          title="Location"
          aside={
            classNames.length > 0 && (
              <span class="wz-detected" title={classNames.join(", ")}>
                <Icon name="check" size={13} />
                {classNames.length} {classNames.length === 1 ? "class" : "classes"} found
              </span>
            )
          }
        >
          <div class="wz-grid">
            {needsFolderPath && (
              <Field label="Dataset folder" htmlFor="wz-folder" required wide>
                <input
                  id="wz-folder"
                  class="wizard-input wizard-input-mono"
                  type="text"
                  placeholder={winPath ? "C:\\path\\to\\dataset" : "/path/to/dataset"}
                  value={d.folderPath}
                  onInput={handleFolderPathInput}
                  onKeyDown={enterToContinue}
                  spellcheck={false}
                />
              </Field>
            )}
            {isCsvOrJsonl && (
              <>
                <Field label="Train file" htmlFor="wz-train" required wide>
                  <input
                    id="wz-train"
                    class="wizard-input wizard-input-mono"
                    type="text"
                    placeholder={winPath ? `C:\\path\\to\\train.${fileExtension}` : `/path/to/train.${fileExtension}`}
                    value={d.trainPath}
                    onInput={handleTrainPathInput}
                    spellcheck={false}
                  />
                </Field>
                <Field label="Validation file" htmlFor="wz-val" optional>
                  <input
                    id="wz-val"
                    class="wizard-input wizard-input-mono"
                    type="text"
                    placeholder={winPath ? `C:\\path\\to\\val.${fileExtension}` : `/path/to/val.${fileExtension}`}
                    value={d.valPath}
                    onInput={handleValPathInput}
                    spellcheck={false}
                  />
                </Field>
                <Field label="Test file" htmlFor="wz-test" optional>
                  <input
                    id="wz-test"
                    class="wizard-input wizard-input-mono"
                    type="text"
                    placeholder={winPath ? `C:\\path\\to\\test.${fileExtension}` : `/path/to/test.${fileExtension}`}
                    value={d.testPath}
                    onInput={handleTestPathInput}
                    onKeyDown={enterToContinue}
                    spellcheck={false}
                  />
                </Field>
                <Field
                  label="Image folder"
                  htmlFor="wz-images"
                  optional
                  wide
                  hint="Base folder that relative image paths in your files are resolved against."
                >
                  <input
                    id="wz-images"
                    class="wizard-input wizard-input-mono"
                    type="text"
                    placeholder={winPath ? "C:\\path\\to\\images" : "/path/to/images"}
                    value={d.imageFolderPath}
                    onInput={(e) => wizardSetField("imageFolderPath", e.target.value)}
                    spellcheck={false}
                  />
                </Field>
              </>
            )}
            {!isDetection && (
              <Field
                label="Number of classes"
                htmlFor="wz-classes"
                required
                hint={classNames.length >= 2 ? "Filled in from your dataset. Adjust if needed." : "How many distinct labels your dataset has."}
              >
                <input
                  id="wz-classes"
                  class="wizard-input"
                  type="number"
                  min="2"
                  placeholder="e.g. 10"
                  value={d.numClasses}
                  onInput={(e) =>
                    wizardSetField(
                      "numClasses",
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  onKeyDown={enterToContinue}
                />
              </Field>
            )}
          </div>
          {classNames.length > 0 && (
            <div class="wz-chips wz-class-chips">
              {classNames.slice(0, 12).map((c) => (
                <span key={c} class="wz-chip">{c}</span>
              ))}
              {classNames.length > 12 && (
                <span class="wz-chip wz-chip--more">+{classNames.length - 12} more</span>
              )}
            </div>
          )}
        </Section>
      )}

      {d.datasetFormat === "CSV" && (
        <Section title="CSV columns">
          <CsvColumnFields value={d} onChange={wizardSetField} />
        </Section>
      )}
    </div>
  );
}

// ── Step 5.5: Advanced Settings ──

function StepAdvanced() {
  const d = wizardData.value;
  const isDetection = d.taskType === "Object Detection";

  const numField = (field) => (e) =>
    wizardSetField(field, e.target.value === "" ? "" : Number(e.target.value));

  return (
    <div class="wz-stack">
      <Section title="Schedule">
        <div class="wz-grid">
          <Field label="Max epochs" htmlFor="wz-epochs" hint="Full passes over the training set.">
            <input
              id="wz-epochs"
              class="wizard-input"
              type="number"
              min="1"
              placeholder="10"
              value={d.maxEpochs}
              onInput={numField("maxEpochs")}
            />
          </Field>
          <Field label="Learning rate" htmlFor="wz-lr" hint="Leave empty for the AutoTimm default.">
            <input
              id="wz-lr"
              class="wizard-input"
              type="number"
              step="any"
              placeholder="auto"
              value={d.learningRate}
              onInput={numField("learningRate")}
            />
          </Field>
          <Field label="Batch size" htmlFor="wz-batch" hint="Samples per training step.">
            <input
              id="wz-batch"
              class="wizard-input"
              type="number"
              min="1"
              placeholder="auto"
              value={d.batchSize}
              onInput={numField("batchSize")}
            />
          </Field>
          <Field label="Optimizer" htmlFor="wz-opt" hint="Optimisation algorithm.">
            <select
              id="wz-opt"
              class="wizard-input"
              value={d.optimizer}
              onChange={(e) => wizardSetField("optimizer", e.target.value)}
            >
              <option value="">Auto (default)</option>
              <option value="adamw">AdamW</option>
              <option value="adam">Adam</option>
              <option value="sgd">SGD</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Early stopping">
        <div class={`wz-toggle${d.earlyStopping ? " is-on" : ""}`}>
          <div class="wz-toggle-text">
            <span class="wz-label" id="wz-es-label">Stop when progress stalls</span>
            <p class="wz-hint">Halt training after a number of epochs with no improvement.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={d.earlyStopping ? "true" : "false"}
            aria-labelledby="wz-es-label"
            class={`wz-switch${d.earlyStopping ? " on" : ""}`}
            onClick={() => wizardSetField("earlyStopping", !d.earlyStopping)}
          >
            <span class="wz-switch-thumb" />
          </button>
        </div>
        {d.earlyStopping && (
          <div class="wz-grid">
            <Field
              label="Monitor metric"
              htmlFor="wz-monitor"
              hint={isDetection ? "Detection is monitored on validation mAP." : "Metric to watch for improvement."}
            >
              <select
                id="wz-monitor"
                class="wizard-input"
                value={isDetection ? "val/map" : d.earlyStoppingMonitor}
                disabled={isDetection}
                onChange={(e) => wizardSetField("earlyStoppingMonitor", e.target.value)}
              >
                {isDetection ? (
                  // Detection logs no validation loss or accuracy.
                  <option value="val/map">Validation mAP</option>
                ) : (
                  <>
                    <option value="val/loss">Validation loss</option>
                    <option value="val/accuracy">Validation accuracy</option>
                  </>
                )}
              </select>
            </Field>
            <Field label="Patience" htmlFor="wz-patience" hint="Epochs to wait before stopping.">
              <input
                id="wz-patience"
                class="wizard-input"
                type="number"
                min="1"
                placeholder="10"
                value={d.earlyStoppingPatience}
                onInput={numField("earlyStoppingPatience")}
              />
            </Field>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Step 6: Confirm ──

function StepConfirm() {
  const d = wizardData.value;
  const isCsvOrJsonl = d.datasetFormat === "CSV" || d.datasetFormat === "JSONL";
  const isRemote = d.connectionType === "remote";

  const groups = [
    {
      title: "Connection",
      step: 0,
      rows: [
        [isRemote ? "SSH command" : "Runs on", isRemote ? d.sshCommand : "This machine", isRemote],
        isRemote ? ["SSH key", sshKeyPath(d.sshCommand) ? sshKeyPath(d.sshCommand).split(/[\\/]/).pop() : "SSH config & agent", !!sshKeyPath(d.sshCommand)] : null,
      ],
    },
    {
      title: "Project",
      step: 1,
      rows: [
        ["Name", d.name],
        d.projectPath ? ["Folder", d.projectPath, true] : null,
      ],
    },
    {
      title: "Model",
      step: 2,
      rows: [
        ["Task", d.taskType],
        d.taskType === "Object Detection" ? ["Architecture", d.detectionArch.toUpperCase()] : null,
        d.taskType === "Semantic Segmentation"
          ? ["Segmentation head", d.segHeadType === "deeplabv3plus" ? "DeepLabV3+" : "FCN"]
          : null,
        ["Backbone tier", d.modelCategory],
      ],
    },
    {
      title: "Dataset",
      step: 4,
      rows: [
        ["Format", d.datasetFormat],
        d.numClasses ? ["Classes", d.numClasses] : null,
        !isCsvOrJsonl && d.folderPath ? ["Folder", d.folderPath, true] : null,
        isCsvOrJsonl && d.trainPath ? ["Train", d.trainPath, true] : null,
        isCsvOrJsonl && d.valPath ? ["Validation", d.valPath, true] : null,
        isCsvOrJsonl && d.testPath ? ["Test", d.testPath, true] : null,
        isCsvOrJsonl && d.imageFolderPath ? ["Image folder", d.imageFolderPath, true] : null,
        d.datasetFormat === "CSV" && d.imageColumn ? ["Image column", d.imageColumn, true] : null,
        d.datasetFormat === "CSV" && (d.labelColumns || d.labelColumn)
          ? ["Label column(s)", d.taskType === "Multi-Label Classification" ? d.labelColumns : d.labelColumn, true]
          : null,
      ],
    },
    {
      title: "Training",
      step: 5,
      rows: [
        ["Max epochs", d.maxEpochs || 10],
        ["Learning rate", d.learningRate !== "" ? d.learningRate : "Auto"],
        ["Batch size", d.batchSize !== "" ? d.batchSize : "Auto"],
        ["Optimizer", d.optimizer ? d.optimizer.toUpperCase().replace("ADAMW", "AdamW").replace("ADAM", "Adam") : "Auto"],
        ["Early stopping", d.earlyStopping ? `On · patience ${d.earlyStoppingPatience || 10}` : "Off"],
      ],
    },
  ];

  return (
    <div class="wz-stack">
      <div class="wz-summary">
        <span class="wz-summary-icon">
          <Icon name={TASK_ICONS[d.taskType] || "scan"} size={22} />
        </span>
        <div class="wz-summary-text">
          <span class="wz-summary-name">{d.name}</span>
          <div class="wz-chips">
            <span class="wz-chip">{d.taskType}</span>
            <span class="wz-chip">{d.modelCategory}</span>
            <span class="wz-chip">{d.datasetFormat}</span>
            <span class="wz-chip">{isRemote ? "Remote" : "Local"}</span>
          </div>
        </div>
      </div>

      <div class="wz-review">
        {groups.map((g) => (
          <section key={g.title} class="wz-review-group">
            <div class="wz-review-head">
              <h3>{g.title}</h3>
              <button type="button" class="wz-link" onClick={() => (wizardStep.value = g.step)}>
                Edit
              </button>
            </div>
            <dl class="wizard-confirm-table">
              {g.rows.filter(Boolean).map(([label, value, mono]) => (
                <div key={label} class="wizard-confirm-row">
                  <dt class="wizard-confirm-label">{label}</dt>
                  <dd class={`wizard-confirm-value${mono ? " is-mono" : ""}`} title={String(value)}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Steps array ──

const steps = [
  StepSSH,
  StepName,
  StepTaskType,
  StepModelCategory,
  StepDataset,
  StepAdvanced,
  StepConfirm,
];

/** One-line answer shown under each completed step in the rail. */
function stepSummary(i, d) {
  switch (i) {
    case 0:
      return d.connectionType === "remote" ? (d.sshCommand.trim() ? sshHost(d.sshCommand) : "Remote") : "This machine";
    case 1:
      return d.name.trim();
    case 2:
      return d.taskType;
    case 3:
      return d.modelCategory;
    case 4:
      return d.datasetFormat;
    case 5:
      return d.learningRate !== "" || d.batchSize !== "" || d.optimizer ? "Custom" : "Defaults";
    default:
      return "";
  }
}

// ── Wizard Shell ──

export function CreateProjectWizard() {
  if (!wizardOpen.value) return null;
  return <WizardDialog />;
}

function WizardDialog() {
  const step = wizardStep.value;
  const d = wizardData.value;
  const isLast = step === STEP_COUNT - 1;
  const StepComponent = steps[step];
  const meta = STEP_META[step];
  const progress = Math.round((step / (STEP_COUNT - 1)) * 100);

  useEffect(() => {
    maybeStartWizardTutorial();
  }, []);
  // Importing an export is the other way to start a project.
  const [importFile, setImportFile] = useState(null);
  const [importError, setImportError] = useState("");
  const [picking, setPicking] = useState(false);
  // While the Import dialog is open, Escape belongs to it.
  useEscape(!importFile, closeWizard);

  async function pickImport() {
    setImportError("");
    setPicking(true);
    try {
      const file = await chooseImportFile();
      if (file) setImportFile(file);
    } catch (e) {
      setImportError(e?.message || String(e));
    } finally {
      setPicking(false);
    }
  }

  const importButton = (extraClass = "") => (
    <button type="button" class={`wz-import-btn${extraClass}`} onClick={pickImport} disabled={picking}>
      <Icon name="download" size={15} />
      {picking ? "Opening…" : "Import a project"}
    </button>
  );

  return (
    <div class="wizard-overlay">
      <div
        class="wizard-card wz"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wz-title"
        aria-describedby="wz-desc"
      >
        <aside class="wz-rail">
          <div class="wz-brand">
            <span class="wz-brand-mark">
              <Icon name="layers" size={18} />
            </span>
            <div>
              <div class="wz-brand-title">New project</div>
              <div class="wz-brand-sub">{STEP_COUNT} quick steps</div>
            </div>
          </div>

          <ol class="wz-steps">
            {STEP_LABELS.map((label, i) => {
              const state = i < step ? "is-done" : i === step ? "is-current" : "is-upcoming";
              const summary = i < step ? stepSummary(i, d) : "";
              return (
                <li key={label} class={state}>
                  <button
                    type="button"
                    class="wz-step"
                    disabled={i >= step}
                    aria-current={i === step ? "step" : undefined}
                    onClick={() => (wizardStep.value = i)}
                  >
                    <span class="wz-step-dot">
                      {i < step ? <Icon name="check" size={13} /> : i + 1}
                    </span>
                    <span class="wz-step-text">
                      <span class="wz-step-label">{label}</span>
                      {summary && <span class="wz-step-summary">{summary}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div class="wz-rail-foot">
            <div class="wz-import">
              <span class="wz-import-text">Have an export from NightFlow?</span>
              {importButton()}
              {importError && <span class="wz-import-error" role="alert">{importError}</span>}
            </div>
            <div class="wz-progress" aria-hidden="true">
              <div class="wz-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}% complete</span>
          </div>
        </aside>

        <section class="wz-main">
          <header class="wz-head">
            <span class="wz-head-icon">
              <Icon name={meta.icon} size={22} />
            </span>
            <div class="wz-head-text">
              <span class="wz-eyebrow">
                Step {step + 1} of {STEP_COUNT} · {STEP_LABELS[step]}
              </span>
              <h2 id="wz-title">{meta.title}</h2>
              <p id="wz-desc">{meta.desc}</p>
            </div>
            <button class="wizard-close-btn" onClick={closeWizard} aria-label="Close" title="Close (Esc)">
              <Icon name="x" size={16} />
            </button>
            <div class="wz-head-progress" aria-hidden="true">
              <div class="wz-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </header>

          <div class="wizard-body">
            {importError && <p class="wz-import-error wz-import-error--body" role="alert">{importError}</p>}
            <WizardTip stepIndex={step} />
            <div class="wz-step-content" key={step}>
              <StepComponent />
            </div>
          </div>

          <footer class="wizard-footer">
            <button
              type="button"
              class="wizard-btn wizard-btn-secondary"
              onClick={step === 0 ? closeWizard : wizardBack}
            >
              {step !== 0 && <Icon name="arrowLeft" size={15} />}
              {step === 0 ? "Cancel" : "Back"}
            </button>
            {/* Narrow windows hide the rail; offer import here instead. */}
            {importButton(" wz-import-btn--footer")}
            <button
              type="button"
              class="wizard-btn wizard-btn-primary"
              disabled={!wizardCanProceed.value}
              onClick={isLast ? wizardCreate : wizardNext}
            >
              {isLast ? "Create project" : "Continue"}
              <Icon name={isLast ? "check" : "arrowRight"} size={15} />
            </button>
          </footer>
        </section>
      </div>
      {importFile && (
        <ImportDialog
          file={importFile}
          project={null}
          onClose={() => setImportFile(null)}
          onImported={() => {
            setImportFile(null);
            closeWizard();
          }}
        />
      )}
    </div>
  );
}
