// Adapted from the supplied Tahoe reference: the rounded edge bends transmitted
// light with a circular falloff. Text remains outside the backdrop filter.
const NS = "http://www.w3.org/2000/svg";
const SURFACES = ".modal-card,.user-context-menu,.user-status-menu,.emoji-picker-popover,.message-options,.music-source-form,.incoming-call-card,.hush-profile-popover,.hush-profile-role-picker,.call-widget-popover,.toast,.composer,.chat-header,.call-widget";
const CONTROLS = "button:not(:disabled),.composer,.auth-input";
export const MAX_GLASS_LENSES = 12;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function glassVector(x: number, y: number, width: number, height: number, radius: number, bezel: number): [number, number] {
  const px = x - width / 2, py = y - height / 2;
  const qx = Math.abs(px) - (width / 2 - radius), qy = Math.abs(py) - (height / 2 - radius);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), length = Math.hypot(ox, oy);
  const distance = Math.min(Math.max(qx, qy), 0) + length - radius;
  if (distance > 1 || distance < -bezel) return [128, 128];
  const nx = length ? ox / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
  const ny = length ? oy / length * Math.sign(py) : qy >= qx ? Math.sign(py) : 0;
  const depth = clamp(-distance / bezel);
  const edge = 1 - Math.sqrt((2 - depth) * depth);
  return [Math.round(128 - nx * edge * 127), Math.round(128 - ny * edge * 127)];
}

