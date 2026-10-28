/**
 * Styles for the pin UI. They live inside the shadow root, so they never reach the
 * page. `all: initial` on the host stops inherited page styles from reaching in; it is
 * !important because a page's own !important rules can match the host element, and
 * important declarations from inside the shadow root win over the page's.
 */

import { SQUISH_VIOLET } from "../constants";

export const PIN_UI_CSS = `
:host {
  all: initial !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  z-index: 2147483647 !important;
  --violet: ${SQUISH_VIOLET};
  --violet-dark: #4B3FD1;
  --ink: #1D1640;
  --muted: #6B6785;
  --paper: #FFFFFF;
  --line: #E4E1F5;
  --amber: #F5A524;
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif !important;
  color: var(--ink) !important;
}
* { box-sizing: border-box; }
button, select, textarea { font: inherit; color: inherit; }
button {
  cursor: pointer;
  border: 1px solid var(--line);
  background: var(--paper);
  border-radius: 6px;
  padding: 3px 8px;
}
button:hover { border-color: var(--violet); }
button:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--violet);
  outline-offset: 1px;
}
button.primary { background: var(--violet); border-color: var(--violet); color: #fff; }
button.primary:hover { background: var(--violet-dark); }
button.danger:hover { border-color: #D93F5B; color: #D93F5B; }

.layer { position: absolute; top: 0; left: 0; pointer-events: none; }
.box {
  position: absolute;
  border: 2px solid var(--violet);
  background: rgba(107, 91, 255, 0.08);
  border-radius: 3px;
}
.box.selected { border-style: dashed; }
.box.area { background: rgba(107, 91, 255, 0.12); }

.marker {
  position: absolute;
  pointer-events: auto;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  padding: 0;
  border: 2px solid #fff;
  border-radius: 50% 50% 50% 4px;
  background: var(--violet);
  color: #fff;
  font-weight: 700;
  font-size: 11px;
  box-shadow: 0 2px 6px rgba(29, 22, 64, 0.35);
}

.panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 340px;
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(29, 22, 64, 0.22);
}
.panel header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.squish { width: 30px; height: 30px; flex: none; }
.squish svg { width: 100%; height: 100%; display: block; }
.title { font-weight: 700; flex: 1; }
.modes { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.modes button { border: 0; border-radius: 0; }
.modes button[aria-pressed="true"] { background: var(--violet); color: #fff; }
.hint { padding: 6px 10px; color: var(--muted); font-size: 12px; border-bottom: 1px solid var(--line); }
.list { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
.list li { display: flex; gap: 8px; align-items: flex-start; padding: 6px 10px; }
.list li:hover { background: #F6F5FE; }
.badge {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--violet);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.pin-status .row { display: flex; gap: 6px; align-items: center; }
.pin-status .spacer { flex: 1; }
.pin-state { display: inline-flex; align-items: center; gap: 4px; padding-left: 2px; }
.mini-squish { width: 16px; height: 16px; display: inline-block; }
.mini-squish svg { width: 100%; height: 100%; display: block; }
.pin-state.s-sent { background: #F1F0F7; color: var(--muted); }
.pin-state.s-seen { background: #E9E6FF; color: var(--violet-dark); }
.pin-state.s-approve-in-terminal, .pin-state.s-blocked { background: #FDECEF; color: #D93F5B; }
.pin-state.s-fixed { background: #E3F6EA; color: #1F7A45; }
.pin-state.s-resolved { background: #F1F0F7; color: var(--muted); text-decoration: line-through; }
.pr-link { font-size: 12px; color: var(--violet-dark); }
.link { border: 0; background: none; padding: 0 2px; color: var(--violet-dark); font-size: 12px; text-decoration: underline; cursor: pointer; }
.reply { margin: 0; padding: 4px 6px; border-left: 2px solid var(--violet); background: #F6F5FE; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow: auto; }
.marker.s-seen { background: var(--violet-dark); }
.marker.s-approve-in-terminal, .marker.s-blocked { background: #D93F5B; }
.marker.s-fixed { background: #1F9D55; }
.marker.s-resolved { background: #9A97B0; }
.comment { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.actions { display: flex; gap: 4px; flex: none; }
.actions button { padding: 1px 6px; font-size: 12px; }
.empty { padding: 12px 10px; color: var(--muted); }
.panel footer { display: flex; gap: 6px; align-items: center; padding: 8px 10px; border-top: 1px solid var(--line); }
.panel footer button { white-space: nowrap; }
.panel footer select { flex: 1; border: 1px solid var(--line); border-radius: 6px; padding: 3px; background: var(--paper); }
.status { padding: 0 10px 8px; color: var(--violet-dark); font-size: 12px; min-height: 0; }
.status:empty { display: none; }
.status.error { color: #D93F5B; }

.send { padding: 8px 10px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.send .row, .preview .row { display: flex; gap: 6px; align-items: center; }
.send .spacer, .preview .spacer { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.send-head { display: flex; align-items: center; gap: 6px; }
.send-title { font-weight: 700; flex: 1; }
.chip { font-size: 11px; border-radius: 999px; padding: 1px 8px; background: #F1F0F7; color: var(--muted); }
.chip.paired { background: #E9E6FF; color: var(--violet-dark); }
.chip.unreachable { background: #FDECEF; color: #D93F5B; }
.note { color: var(--muted); font-size: 12px; }
.pairing input { min-width: 0; border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; font: inherit; background: var(--paper); }
.pairing input[aria-label="Pairing code"] { flex: 1; text-transform: uppercase; letter-spacing: 0.08em; }
.pairing input[aria-label="Helper port"] { width: 72px; }
.sessions { display: flex; flex-direction: column; gap: 2px; max-height: 150px; overflow: auto; }
.session { display: grid; grid-template-columns: auto 1fr; column-gap: 6px; padding: 4px; border-radius: 6px; cursor: pointer; }
.session:hover { background: #F6F5FE; }
.session input { grid-row: span 3; margin: 2px 0 0; accent-color: var(--violet); }
.session .who { display: flex; gap: 6px; align-items: center; }
.session .name { font-weight: 600; }
.session .where { grid-column: 2; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state { font-size: 11px; border-radius: 4px; padding: 0 5px; background: #E7F6EC; color: #237A42; }
.state.busy { background: #FFF4E0; color: #9A6200; }
.tag { font-size: 11px; color: var(--violet-dark); }
.site { font-size: 12px; display: flex; gap: 4px; align-items: center; }
.site input { accent-color: var(--violet); margin: 0; }

.preview {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: min(560px, calc(100vw - 32px));
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  pointer-events: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(29, 22, 64, 0.3);
}
.preview .what { font-weight: 600; }
.preview .message {
  margin: 0;
  flex: 1;
  overflow: auto;
  padding: 8px;
  background: #F6F5FE;
  border-radius: 6px;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.composer {
  position: absolute;
  pointer-events: auto;
  width: 260px;
  padding: 8px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(29, 22, 64, 0.22);
}
.composer textarea {
  width: 100%;
  min-height: 64px;
  resize: vertical;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px;
  background: var(--paper);
}
.composer .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
.composer .row .spacer { flex: 1; }
.composer .what { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
`;
