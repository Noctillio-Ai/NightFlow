/** Dashboard card: icon + title row with optional right-side content, then the body. */
export function Card({ icon, title, aside, class: extra = "", children, ...rest }) {
  return (
    <section class={`dash-card ${extra}`} {...rest}>
      {(icon || title || aside) && (
        <header class="dash-card-head">
          {icon && <span class="dash-card-icon">{icon}</span>}
          {title && <h3 class="dash-card-title">{title}</h3>}
          {aside && <div class="dash-card-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Small coloured status dot: ok | warn | err | idle | live. */
export function Dot({ state = "idle" }) {
  return <span class={`dash-dot dash-dot--${state}`} aria-hidden="true" />;
}
