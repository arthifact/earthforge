// Small DOM helpers for the page.
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
export function button(text: string, action: () => void, className = "button") {
  const node = element("button", text, className); node.type = "button"; node.onclick = action; return node;
}
