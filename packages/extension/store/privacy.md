# Squashflow privacy statement

Squashflow is a Chrome extension and a small local helper program. It has **no server and no telemetry**: its developers never receive any data from it, and it sends nothing to them or to anyone else.

## What the extension handles

When you turn pin mode on in a tab and place a pin, the extension captures, from that tab only:

- your comment;
- page context for the pinned element: a selector, its text, some attributes, computed styles and the surrounding structure, positions and the viewport size;
- a screenshot of the pinned region of the visible tab, unless you untick **Attach a screenshot**. A screenshot shows what is on screen, including anything visible in that region.

It never captures the value of any form field (typed or default, including password and hidden fields) as text, and it captures nothing from tabs where you have not turned pin mode on.

## Where it is kept

Pins, their screenshots, each sent pin's status and Claude's replies, and the sites whose repository you asked it to remember are kept in the extension's local storage in your browser. Web pages cannot read it. Deleting a pin deletes its screenshot; removing the extension deletes all of it.

The pairing token for the local helper is kept in the extension's own database in your browser.

## Where it goes

Only where you send it:

- **Send** delivers the pin, after showing you the exact message, to the Squashflow helper on `127.0.0.1` on your own computer. The helper writes the screenshot to a file only your user account can read (`~/.squashflow/screenshots/`, removed after 7 days) and hands the message to your own Claude Code session. From there it is handled like a prompt you type into that session, under your own Claude Code account and settings.
- **Copy** puts the pin on your clipboard for you to paste wherever you choose.

The only thing that leaves your computer because of Squashflow is what your own Claude Code session sends to Anthropic as part of your session, and what it pushes to GitHub with your own login.

## Contact

Questions and issues: https://github.com/Uchiha-Itachi0/squashflow/issues. Security reports: see [SECURITY.md](../../../SECURITY.md).
