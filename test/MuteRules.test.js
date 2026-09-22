/**
 * Mute rules are derived from a request the user points at, so the shapes that matter are the ones
 * that recur in a real trace: an endpoint polled with a changing query string, and a host that
 * polls several endpoints at once.
 */

const fs = require('fs');
const path = require('path');

function loadMuteRules() {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'src/muteRules.js'), 'utf8');
  return new Function(`${code}\nreturn MuteRules;`)();
}

const MuteRules = loadMuteRules();

const request = (method, url) => ({ method, url });

/** A storage area standing in for browser.storage.local. */
function fakeStorage(initial) {
  let data = initial ? JSON.parse(JSON.stringify(initial)) : {};
  return {
    get: async key => (key in data ? { [key]: data[key] } : {}),
    set: async entries => { data = { ...data, ...entries }; },
    read: () => data
  };
}

describe('MuteRules.describe', () => {
  it('derives an endpoint rule that ignores the query string', () => {
    const rule = MuteRules.describe(
      request('POST', 'https://play.google.com/log?format=json&hasfast=true'),
      MuteRules.ENDPOINT
    );

    expect(rule).toEqual({
      scope: MuteRules.ENDPOINT,
      method: 'POST',
      host: 'play.google.com',
      path: '/log'
    });
  });

  it('derives a host rule', () => {
    const rule = MuteRules.describe(
      request('POST', 'https://chat.google.com/u/0/api/list_topics?c=33'),
      MuteRules.HOST
    );

    expect(rule).toEqual({ scope: MuteRules.HOST, host: 'chat.google.com' });
  });

  it('returns null for a URL it cannot parse', () => {
    expect(MuteRules.describe(request('GET', 'not a url'), MuteRules.ENDPOINT)).toBeNull();
  });
});

describe('MuteRules.matches', () => {
  const rule = MuteRules.describe(
    request('POST', 'https://play.google.com/log?format=json'),
    MuteRules.ENDPOINT
  );

  it('matches the same endpoint with a different query string', () => {
    // This is the whole point: play.google.com/log repeats with a changing query.
    expect(MuteRules.matches(rule, request('POST', 'https://play.google.com/log?format=xml&n=2'))).toBe(true);
  });

  it('does not match a different path on the same host', () => {
    expect(MuteRules.matches(rule, request('POST', 'https://play.google.com/other'))).toBe(false);
  });

  it('does not match a different method', () => {
    expect(MuteRules.matches(rule, request('GET', 'https://play.google.com/log'))).toBe(false);
  });

  it('does not match a different host', () => {
    expect(MuteRules.matches(rule, request('POST', 'https://play.example.com/log'))).toBe(false);
  });

  it('matches every path and method under a host rule', () => {
    const hostRule = { scope: MuteRules.HOST, host: 'chat.google.com' };

    expect(MuteRules.matches(hostRule, request('POST', 'https://chat.google.com/u/0/api/list_topics'))).toBe(true);
    expect(MuteRules.matches(hostRule, request('GET', 'https://chat.google.com/anything/else'))).toBe(true);
    expect(MuteRules.matches(hostRule, request('GET', 'https://meet.google.com/x'))).toBe(false);
  });

  it('never matches a request whose URL cannot be parsed', () => {
    expect(MuteRules.matches(rule, request('POST', 'not a url'))).toBe(false);
  });
});

describe('MuteRules.Store', () => {
  const noisy = request('POST', 'https://play.google.com/log?format=json');

  function storeWith(...requests) {
    const store = new MuteRules.Store(null);
    requests.forEach(r => store.add(MuteRules.describe(r, MuteRules.ENDPOINT)));
    return store;
  }

  it('mutes an endpoint', () => {
    const store = storeWith(noisy);

    expect(store.isMuted(request('POST', 'https://play.google.com/log?other=1'))).toBe(true);
    expect(store.isMuted(request('POST', 'https://clave.example.es/logout'))).toBe(false);
  });

  it('ignores a second attempt to mute the same endpoint', () => {
    const store = storeWith(noisy);

    expect(store.add(MuteRules.describe(noisy, MuteRules.ENDPOINT))).toBe(false);
    expect(store.rules).toHaveLength(1);
  });

  it('unmutes by key', () => {
    const store = storeWith(noisy);
    const key = MuteRules.key(store.rules[0]);

    expect(store.remove(key)).toBe(true);
    expect(store.isMuted(noisy)).toBe(false);
    expect(store.remove(key)).toBe(false);
  });

  it('broadens an endpoint rule to its host, absorbing the rules it now covers', () => {
    const store = storeWith(
      request('POST', 'https://chat.google.com/u/0/api/list_topics'),
      request('POST', 'https://chat.google.com/u/0/api/get_smart_replies'),
      request('POST', 'https://play.google.com/log')
    );
    const key = MuteRules.key(store.rules[0]);

    expect(store.broaden(key)).toBe(true);
    expect(store.rules).toHaveLength(2);
    expect(store.isMuted(request('GET', 'https://chat.google.com/anything'))).toBe(true);
    // The unrelated rule survives.
    expect(store.isMuted(request('POST', 'https://play.google.com/log'))).toBe(true);
  });

  it('does not broaden a rule that is already host-wide', () => {
    const store = new MuteRules.Store(null);
    store.add({ scope: MuteRules.HOST, host: 'chat.google.com' });

    expect(store.broaden(MuteRules.key(store.rules[0]))).toBe(false);
  });

  it('clears every rule', () => {
    const store = storeWith(noisy);

    expect(store.clear()).toBe(true);
    expect(store.rules).toHaveLength(0);
    expect(store.clear()).toBe(false);
  });

  it('round-trips through storage', async () => {
    const storage = fakeStorage();
    const store = new MuteRules.Store(storage);
    store.add(MuteRules.describe(noisy, MuteRules.ENDPOINT));
    await store.save();

    const reopened = new MuteRules.Store(storage);
    await reopened.load();

    expect(reopened.rules).toEqual(store.rules);
    expect(reopened.isMuted(noisy)).toBe(true);
  });

  it('starts empty when storage holds nothing', async () => {
    const store = new MuteRules.Store(fakeStorage());
    await store.load();

    expect(store.rules).toEqual([]);
  });

  it('starts empty rather than throwing when storage holds something unusable', async () => {
    const store = new MuteRules.Store(fakeStorage({ [MuteRules.STORAGE_KEY]: 'not an array' }));
    await store.load();

    expect(store.rules).toEqual([]);
  });

  it('works without any storage at all', async () => {
    // The dialog and the list must still function where the extension APIs are absent.
    const store = new MuteRules.Store(null);
    store.add(MuteRules.describe(noisy, MuteRules.ENDPOINT));

    await expect(store.save()).resolves.toBeUndefined();
    expect(store.isMuted(noisy)).toBe(true);
  });
});

describe('MuteRules.label', () => {
  it('reads as an endpoint', () => {
    const rule = MuteRules.describe(request('POST', 'https://play.google.com/log?x=1'), MuteRules.ENDPOINT);

    expect(MuteRules.label(rule)).toBe('POST play.google.com/log');
  });

  it('reads as a host', () => {
    expect(MuteRules.label({ scope: MuteRules.HOST, host: 'chat.google.com' }))
      .toBe('everything from chat.google.com');
  });
});
