/**
 * @jest-environment jsdom
 *
 * Cl@ve, the Spanish eIDAS gateway, carries its Single Logout messages in parameters that the
 * SAML 2.0 bindings do not define, so stock SAML-tracer sees those requests as ordinary traffic:
 * no protocol tag, no SAML tab, no summary. These tests pin the shapes taken from a real Cl@ve
 * trace (RedIRIS bridge -> pasarela -> IdP and back).
 *
 * jsdom rather than the default node environment, because showSummary() builds a DOM table.
 */

const fs = require('fs');
const path = require('path');

function loadSAMLTrace() {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'src/SAMLTrace.js'), 'utf8');
  const factory = new Function('dump', `${code}\nreturn SAMLTrace;`);
  return factory(() => {});
}

const SAMLTrace = loadSAMLTrace();

/** Encodes a string the way a Cl@ve node encodes a logout payload: plain base64, no deflate. */
function claveEncode(xml) {
  return Buffer.from(xml, 'utf8').toString('base64');
}

/**
 * Builds the object SAMLTrace.Request expects for a traced form POST. Values arrive from the
 * webRequest API as arrays, one entry per repetition of the parameter.
 */
function postRequest(url, formData) {
  const asArrays = {};
  for (const [name, value] of Object.entries(formData)) {
    asArrays[name] = Array.isArray(value) ? value : [value];
  }
  return {
    req: {
      method: 'POST',
      url: url,
      requestId: '1',
      requestBody: { formData: asArrays }
    },
    headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }]
  };
}

async function parse(request) {
  const parsed = new SAMLTrace.Request(request, () => undefined);
  await parsed.parseSAML();
  return parsed;
}

// Shapes observed in the real trace: a samlp-prefixed LogoutRequest from the bridge, and a
// saml2p-prefixed LogoutResponse carrying a Status. Both are plain SAML 2.0 under the standard
// protocol namespace — only the parameter carrying them is non-standard.
const LOGOUT_REQUEST_XML =
  '<?xml version="1.0" encoding="UTF-8"?>'
  + '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"'
  + ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"'
  + ' ID="_logout_request_id" Version="2.0" IssueInstant="2026-09-22T08:00:00Z"'
  + ' Destination="https://pasarela.example.es/Proxy2/ServiceProvider">'
  + '<saml:Issuer>https://bridge.example.es/clave2</saml:Issuer>'
  + '<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">subject-id</saml:NameID>'
  + '<samlp:SessionIndex>session-index-value</samlp:SessionIndex>'
  + '</samlp:LogoutRequest>';

const LOGOUT_RESPONSE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>'
  + '<saml2p:LogoutResponse xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol"'
  + ' xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion"'
  + ' ID="_logout_response_id" InResponseTo="_logout_request_id" Version="2.0"'
  + ' IssueInstant="2026-09-22T08:00:01Z" Consent="urn:oasis:names:tc:SAML:2.0:consent:obtained"'
  + ' Destination="https://sp.example.es/claveSP/logoutReturn.php">'
  + '<saml2:Issuer>https://pasarela.example.es/Proxy2</saml2:Issuer>'
  + '<saml2p:Status>'
  + '<saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>'
  + '<saml2p:StatusMessage>urn:oasis:names:tc:SAML:2.0:status:Success</saml2p:StatusMessage>'
  + '</saml2p:Status>'
  + '</saml2p:LogoutResponse>';

// Named here rather than read from the source, so that shrinking the constant fails a test
// instead of quietly leaving the cases below with nothing to run.
const OBSERVED_LOGOUT_PARAMETERS = [
  'samlRequestLogout',
  'logoutRequest',
  'samlResponseLogout',
  'logoutResponse'
];

describe('Cl@ve Single Logout detection', () => {
  it('recognises every logout parameter seen in the trace', () => {
    expect(SAMLTrace.CLAVE_LOGOUT_PARAMETERS).toEqual(
      expect.arrayContaining(OBSERVED_LOGOUT_PARAMETERS)
    );
  });

  // The bridge and the pasarela use different names for the same thing.
  it.each(OBSERVED_LOGOUT_PARAMETERS)('tags a POST carrying %s as SAML-P', async name => {
    const parsed = await parse(postRequest('https://pasarela.example.es/Proxy2/ServiceProvider', {
      [name]: claveEncode(LOGOUT_REQUEST_XML),
      RelayState: 'relay-state-value'
    }));

    expect(parsed.protocol).toBe('SAML-P');
  });

  it('leaves an unrelated POST untagged', async () => {
    const parsed = await parse(postRequest('https://chat.example.com/api/list_topics', {
      RelayState: 'relay-state-value',
      country: 'ES'
    }));

    expect(parsed.protocol).toBeUndefined();
  });
});

