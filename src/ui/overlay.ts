/** Keep blocking surfaces keyboard accessible and isolate the flight controls. */
export function createOverlayManager() {
  let active: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;
  const surfaces = ["modal", "missionDrawer"].map(id => document.getElementById(id)!);
  function set(surface: HTMLElement | null) {
    if (surface && !active) returnFocus = document.activeElement as HTMLElement;
    active = surface;
    for (const child of Array.from(document.body.children)) {
      if (child instanceof HTMLElement && child.tagName !== "SCRIPT") {
        child.inert = surface ? child !== surface : surfaces.includes(child) && child.classList.contains("hidden");
      }
    }
    if (surface) {
      surface.querySelector<HTMLElement>("button:not(:disabled), input, summary")?.focus();
    } else {
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
      else document.getElementById("flightMenuButton")?.focus();
      returnFocus = null;
    }
  }
  document.addEventListener("keydown", event => {
    if (event.key !== "Tab" || !active) return;
    const nodes = Array.from(active.querySelectorAll<HTMLElement>("button:not(:disabled), input, summary, [tabindex='0']"))
      .filter(node => node.getClientRects().length && !node.closest("[hidden], .hidden"));
    const first = nodes[0], last = nodes.at(-1);
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  return { set };
}
