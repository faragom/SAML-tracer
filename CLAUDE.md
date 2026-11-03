# SAML-tracer (Cl@ve)

A fork of [SimpleSAMLphp/SAML-tracer](https://github.com/SimpleSAMLphp/SAML-tracer) whose purpose is
to make **Cl@ve**, the Spanish eIDAS identity gateway, legible in the tracer — plus muting the
background polling that drowns a real trace.

The fork is a strict superset of upstream. Nothing upstream does was removed.

Licence: **BSD-2-Clause** (upstream's; this fork keeps it).

## Conventions

- **English everywhere** — code, comments, docs, commit messages, PR bodies. This overrides any
  default to another language.
- **Every change goes on a branch and through a pull request**, even a one-line one. Large changes:
  agree a plan first, then land it as a series of PRs.
- **Never stack branches.** Branch from `main`. If a branch genuinely needs another's work, land
  that one first rather than basing on it.
- **A test that cannot fail is worse than none.** After writing a test, break the code it covers and
  confirm the test actually goes red. Do not take a green suite on trust, and do not let a test draw
  its own cases from the production constant it is meant to be checking.

## Layout

| path | what |
| --- | --- |
| `manifest.json` | MV3 manifest, **at the repository root** — the add-on's source dir is the repo itself |
| `src/SAMLTrace.js` | everything: request parsing, protocol detection, the row list, tabs, summaries |
| `src/SAMLTraceIO.js` | import/export; `filters.js` holds the export scrubbing profiles |
| `src/muteRules.js` | mute rule model, matching and persistence |
| `src/muteDialog.{html,js}` | the "Muted (n)" dialog |
| `src/ui.js` | page bootstrap, button bindings, row visibility |
| `tools/copy-assets.mjs` | copies highlight.js into `lib/` — see below |
| `web-ext-config.cjs` | decides what goes into the `.xpi` |
| `sign.ps1` | AMO unlisted signing |

Scripts: `npm test` (jest), `npm run lint` (web-ext), `npm run assets`, `npm run test:e2e`
(playwright, needs a display).

## What this fork changed

**Cl@ve Single Logout detection.** `SAMLTrace.CLAVE_LOGOUT_PARAMETERS` lists the four parameter
names; `parseProtocol()` tags them `SAML-P` and `parseSAML()` decodes them. The existing
`availableTabs` logic then adds the SAML and Summary tabs on its own.

**Logout summaries.** `showSummary()` handles `LogoutRequest` and `LogoutResponse`, and reports the
`Status` of an ordinary `Response` too (upstream omits it, which hurts on every failed login).
Nested `StatusCode`s are joined outermost first.

**Mute rules.** A per-row hover button derives a rule from that request; a header button opens a
dialog to manage them. Rules live in `browser.storage.local` (hence the `storage` permission).

**Two upstream bugs fixed.** An import never set `entry.parsed` on the list entry, so the hidden
count stayed at zero, the protocol filter never bit, and **exporting a just-imported trace produced
nothing at all**. And the export dialog was handed `tracer.showProtocolRequestsOnly`, a property the
tracer has never had — it is `showProtocolOnly`.

## Verified facts about Cl@ve

Taken from a real unfiltered trace, not from documentation.

- Cl@ve does **not** use `SAMLRequest`/`SAMLResponse` for Single Logout. The RedIRIS bridge posts
  `logoutRequest` / `logoutResponse`; the pasarela posts `samlRequestLogout` / `samlResponseLogout`
  **and repeats the same payload** under `logoutRequest` / `logoutResponse`.
- The payloads are **plain base64, no deflate** — ordinary SAML 2.0 `LogoutRequest` /
  `LogoutResponse` under `urn:oasis:names:tc:SAML:2.0:protocol`. Only the parameter name is
  non-standard.
- Namespace prefixes **alternate `samlp` and `saml2p` within a single flow**, so never match on a
  prefix.
- One entry carries an **empty** `logoutRequest` beside the real `logoutResponse`. Treating `''` as
  a message opens an empty SAML tab.

## The export dialog leaks

Its default *hash* profile replaces every POST value with a hash **but leaves the already-decoded
`req.saml` untouched**, so an export made with it still contains the full assertion — including
identity attributes — in clear text. It also destroys the payload of any non-standard parameter,
which makes it useless as test material for Cl@ve work.

Consequences:

- Ask for a **"No filtering"** export when the raw message is needed.
- **Never commit a trace export**, and never paste one into an issue or PR. They are personal data.
- Build test fixtures by hand from the observed *shape*, rather than scrubbing a real capture.

## Build, test and sign

```
npm ci
npm run assets      # REQUIRED — see below
npm test
npm run lint
```

**`lib/` is empty in the repository on purpose.** highlight.js' four published files are copied in
at build time so that what ships is byte-identical to its own distribution and a reviewer can verify
it with `npm ci` and `diff`. Upstream only does that copy inside
`.github/workflows/build-release.yml`, so anything built, signed, or loaded as a temporary add-on
from a working copy silently loses syntax highlighting — `src/hljs-init.js` resolves its four
imports to nothing and `window.hljs` is never set. `npm run assets` does the copy; `sign.ps1` runs
it automatically.

**Signing** is `.\sign.ps1`, which signs through AMO's *unlisted* self-distribution channel. It
reads `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` from the environment, never as arguments.
**The maintainer runs this; an assistant never handles the AMO key.**

**Version 1.9.5 has already been signed and uploaded.** AMO refuses a version it has seen, so bump
`version` in `manifest.json` before the next signing run. `test/version.test.js` then fails until
`package.json` and both fields in `package-lock.json` match it.

A correct package is ~68 entries / ~87 KB: `lib`, `src`, `bootstrap.js`, `manifest.json`, `LICENSE`
and nothing else. If tests or `node_modules` appear in it, `web-ext-config.cjs` is wrong.

## Traps

- **Source files are CRLF.** An in-place regex edit whose pattern uses `\n` matches nothing and
  still exits 0. Use `\r\n`, or an editing tool, and **always verify the edit actually landed**.
- **jsdom's `querySelector` does not match namespaced XML** — `querySelector('Issuer')` misses
  `<saml2:Issuer>`. Real browsers do match (confirmed in a browser, not assumed), so upstream's
  `showSummary` is correct. Do not "fix" working upstream code to satisfy the test environment; use
  `getElementsByTagNameNS('*', localName)` in new code instead.
- **jsdom has no `crypto.subtle` or `TextEncoder`.** Inject `node:crypto`'s `webcrypto` and
  `node:util`'s `TextEncoder` before loading `hash.js` — see `test/TraceWindowImport.test.js`.
- **`ui.js` registers a `load` handler that bootstraps the whole window.** In a jsdom test, drop it
  with a `window` proxy rather than trying to satisfy it.
- **GitHub Actions is disabled on this fork**, as it is on all forks by default. No CI runs on any
  PR; "green" means the local suite. Enabling it is a repository setting — ask first.

## Seeing the UI without installing the add-on

Serve the repo over plain HTTP with a small static server and open a harness page that stubs
`chrome` / `browser` (the `webRequest` listeners plus `storage.local`) and replays a trace through
`saveNewRequest` → `addRequestItem` → `attachResponseToRequest`. A `file://` URL will not do.

This is how the `entry.parsed` bug was found, and it is worth repeating for any UI change. The fake
response must **omit `method`**, matching what `SAMLTraceIO` builds on import, or the request and
response ids will not match and `isVisible` is never attached.

Playwright's Chromium cannot always be launched from an assistant's sandbox, so the e2e suite and
any screenshot of the real add-on may need to be run by the maintainer.