describe('Cl@ve Single Logout decoding', () => {
  it('decodes a plain base64 logoutRequest into the SAML message', async () => {
    const parsed = await parse(postRequest('https://bridge.example.es/clave2/idp/clave-logout.php', {
      logoutRequest: claveEncode(LOGOUT_REQUEST_XML)
    }));

    expect(parsed.saml).toBe(LOGOUT_REQUEST_XML);
  });

  it('decodes a logoutResponse the same way', async () => {
    const parsed = await parse(postRequest('https://sp.example.es/claveSP/logoutReturn.php', {
      logoutResponse: claveEncode(LOGOUT_RESPONSE_XML),
      RelayState: 'relay-state-value'
    }));

    expect(parsed.saml).toBe(LOGOUT_RESPONSE_XML);
  });

  it('yields one message when the pasarela repeats the payload under two names', async () => {
    // pasarela.clave.gob.es posts samlRequestLogout and logoutRequest with identical values.
    const encoded = claveEncode(LOGOUT_REQUEST_XML);
    const parsed = await parse(postRequest('https://pasarela.example.es/Proxy2/ServiceProvider', {
      samlRequestLogout: encoded,
      logoutRequest: encoded,
      country: 'ES',
      RelayState: 'relay-state-value'
    }));

    expect(parsed.saml).toBe(LOGOUT_REQUEST_XML);
  });

  it('does not invent a message from an empty logout parameter', async () => {
    // The bridge posts an empty logoutRequest alongside the real payload of a sibling request.
    // Treating '' as a message would add an empty SAML tab to the row.
    const parsed = await parse(postRequest('https://bridge.example.es/clave2/sp/bridge-logout.php/', {
      logoutRequest: '',
      RelayState: 'relay-state-value'
    }));

    expect(parsed.protocol).toBe('SAML-P');
    expect(parsed.saml).toBeNull();
    expect(new SAMLTrace.RequestItem(parsed).availableTabs).not.toContain('SAML');
  });

  it('survives a logout parameter that is not base64-encoded XML', async () => {
    const parsed = await parse(postRequest('https://bridge.example.es/clave2/sp/bridge-logout.php/', {
      logoutResponse: 'not~valid~base64'
    }));

    expect(parsed.saml).toBeNull();
  });

  it('offers the SAML and Summary tabs once a logout message is decoded', async () => {
    const parsed = await parse(postRequest('https://sp.example.es/claveSP/logoutReturn.php', {
      samlResponseLogout: claveEncode(LOGOUT_RESPONSE_XML)
    }));

    expect(new SAMLTrace.RequestItem(parsed).availableTabs).toEqual(
      expect.arrayContaining(['SAML', 'Summary'])
    );
  });
});

describe('Single Logout summary', () => {
  /** Renders showSummary() and returns its rows as a key -> value map. */
  function summarise(saml) {
    const item = new SAMLTrace.RequestItem({ saml: saml, get: [], post: [] });
    const target = document.createElement('div');
    item.showSummary(target);

    const rows = {};
    target.querySelectorAll('tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length === 2) {
        rows[cells[0].innerText] = cells[1].innerText;
      }
    });
    return { rows, headers: Array.from(target.querySelectorAll('th')).map(th => th.innerText) };
  }

  it('summarises a LogoutRequest', () => {
    const { rows, headers } = summarise(LOGOUT_REQUEST_XML);

    expect(headers).toContain('SAML 2.0 LogoutRequest');
    expect(rows['ID']).toBe('_logout_request_id');
    expect(rows['Destination']).toBe('https://pasarela.example.es/Proxy2/ServiceProvider');
    expect(rows['IssueInstant']).toBe('2026-09-22T08:00:00Z');
    expect(rows['Issuer']).toBe('https://bridge.example.es/clave2');
    expect(rows['NameID']).toBe('subject-id');
    expect(rows['SessionIndex']).toBe('session-index-value');
  });

  it('summarises a LogoutResponse, including its status', () => {
    const { rows, headers } = summarise(LOGOUT_RESPONSE_XML);

    expect(headers).toContain('SAML 2.0 LogoutResponse');
    expect(rows['ID']).toBe('_logout_response_id');
    expect(rows['InResponseTo']).toBe('_logout_request_id');
    expect(rows['Consent']).toBe('urn:oasis:names:tc:SAML:2.0:consent:obtained');
    expect(rows['Issuer']).toBe('https://pasarela.example.es/Proxy2');
    expect(rows['StatusCode']).toBe('urn:oasis:names:tc:SAML:2.0:status:Success');
    expect(rows['StatusMessage']).toBe('urn:oasis:names:tc:SAML:2.0:status:Success');
  });

  it('reports a nested sub-status, so a failure names what broke', () => {
    const failed = LOGOUT_RESPONSE_XML.replace(
      '<saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>',
      '<saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Responder">'
      + '<saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:PartialLogout"/>'
      + '</saml2p:StatusCode>'
    );

    const { rows } = summarise(failed);

    expect(rows['StatusCode']).toBe(
      'urn:oasis:names:tc:SAML:2.0:status:Responder / urn:oasis:names:tc:SAML:2.0:status:PartialLogout'
    );
  });

  it('reports the status of an ordinary SAML Response too', () => {
    const response =
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"'
      + ' ID="_response_id" Version="2.0" IssueInstant="2026-09-22T08:00:02Z">'
      + '<samlp:Status>'
      + '<samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Requester">'
      + '<samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:InvalidNameIDPolicy"/>'
      + '</samlp:StatusCode>'
      + '<samlp:StatusMessage>NameID policy not supported</samlp:StatusMessage>'
      + '</samlp:Status>'
      + '</samlp:Response>';

    const { rows } = summarise(response);

    expect(rows['StatusCode']).toBe(
      'urn:oasis:names:tc:SAML:2.0:status:Requester / urn:oasis:names:tc:SAML:2.0:status:InvalidNameIDPolicy'
    );
    expect(rows['StatusMessage']).toBe('NameID policy not supported');
  });
});
