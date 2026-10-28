# Chrome Web Store listing

The text for the Squashflow listing in the Chrome Web Store Developer Dashboard, kept with the code so it changes in the same pull request as what it describes. The package to upload is the zip from `pnpm --filter @squashflow/extension package` (see the [README](../../../README.md#build-the-store-package)). Submitting it is a separate, manual step.

## Store listing tab

**Name:** Squashflow (from the manifest)

**Category:** Developer Tools

**Language:** English

**Short description** (the manifest's `description`, at most 132 characters):

> Pin comments on any page and send them, with page context, to your Claude Code session.

**Detailed description:**

> Squashflow turns "this button should be blue" into a pull request without leaving the page.
>
> Turn on pin mode with the toolbar button or Alt+Shift+P, then click an element, drag an area, Shift+click several elements, or select text, and write what should change. Squashflow captures what Claude needs to find the code: a selector, the element's text, key attributes, computed styles, the surrounding structure and a screenshot of the region.
>
> Send the pin to the Claude Code session you already have open in your terminal. A small local helper (`npx squashflow`) delivers it there; you see the exact message before anything is sent. Your session fixes the code, pushes a branch and opens a pull request with your own GitHub login, and its reply and the pull request link appear on the pin.
>
> No session open, or reviewing a site you do not own? Copy pins as text at the detail level you need (compact, standard, detailed or forensic, which includes the screenshot) and paste them into any session or tool.
>
> Squashflow has no server and no telemetry. Pins stay in your browser until you send them to your own session on your own machine.
>
> Requires Claude Code 2.1.224 or later on macOS or Linux, and Node.js 22.12 or later for the helper.

**Screenshots** (1280×800, in [`screenshots/`](screenshots), taken of the real extension by [`screenshots.spec.ts`](screenshots.spec.ts) with `pnpm --filter @squashflow/extension store:screenshots`):

1. `1-pin-an-area.png`: Pin an area and say what should change.
2. `2-preview-then-send.png`: See exactly what your Claude Code session will receive.
3. `3-fixed-with-pull-request.png`: Claude's reply and the pull request land on the pin.

**Icon:** `assets/icon128.png` (Squish in the middle 96×96 of a 128×128 canvas).

**Homepage URL:** https://github.com/Uchiha-Itachi0/squashflow

**Support URL:** https://github.com/Uchiha-Itachi0/squashflow/issues

## Privacy practices tab

**Single purpose:**

> Squashflow lets a developer pin comments on web pages and send them, with the page context needed to find the code, to their own Claude Code session running on their own computer, or copy them to the clipboard.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `activeTab` | Pin mode runs only on the tab where the user clicks the toolbar button or presses the shortcut, and only after they do. The same grant lets the extension take a screenshot of that tab's visible area, which it crops to the pinned region. There are no host permissions. |
| `scripting` | Injects the pin mode script into that tab when the user turns pin mode on. Nothing is injected into any page the user has not acted on. |
| `storage` | Keeps the user's pins (comments, captured page context and region screenshots), each sent pin's status and Claude's replies, and the sites whose repository the user asked it to remember, in the extension's local storage. |
| `unlimitedStorage` | Region screenshots are kept with their pins, up to 200 KB each and 50 pins per page. Without it, local storage stops at 10 MB and saving a pin would start to fail after a few dozen screenshots. Nothing is stored anywhere but the user's own browser. |

**Remote code:** No. Every script the extension runs ships inside the package.

**Data usage:** Squashflow handles *website content* (the pinned element's selector, text, attributes, styles and structure, and a screenshot of the region) and the *comments* the user writes. It does not collect them: they stay in the browser's local storage, and leave it only when the user sends a pin, to the Squashflow helper on `127.0.0.1` on the same computer, which hands it to the user's own Claude Code session. The developer never receives any of it. Nothing is sold, transferred to third parties, used for advertising or creditworthiness, or used for anything other than the single purpose.

Tick: *I do not sell or transfer user data to third parties, outside of the approved use cases*; *I do not use or transfer user data for purposes that are unrelated to my item's single purpose*; *I do not use or transfer user data to determine creditworthiness or for lending purposes*.

**Privacy policy URL:** https://github.com/Uchiha-Itachi0/squashflow/blob/main/packages/extension/store/privacy.md
