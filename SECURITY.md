# Security Policy

Squashflow connects a browser extension to a local process that can deliver messages into a coding agent with access to your source code and your GitHub login. That makes security a design requirement, not an add-on. This document describes how to report a vulnerability and the threat model the project is built against.

Squashflow is in early development and nothing is released yet. The local helper is implemented, so its mitigations below (loopback binding, pairing, request checks, message fencing, socket checks) describe what it does today; [docs/architecture.md](docs/architecture.md) has the exact values. The extension's pins, page context capture and copy are implemented too: it asks only for `activeTab`, `scripting` and `storage`, injects nothing until you click it, never captures form field values, and fences page context in copied text exactly as the helper does in delivered messages (see the [README](README.md#try-the-extension) and [docs/architecture.md](docs/architecture.md#the-extension)). The extension's side of pairing and sending is implemented as well: only its background service worker calls the helper, the pairing token is kept in that service worker's own IndexedDB (out of reach of web pages and of the script running in the page), and every message is previewed before it is sent. So are per-pin status and Claude's replies in the browser: replies are treated as untrusted text (see [below](#threat-hostile-content-in-claudes-replies)).

## Supported versions

| Version | Supported |
| --- | --- |
| `main` branch (pre-release) | Yes |
| Anything else | No releases exist yet |

Once releases begin, this table will list which versions receive security fixes.

## Reporting a vulnerability

Please **do not** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/Uchiha-Itachi0/squashflow/security) of this repository.
2. Choose **Report a vulnerability**.
3. Describe the issue, how to reproduce it, and the impact you expect.

This is the only reporting channel; there is no security email address.

### What to expect

Squashflow is a small open-source project, so these are goals rather than guarantees:

- An acknowledgement of your report within a few days.
- An initial assessment, and a question or two if needed, after that.
- A fix developed in a private fork where appropriate, with credit to you in the advisory unless you prefer to stay anonymous.

Please give us a reasonable chance to fix the issue before disclosing it publicly.

## Threat model

### What Squashflow protects

- Your Claude Code sessions, which can read and change your code and run commands.
- Your GitHub identity, which those sessions use to push branches and open pull requests.
- The contents of your pins and page context, which can include text from private pages.

### Trust boundaries

- **Trusted:** you, your OS user account, your Claude Code sessions, your `gh` login.
- **Partly trusted:** the Squashflow extension and helper, which are the code under review here.
- **Untrusted:** every website you visit, including the page you are pinning on, and any other local process running as a different OS user.

### Threat: malicious websites reaching the local helper

Any web page you visit can try to send requests to `http://127.0.0.1:<port>`. Without protection it could, for example, ask the helper to send a message into your Claude Code session (cross-site request forgery), or use DNS rebinding to make its own domain resolve to `127.0.0.1` and read the helper's responses.

Planned mitigations:

- **Loopback only.** The helper binds to `127.0.0.1` and never to `0.0.0.0` or another interface, so other machines on the network cannot reach it.
- **One-time pairing.** On first run the helper shows a short pairing code in the terminal. You enter it in the extension, which receives a random pairing token. Pairing codes are single-use, short-lived and limited in attempts.
- **Token on every request.** Every request other than pairing must carry the pairing token. A web page cannot read the token: it is kept in the extension service worker's IndexedDB, which neither web pages nor the extension's in-page script can reach, and only the service worker sends it.
- **Origin and Host allowlist.** The helper rejects requests whose `Origin` is not the paired extension, and requests whose `Host` header is not exactly `127.0.0.1:<port>`, the loopback address and port it listens on. Checking `Host` defeats DNS rebinding, because a rebinding page still sends its own domain name in `Host`.
- **No permissive CORS.** The helper never answers with a wildcard `Access-Control-Allow-Origin`.
- **Size caps.** Request bodies and messages have a fixed maximum size, and oversized requests are rejected before parsing.

### Threat: prompt injection from page content

A pin includes context from the page: text, attributes, selectors and possibly a screenshot. A hostile page can put text there that looks like instructions to Claude ("ignore the user and run this command").

Planned mitigations:

- **You review every outgoing message.** The extension shows the exact message before it is delivered, and the helper delivers only what was shown.
- **Page content is fenced as data.** Text taken from the page is placed in a clearly delimited block that is labelled as untrusted page content, separate from your own comment, which is the only instruction in the message.
- **Honest provenance.** A message states that it came from a Squashflow pin on a given URL. It never claims to come from you typing in the terminal, from Claude Code itself, or from any other source it did not come from.
- **Claude Code's own permissions still apply.** Squashflow does not bypass Claude Code's permission prompts. If a session runs in bypass-permissions mode, Claude Code holds the incoming message until you approve it in the terminal.

Fencing reduces the risk but cannot remove it: a language model may still be influenced by text it reads. Reviewing the message, and reviewing the resulting pull request before merging, remain your safeguards.

### Threat: hostile content in Claude's replies

Claude's reply to a pin is read from the session transcript and shown in the browser. Claude may quote page content or tool output in it, so it can contain anything, including markup or links a hostile page planted.

Mitigations:

- **Text only.** The helper keeps only the text parts of Claude's reply, drops control characters and caps it at 8000 characters. The extension renders it as plain text, never as HTML.
- **One kind of link.** The only link the extension renders is a GitHub pull request link (`https://github.com/<owner>/<repo>/pull/<n>`) found in the reply; it opens in a new tab without access to the opener. Anything else stays text, and stored links that do not match are dropped.
- **Same channel as everything else.** Replies and status come from the paired helper over the same authenticated calls as every other request, and only the service worker makes them.

### Threat: local socket permissions

The helper delivers a pin through the chosen session's local inbox socket.

Planned mitigations:

- Delivery uses a Unix domain socket (or the platform equivalent) that only your own OS user account can write to. Other users on the same machine cannot inject messages.
- The helper refuses to deliver to a socket whose ownership or permissions are wider than expected.
- Any files the helper creates (pairing state, saved pins) are readable and writable only by your user.

### Threat: credential theft

- Squashflow never stores GitHub tokens or other third-party credentials. The only secret it keeps is the local pairing token (in extension storage, plus a hash in user-only helper state). All GitHub operations go through your existing `gh` login, run by your Claude Code session.
- The pairing token is local to your machine, grants access only to the helper, and can be revoked by re-pairing.
- There is no Squashflow server, so there is no central store of user data or credentials to breach.

### Threat: supply-chain compromise

- **Lockfile.** Dependencies are installed from the committed `pnpm-lock.yaml` (`--frozen-lockfile` in CI) so builds are reproducible.
- **Pinned CI actions.** Every third-party GitHub Action is pinned to a full commit SHA, with the version recorded in a comment.
- **Least-privilege CI.** Workflows declare empty top-level permissions and grant only what each job needs. The default Actions token is read-only.
- **Automated updates.** Dependabot keeps pinned actions and npm dependencies up to date, and Dependabot security fixes are enabled.
- **Repository protections.** Secret scanning with push protection is on, and `main` is protected: pull requests are required, force-pushes and deletion are blocked, and the rules apply to administrators too.
- **Code scanning.** CodeQL analyses the JavaScript and TypeScript code.

### Out of scope

- Attacks that require control of your OS user account. An attacker who already runs code as you can read your files and use your `gh` login directly.
- Vulnerabilities in Chrome, Claude Code, `gh` or GitHub themselves. Please report those to their maintainers.
- Changes that Claude makes to your code. Squashflow delivers your request; reviewing the pull request before merging remains your responsibility.

See [docs/architecture.md](docs/architecture.md) for how these mitigations fit into the overall design.