function displacement(width: number, height: number, radius: number) {
  const scale = Math.min(1, 384 / width, 256 / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(canvas.width, canvas.height);
  const bezel = Math.min(18, Math.min(width, height) / 3);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const [r, g] = glassVector((x + .5) / scale, (y + .5) / scale, width, height, radius, bezel);
    const offset = (y * canvas.width + x) * 4;
    image.data[offset] = r; image.data[offset + 1] = g; image.data[offset + 2] = 128; image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

let nextInstance = 0;
export function installLiquidGlass() {
  const reduced = window.matchMedia("(prefers-reduced-transparency: reduce)");
  const contrast = window.matchMedia("(prefers-contrast: more)");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fine = window.matchMedia("(pointer: fine)");
  const chromium = /(?:Chrome|Chromium|Edg)\/\d+/.test(navigator.userAgent);
  const instance = ++nextInstance;
  const lenses = new Map<HTMLElement, { filter: SVGFilterElement; key: string }>();
  const maps = new Map<string, string>();
  const host = document.createElementNS(NS, "svg");
  host.setAttribute("width", "0"); host.setAttribute("height", "0"); host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-hush-glass-host", "");
  Object.assign(host.style, { position: "fixed", pointerEvents: "none", overflow: "hidden" });
  document.body.append(host);
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, frame = 0;
  let glowing: HTMLElement | null = null;
  let pointer = { x: 0, y: 0 };
  const allowed = () => !reduced.matches && !contrast.matches;
  const release = (element: HTMLElement) => {
    lenses.get(element)?.filter.remove(); lenses.delete(element);
    element.style.removeProperty("--liquid-refraction"); delete element.dataset.liquidLens;
    resize.unobserve(element);
  };
  const build = (element: HTMLElement) => {
    // offset dimensions ignore hover/press transforms, so interaction never
    // regenerates a map. Large panes and touch devices keep the CSS material.
    const width = element.offsetWidth, height = element.offsetHeight;
    if (!width || !height || width * height > 480000) { if (lenses.has(element)) release(element); return; }
    const radius = Math.min(parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0, width / 2, height / 2);
    const key = `${width}:${height}:${radius}`;
    if (lenses.get(element)?.key === key) return;
    let field = maps.get(key);
    if (!field) {
      field = displacement(width, height, radius) ?? undefined;
      if (!field) return;
      if (maps.size >= MAX_GLASS_LENSES) maps.delete(maps.keys().next().value!);
      maps.set(key, field);
    }
    let entry = lenses.get(element);
    if (!entry) {
      const filter = document.createElementNS(NS, "filter");
      filter.id = `hush-lens-${instance}-${++lensId}`;
      filter.setAttribute("color-interpolation-filters", "sRGB");
      filter.setAttribute("filterUnits", "userSpaceOnUse");
      filter.setAttribute("x", "0"); filter.setAttribute("y", "0");
      host.append(filter); entry = { filter, key: "" }; lenses.set(element, entry);
      resize.observe(element);
    }
    const filter = entry.filter;
    filter.setAttribute("width", String(width)); filter.setAttribute("height", String(height));
    // Only generated numeric dimensions and our own canvas URL enter the SVG.
    const blur = element.matches(".composer,.chat-header,.call-widget") ? 1.4 : 5;
    filter.innerHTML = `<feImage href="${field}" width="${width}" height="${height}" preserveAspectRatio="none" result="edge"/><feDisplacementMap in="SourceGraphic" in2="edge" scale="16" xChannelSelector="R" yChannelSelector="G" result="bend"/><feGaussianBlur in="bend" stdDeviation="${blur}"/>`;
    entry.key = key;
    element.style.setProperty("--liquid-refraction", `url("#${filter.id}") saturate(1.16)`);
    element.dataset.liquidLens = "true";
  };
  let lensId = 0;
  const scan = () => {
    timer = undefined;
    if (disposed) return;
    if (glowing && !glowing.isConnected) clearGlow();
    for (const element of lenses.keys()) if (!element.isConnected || !allowed() || !fine.matches) release(element);
    if (!allowed() || !fine.matches || !chromium) return;
    for (const element of document.querySelectorAll<HTMLElement>(SURFACES)) {
      if (lenses.size >= MAX_GLASS_LENSES && !lenses.has(element)) continue;
      if (element.parentElement?.closest("[data-liquid-lens]")) continue;
      try { build(element); } catch { if (lenses.has(element)) release(element); }
    }
  };
  const schedule = () => { if (!disposed && timer === undefined) timer = setTimeout(scan, 100); };
  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver(records => {
    const newSurface = records.some(record => [...record.addedNodes].some(node => node instanceof Element && (node.matches(SURFACES) || node.querySelector(SURFACES))));
    if (newSurface || [...lenses.keys()].some(element => !element.isConnected)) schedule();
  });
  mutations.observe(document.body, { childList: true, subtree: true });
  const clearGlow = () => {
    glowing?.style.removeProperty("--glass-pointer-x"); glowing?.style.removeProperty("--glass-pointer-y");
    glowing?.removeAttribute("data-glass-hover"); glowing = null;
  };
  const move = (event: PointerEvent) => {
    if (!fine.matches || !allowed() || motion.matches || document.hidden) return;
    const element = (event.target as Element).closest<HTMLElement>(CONTROLS);
    if (element !== glowing) { clearGlow(); glowing = element; }
    if (!element) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!glowing?.isConnected) return;
      const rect = glowing.getBoundingClientRect();
      glowing.style.setProperty("--glass-pointer-x", `${pointer.x - rect.left}px`);
      glowing.style.setProperty("--glass-pointer-y", `${pointer.y - rect.top}px`);
      glowing.dataset.glassHover = "true";
    });
  };
  const preference = () => { clearGlow(); schedule(); };
  for (const query of [reduced, contrast, motion, fine]) query.addEventListener("change", preference);
  document.addEventListener("pointermove", move, { passive: true });
  document.documentElement.addEventListener("pointerleave", clearGlow);
  window.addEventListener("blur", clearGlow);
  scan();
  return () => {
    disposed = true; clearTimeout(timer); cancelAnimationFrame(frame); clearGlow();
    mutations.disconnect(); resize.disconnect();
    for (const element of lenses.keys()) release(element);
    maps.clear(); host.remove();
    for (const query of [reduced, contrast, motion, fine]) query.removeEventListener("change", preference);
    document.removeEventListener("pointermove", move);
    document.documentElement.removeEventListener("pointerleave", clearGlow);
    window.removeEventListener("blur", clearGlow);
  };
}
