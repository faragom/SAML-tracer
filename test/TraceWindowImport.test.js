/**
 * @jest-environment jsdom
 *
 * Drives a TraceWindow through the real import path, which is how a trace taken elsewhere — or one
 * saved to reproduce a Cl@ve problem — actually reaches the list. Live tracing hands
 * addRequestItem() the list entry itself; an import hands it the pseudo-request that entry merely
 * wraps, and the two paths have to end up in the same state for anything downstream of
 * isVisible() to work: the hidden count, the protocol filter, mute rules and the export.
 */

const fs = require('fs');
const path = require('path');
const { webcrypto } = require('node:crypto');

// hash.js reaches for crypto.subtle and TextEncoder, neither of which jsdom provides.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('node:util').TextEncoder;
}

/**
 * ui.js registers a load handler that bootstraps the whole window — splitter, key bindings, the
 * webRequest listeners. This test is about what happens after a trace is imported, not about
 * starting the page, so the handler is dropped while everything else about the module is kept.
 */
const windowWithoutLoadHandler = new Proxy(window, {
  get(target, property) {
    if (property === 'addEventListener') {
      return (type, listener, options) => {
        if (type !== 'load') {
          target.addEventListener(type, listener, options);
        }
      };
    }
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  },
  set(target, property, value) {
    target[property] = value;
    return true;
  }
});

/** Evaluates one of the extension's scripts and publishes its namespace globally, as the page does. */
function loadScript(file, symbol) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'src', file), 'utf8');
  globalThis[symbol] = new Function('dump', 'window', `${code}\nreturn ${symbol};`)(() => {}, windowWithoutLoadHandler);
  return globalThis[symbol];
}

const HEADER_BUTTONS = ['button-hide-resources', 'button-show-protocol-only', 'button-muted'];

function buildDocument() {
  document.body.innerHTML = HEADER_BUTTONS.map(id => `<div id="${id}" class="button"></div>`).join('')
    + '<div id="request-list"></div>'
    + '<div id="request-info-content"></div>'
    + '<div id="statuspanel"></div>';
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64');

const AUTHN_REQUEST = '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"'
  + ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_req1" Version="2.0">'
  + '<saml:Issuer>https://sp.example.org/sso</saml:Issuer></samlp:AuthnRequest>';

/** Two noisy pollers and the request actually being debugged, as SAMLTraceIO writes them. */
const EXPORTED = [
  { method: 'POST', url: 'https://play.google.com/log?format=json', requestId: '1' },
  { method: 'POST', url: 'https://play.google.com/log?format=json&n=2', requestId: '2' },
  {
    method: 'POST',
    url: 'https://idp.example.org/sso/post',
    requestId: '3',
    post: [['SAMLRequest', b64(AUTHN_REQUEST)]]
  }
].map(entry => ({
  requestHeaders: [],
  responseStatus: 200,
  responseStatusText: 'HTTP/1.1 200 OK',
  responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
  post: [],
  ...entry
}));

/** Lets the id hashing inside saveNewRequest/attachResponseToRequest settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

describe('importing a trace', () => {
  let SAMLTrace;
  let MuteRules;
  let tracer;

  beforeEach(async () => {
    buildDocument();

    loadScript('hash.js', 'Hash');
    MuteRules = loadScript('muteRules.js', 'MuteRules');
    SAMLTrace = loadScript('SAMLTrace.js', 'SAMLTrace');
    loadScript('ui.js', 'ui');
    loadScript('SAMLTraceIO.js', 'SAMLTraceIO');

    tracer = new SAMLTrace.TraceWindow();
    await new SAMLTraceIO().restoreFromImport(EXPORTED, tracer, () => {});
    await settle();
  });

  it('restores every entry', () => {
    expect(tracer.httpRequests).toHaveLength(EXPORTED.length);
    expect(document.querySelectorAll('#request-list .list-row')).toHaveLength(EXPORTED.length);
  });

  it('gives every list entry its parsed request', () => {
    // Without this the entry has nothing to judge: the hidden count stays at zero, the protocol
    // filter never bites, and the export dialog drops every row on .filter(Boolean).
    expect(tracer.httpRequests.filter(entry => entry.parsed)).toHaveLength(EXPORTED.length);
  });

  it('carries the SAML message through the import', () => {
    const sso = tracer.httpRequests.find(entry => entry.parsed.url.includes('idp.example.org'));

    expect(sso.parsed.protocol).toBe('SAML-P');
    expect(sso.parsed.saml).toContain('AuthnRequest');
  });

  it('counts muted entries as hidden', () => {
    tracer.muteRequestsLike(
      tracer.httpRequests.find(entry => entry.parsed.url.includes('play.google.com')).parsed
    );

    const hidden = tracer.httpRequests
      .filter(entry => !entry.isVisible(tracer.hideResources, tracer.showProtocolOnly, tracer.muteRules));

    expect(hidden).toHaveLength(2);
    expect(document.getElementById('statuspanel').innerText).toBe('3 requests received  (2 hidden)');
  });

  it('hides muted rows and leaves the rest alone', () => {
    tracer.muteRequestsLike(
      tracer.httpRequests.find(entry => entry.parsed.url.includes('play.google.com')).parsed
    );

    const rows = Array.from(document.querySelectorAll('#request-list .list-row'));
    const muted = rows.filter(row => row.classList.contains('muted'));

    expect(muted).toHaveLength(2);
    expect(rows.find(row => row.innerHTML.includes('idp.example.org')).classList.contains('muted')).toBe(false);
  });

  it('shows the rule count on the header button', () => {
    tracer.muteRequestsLike(
      tracer.httpRequests.find(entry => entry.parsed.url.includes('play.google.com')).parsed
    );

    expect(document.getElementById('button-muted').innerText).toBe('Muted (1)');
    expect(document.getElementById('button-muted').classList.contains('active')).toBe(true);
  });

  it('brings the rows back when the rule is removed', () => {
    const noisy = tracer.httpRequests.find(entry => entry.parsed.url.includes('play.google.com')).parsed;
    tracer.muteRequestsLike(noisy);
    tracer.muteRules.remove(MuteRules.key(tracer.muteRules.rules[0]));
    tracer.applyMuteRules();

    expect(document.querySelectorAll('#request-list .list-row.muted')).toHaveLength(0);
    expect(document.getElementById('button-muted').innerText).toBe('Muted');
  });
});
