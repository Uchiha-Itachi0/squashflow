/**
 * Styles for what pin mode puts on the page (U1 on the design canvas): the dark
 * toolbar, the numbered pin markers coloured by status, and the small comment box.
 * They live inside the shadow root, so they never reach the page. `all: initial` on the
 * host stops inherited page styles from reaching in; it is !important because a page's
 * own !important rules can match the host element, and important declarations from
 * inside the shadow root win over the page's.
 */

import { PAGE_MONO, PAGE_SANS } from "./page-fonts";

export const PIN_UI_CSS = `
:host {
  all: initial !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  z-index: 2147483647 !important;
  --accent: #5B4BFF;
  --accent-text: #4434E0;
  --text: #15151A;
  --muted: #5E5E66;
  --line: rgba(21, 21, 26, 0.14);
  --line-2: rgba(21, 21, 26, 0.16);
  --ok: #1E7F55;
  --warn: #C2701A;
  --sans: "${PAGE_SANS}", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "${PAGE_MONO}", ui-monospace, SFMono-Regular, Menlo, monospace;
  font: 14px/1.4 var(--sans) !important;
  color: var(--text) !important;
}
* { box-sizing: border-box; }
button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:focus-visible, textarea:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.layer { position: absolute; top: 0; left: 0; pointer-events: none; }
.box {
  position: absolute;
  border: 2px solid var(--accent);
  background: rgba(91, 75, 255, 0.06);
  border-radius: 6px;
}
.box.selected { border-style: dashed; }
.box.area { border-style: dashed; border-radius: 12px; }

.marker {
  position: absolute;
  pointer-events: auto;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  padding: 0;
  border-radius: 99px 99px 99px 4px;
  border: 2px solid var(--accent);
  background: #FFFFFF;
  color: var(--accent);
  font: 500 12px/1 var(--mono);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(21, 21, 26, 0.18);
}
.marker.s-sent, .marker.s-seen {
  background: var(--accent);
  border-color: var(--accent);
  color: #FFFFFF;
  box-shadow: 0 4px 12px rgba(91, 75, 255, 0.4);
}
.marker.s-approve-in-terminal, .marker.s-blocked {
  background: var(--warn);
  border-color: var(--warn);
  color: #FFFFFF;
  box-shadow: 0 4px 12px rgba(194, 112, 26, 0.35);
}
.marker.s-fixed { background: var(--ok); border-color: var(--ok); color: #FFFFFF; }
.marker.s-resolved { background: #85858C; border-color: #85858C; color: #FFFFFF; }
.marker svg { width: 14px; height: 14px; }

.composer {
  position: absolute;
  pointer-events: auto;
  width: 330px;
  padding: 14px;
  border-radius: 14px;
  background: #FFFFFF;
  border: 1px solid var(--line);
  box-shadow: 0 18px 40px rgba(21, 21, 26, 0.18);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.composer .head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); min-width: 0; }
.composer .head b { color: var(--text); font-size: 13px; flex-shrink: 0; }
.composer .head .where { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer textarea {
  height: 72px;
  resize: none;
  border-radius: 10px;
  border: 1px solid var(--accent);
  padding: 8px 10px;
  font-size: 14px;
  line-height: 1.4;
  background: #FFFFFF;
}
.composer .shot { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
.composer .row { display: flex; align-items: center; gap: 8px; }
.composer .hint { font-size: 12px; color: var(--muted); }
.spacer { flex-grow: 1; }
.btn {
  white-space: nowrap;
  height: 34px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid var(--line-2);
  background: #FFFFFF;
  font-size: 13px;
}
.btn.primary { border: none; background: var(--accent); color: #FFFFFF; font-weight: 600; }

.toolbar {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  pointer-events: auto;
  width: max-content;
  max-width: calc(100vw - 24px);
  height: 52px;
  padding: 0 8px;
  border-radius: 14px;
  background: #15151A;
  color: #D4D4DC;
  display: flex;
  align-items: center;
  gap: 4px;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
  font-size: 13px;
}
.tb {
  height: 36px;
  min-width: 36px;
  padding: 0 10px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: #D4D4DC;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}
.tb:hover { background: #24242C; color: #FFFFFF; }
.tb[aria-pressed="true"], .tb[aria-checked="true"] { background: #2A2A33; color: #FFFFFF; }
.tb svg { width: 16px; height: 16px; flex-shrink: 0; }
.pick { border: 1px dashed #6B5BFF; }

.toast {
  position: fixed;
  left: 50%;
  bottom: 84px;
  transform: translateX(-50%);
  max-width: min(520px, calc(100vw - 24px));
  padding: 8px 12px;
  border-radius: 10px;
  background: #FFFFFF;
  border: 1px solid var(--line);
  box-shadow: 0 8px 24px rgba(21, 21, 26, 0.16);
  font-size: 13px;
  pointer-events: none;
}
.toast:empty { display: none; }
.toast.error { border-color: rgba(184, 57, 43, 0.4); color: #7E2A20; }
`;
