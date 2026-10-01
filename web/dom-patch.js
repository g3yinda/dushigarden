(function (root, factory) {
  const api = factory();
  if (typeof module === "object") module.exports = api;
  else root.BoomDOM = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function key(node) {
    if (node.nodeType !== 1) return null;
    const explicit = node.getAttribute("data-render-key");
    if (explicit) return explicit;
    const action = node.getAttribute("data-action");
    return action ? `${node.nodeName}:${action}:${node.getAttribute("data-id") || node.getAttribute("data-seconds") || ""}` : null;
  }
  function sameKind(a, b) { return a?.nodeType === b.nodeType && a.nodeName === b.nodeName; }
  function patchNode(current, next) {
    if (current.nodeType === 3 || current.nodeType === 8) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    for (const attribute of Array.from(current.attributes))
      if (next.getAttribute(attribute.name) === null) current.removeAttribute(attribute.name);
    for (const attribute of Array.from(next.attributes))
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    patchChildren(current, next);
    // Attributes alone do not restore live form properties after user input.
    if (["INPUT", "SELECT", "TEXTAREA"].includes(current.nodeName)) {
      if (current.ownerDocument?.activeElement !== current && current.value !== next.value) current.value = next.value;
      if (current.nodeName === "INPUT" && ["checkbox", "radio"].includes(current.type)) current.checked = next.checked;
    }
  }
  function patchChildren(current, next) {
    const old = Array.from(current.childNodes), desired = Array.from(next.childNodes), used = new Set();
    const keyed = new Map(old.map(node => [key(node), node]).filter(([id]) => id));
    desired.forEach((node, i) => {
      const id = key(node);
      let existing = id ? keyed.get(id) : old[i];
      if (!id && (key(existing || { nodeType: 0 }) || used.has(existing))) existing = null;
      if (used.has(existing) || !sameKind(existing, node)) existing = null;
      if (existing) { patchNode(existing, node); used.add(existing); }
      else existing = node.cloneNode(true);
      const at = current.childNodes[i] || null;
      if (at !== existing) current.insertBefore(existing, at);
    });
    for (const node of old) if (!used.has(node) && node.parentNode === current) current.removeChild(node);
  }
  return { patchChildren };
});
