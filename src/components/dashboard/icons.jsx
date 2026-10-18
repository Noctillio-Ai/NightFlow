// Line icons for the dashboard (24×24, stroke = currentColor).
function Icon({ size = 16, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const FlaskIcon = (p) => (
  <Icon {...p}><path d="M9 3h6M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3" /><path d="M7.5 15h9" /></Icon>
);
export const ChartBarsIcon = (p) => (
  <Icon {...p}><path d="M3 21h18" /><path d="M7 17v-6M12 17V7M17 17v-9" /></Icon>
);
export const CubeIcon = (p) => (
  <Icon {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></Icon>
);
export const DatabaseIcon = (p) => (
  <Icon {...p}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></Icon>
);
export const CropIcon = (p) => (
  <Icon {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></Icon>
);
export const PlayIcon = (p) => (
  <Icon {...p}><polygon points="6 4 20 12 6 20 6 4" /></Icon>
);
export const CheckCircleIcon = (p) => (
  <Icon {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></Icon>
);
export const TrophyIcon = (p) => (
  <Icon {...p}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></Icon>
);
export const ClockIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></Icon>
);
export const ChipIcon = (p) => (
  <Icon {...p}><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 15h3M2 9h3M2 15h3" /></Icon>
);
export const MemoryIcon = (p) => (
  <Icon {...p}><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 11v2M10 11v2M14 11v2M18 11v2M6 17v3M18 17v3" /></Icon>
);
export const DiskIcon = (p) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 14h18" /><circle cx="16.5" cy="17" r="0.6" fill="currentColor" /></Icon>
);
export const GpuIcon = (p) => (
  <Icon {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="9" cy="12" r="3" /><path d="M15 10h4M15 14h4M5 18v2M19 18v2" /></Icon>
);
export const ThermometerIcon = (p) => (
  <Icon {...p}><path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z" /></Icon>
);
export const RefreshIcon = (p) => (
  <Icon {...p}><path d="M21 4v6h-6" /><path d="M3 20v-6h6" /><path d="M5.5 9a7 7 0 0 1 11.6-2.6L21 10M3 14l3.9 3.6A7 7 0 0 0 18.5 15" /></Icon>
);
export const SlidersIcon = (p) => (
  <Icon {...p}><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2.5" fill="var(--bg-primary)" /><circle cx="15" cy="17" r="2.5" fill="var(--bg-primary)" /></Icon>
);
export const ChevronRightIcon = (p) => (
  <Icon {...p}><polyline points="9 6 15 12 9 18" /></Icon>
);
export const ChevronDownIcon = (p) => (
  <Icon {...p}><polyline points="6 9 12 15 18 9" /></Icon>
);
export const ArrowRightIcon = (p) => (
  <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
);
export const LineChartIcon = (p) => (
  <Icon {...p}><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-6" /></Icon>
);
export const TerminalIcon = (p) => (
  <Icon {...p}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></Icon>
);
export const FolderIcon = (p) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>
);
export const LayersIcon = (p) => (
  <Icon {...p}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></Icon>
);
export const PackageIcon = (p) => (
  <Icon {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5" /></Icon>
);
export const CheckIcon = (p) => (
  <Icon {...p}><polyline points="5 12.5 10 17 19 7" /></Icon>
);
export const XIcon = (p) => (
  <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>
);
export const AlertIcon = (p) => (
  <Icon {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></Icon>
);
export const LockIcon = (p) => (
  <Icon {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Icon>
);
export const CopyIcon = (p) => (
  <Icon {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></Icon>
);
