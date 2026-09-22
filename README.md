SAML-tracer (Cl@ve)
===================

A fork of [SimpleSAMLphp/SAML-tracer](https://github.com/SimpleSAMLphp/SAML-tracer)
whose purpose is to make **Cl@ve**, the Spanish eIDAS identity gateway, legible
in the tracer.

Cl@ve departs from the SAML 2.0 bindings in ways that leave stock SAML-tracer
showing nothing useful for a large part of a real flow. The changes here address
those departures, plus the practical problem of finding the flow at all in a
trace full of background polling.

Everything upstream still works exactly as it did. The fork is a superset: if
you are not debugging Cl@ve, the only thing you will notice is the mute button.


What this fork adds
-------------------

### Cl@ve Single Logout is recognised

Cl@ve does not use the `SAMLRequest`/`SAMLResponse` parameter names the SAML 2.0
bindings define for Single Logout. Each node has its own:

| node | parameters |
| --- | --- |
| RedIRIS bridge | `logoutRequest`, `logoutResponse` |
| Cl@ve pasarela | `samlRequestLogout` **and** `logoutRequest`, carrying the same payload twice |
| the SP's return leg | `samlResponseLogout` **and** `logoutResponse` |

Upstream looks only for the standard names, so the whole logout leg is treated
as ordinary traffic: no SAML logo, hidden by *Show protocol requests only*, and
no SAML or Summary tab to open. The payloads themselves turn out to be perfectly
ordinary base64-encoded SAML 2.0 messages under the standard protocol namespace
— plain base64, no deflate — so only the place to look for them differs.

These requests are now tagged as SAML like any other, and their messages are
decoded into the usual tabs. An empty logout parameter is not mistaken for a
message: the bridge sends one alongside the real payload.

### Logout messages are summarised

The Summary tab understands `LogoutRequest` (ID, IssueInstant, Destination,
Issuer, NameID, SessionIndex, Reason, NotOnOrAfter) and `LogoutResponse` (adding
InResponseTo, Consent, StatusCode and StatusMessage).

It also reports the **Status of an ordinary `Response`**, which upstream omits
and which is what you actually need when a login fails. Nested status codes are
shown outermost first, so a failure reads as
`…:Responder / …:AuthnFailed` rather than hiding its sub-status.

### Recurring entries can be muted

A trace taken with a mail client or a chat tab open is mostly polling — in one
real Cl@ve capture, 100 of 173 entries were Google Chat, Meet and
`play.google.com` beacons. *Hide resources* does not touch them, since they are
genuine XHR traffic, and *Show protocol requests only* removes the surrounding
context that makes a trace readable.

Hovering a row now reveals a mute button, which derives a rule from that very
request: same method, host and path, **ignoring the query string**, since that
is what varies while a page polls. A *Muted (n)* button in the header lists the
rules, shows how many entries each one accounts for, and offers to widen a rule
to its whole host or to remove it. Rules are kept in `browser.storage.local` and
survive a restart.

Muted entries count towards the status bar's hidden total and are left out of
exports.

### Fixes carried along

* An imported trace never gave its list entries their parsed request, so the
  hidden count stayed at zero, *Show protocol requests only* never bit, and
  **exporting a trace you had just imported produced nothing at all**.
* The export dialog was handed `showProtocolRequestsOnly`, a property the tracer
  has never had, so it silently ignored the button it was meant to honour.

These are upstream bugs, not Cl@ve-specific ones.


Installing this fork
--------------------

This fork carries its own add-on id (`saml-tracer-fork@faragom`) and is named
*SAML-tracer (Cl@ve)*, so it installs alongside the published SAML-tracer rather
than replacing it. You can run both and compare.

It is not distributed through the extension stores.

### As a temporary add-on

    npm ci
    npm run assets

Then open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on…** and select `manifest.json`. It is gone again on the next restart.

`npm run assets` is not optional. `lib/` is deliberately empty in the
repository — highlight.js' published files are copied in at build time so that
what ships is byte-identical to its own distribution and a reviewer can check it
with `npm ci` and `diff`. Skip the step and `src/hljs-init.js` resolves its
imports to nothing, leaving the tracer working but with no syntax highlighting.

### Signed, so it survives a restart

    $env:WEB_EXT_API_KEY = 'user:12345678:123'
    $env:WEB_EXT_API_SECRET = '...'
    .\sign.ps1

`sign.ps1` copies the assets, runs the tests and the linter, then signs through
AMO's **unlisted** self-distribution channel: AMO signs the file and hands it
back rather than publishing it, with no review queue. The credentials come from
[AMO's API key page](https://addons.mozilla.org/en-US/developers/addon/api/key/)
and are read from the environment only, never passed as arguments, so they stay
out of the PowerShell history and the process list.

The signed `.xpi` lands in `dist\`. Install it through `about:addons` → the gear
icon → *Install Add-on From File…*.

AMO refuses a version it has already seen, so bump `version` in `manifest.json`
before signing again. What goes into the package is decided by
`web-ext-config.cjs`.


Using SAML-tracer
-----------------

SAML-tracer is activated by clicking its icon in the browser toolbar.
It can be alternatively started by pressing <kbd>ALT</kbd> +
<kbd>SHIFT</kbd> + <kbd>S</kbd> on the keyboard.

Once it is activated, you will get a window that shows all requests,
and the data included in them. It also shows response headers.
Messages including SAML data are highlighted with a SAML logo at the
right side of the request list. Those containing WS-Federation data
are highlighted with a WS-Fed logo respectively.

Selecting a request gives you up to four tabs:

* HTTP: A quick overview over the request, with request and response
  headers.
* Parameters: GET and POST parameters included in the request.
* SAML: Decoded SAML message found in the request.
* Summary: The message's key fields, read out of the decoded XML.


A note on exports
-----------------

The export dialog's default *hash* profile replaces every POST value with its
hash, but leaves the **decoded** SAML message beside it untouched. An export
made with that profile therefore still contains the assertion in clear text,
including whatever identity attributes it carries. Treat an export as sensitive
whichever profile you chose.


Developing SAML-tracer
----------------------

Clone this repository, then:

    npm ci
    npm run assets      # copy highlight.js into lib/ -- see above
    npm test            # unit tests (jest)
    npm run lint        # web-ext lint
    npm run test:e2e    # end-to-end tests (playwright, needs a display)

To try your changes, load the extension as a temporary add-on, as described for
Firefox here:

  https://developer.mozilla.org/Add-ons/WebExtensions/Debugging

Upstream lives at https://github.com/SimpleSAMLphp/SAML-tracer/ and is tracked
here as the `upstream` remote.


Browser support
---------------

This extension is available for Firefox (see Mozilla extension) and for Chrome & Edge (see Chrome extension).

License
-------

SAML-tracer is released under the 2-clause BSD license. See the
[LICENSE](LICENSE)-file for more information. This fork is released under the
same terms.


Attribution
-----------

SAML-tracer makes use of open source libraries.
See [here](attribution.md) for more details.
