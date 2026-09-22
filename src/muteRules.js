/**
 * Mute rules hide recurring traffic that has nothing to do with the flow being debugged.
 *
 * A single SSO trace taken with a mail client and a chat tab open is mostly polling: in one real
 * capture, 100 of 173 entries were Google Chat, Meet and play.google.com beacons repeating the same
 * handful of endpoints. "Hide resources" does not touch them, because they are genuine XHR traffic,
 * and "Show protocol requests only" hides the surrounding context that makes a trace readable.
 *
 * A rule is derived from a request the user points at, rather than typed, and matches on the parts
 * of a URL that stay put while a page polls: the query string is deliberately ignored.
 **/

var EXPORTED_SYMBOLS = ["MuteRules"];

if ("undefined" == typeof(MuteRules)) {
  var MuteRules = {};
};

MuteRules.STORAGE_KEY = "muteRules";

/** Matches one endpoint: same method, host and path, whatever the query string. */
MuteRules.ENDPOINT = "endpoint";

/** Matches everything from one host. */
MuteRules.HOST = "host";

/**
 * Derives a rule from a traced request. Returns null for a URL that cannot be parsed, so a caller
 * never has to guard against one.
 */
MuteRules.describe = function(request, scope) {
  if (!request || !request.url) {
    return null;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return null;
  }

  if (scope === MuteRules.HOST) {
    return { scope: MuteRules.HOST, host: url.host };
  }
  return { scope: MuteRules.ENDPOINT, method: request.method, host: url.host, path: url.pathname };
};

/** A stable identity for a rule, used to deduplicate and to address one for removal. */
MuteRules.key = function(rule) {
  if (!rule) {
    return "";
  }
  return rule.scope === MuteRules.HOST
    ? `${MuteRules.HOST}|${rule.host}`
    : `${MuteRules.ENDPOINT}|${rule.method}|${rule.host}|${rule.path}`;
};

/** How a rule reads in the dialog that lists them. */
MuteRules.label = function(rule) {
  if (!rule) {
    return "";
  }
  return rule.scope === MuteRules.HOST
    ? `everything from ${rule.host}`
    : `${rule.method} ${rule.host}${rule.path}`;
};

MuteRules.matches = function(rule, request) {
  if (!rule || !request || !request.url) {
    return false;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return false;
  }

  if (rule.scope === MuteRules.HOST) {
    return url.host === rule.host;
  }
  return request.method === rule.method && url.host === rule.host && url.pathname === rule.path;
};

/**
 * The browser's storage, or null where there is none — under test, or in a context where the
 * extension APIs are not present. A null store simply does not persist; nothing else changes.
 */
MuteRules.storageArea = function() {
  const api = (typeof browser !== "undefined" && browser.storage) ? browser
    : (typeof chrome !== "undefined" && chrome.storage) ? chrome
    : null;
  return api ? api.storage.local : null;
};

MuteRules.Store = function(storageArea) {
  // Passing the area in keeps the store testable; omitting it uses the browser's.
  this.storageArea = storageArea === undefined ? MuteRules.storageArea() : storageArea;
  this.rules = [];
};

MuteRules.Store.prototype = {
  'load' : async function() {
    if (!this.storageArea) {
      return this.rules;
    }
    const stored = await this.storageArea.get(MuteRules.STORAGE_KEY);
    const rules = stored ? stored[MuteRules.STORAGE_KEY] : null;
    this.rules = Array.isArray(rules) ? rules : [];
    return this.rules;
  },

  'save' : async function() {
    if (!this.storageArea) {
      return;
    }
    await this.storageArea.set({ [MuteRules.STORAGE_KEY]: this.rules });
  },

  /** Adds a rule unless an identical one is already held. Returns whether anything changed. */
  'add' : function(rule) {
    if (!rule) {
      return false;
    }

    const key = MuteRules.key(rule);
    if (this.rules.some(existing => MuteRules.key(existing) === key)) {
      return false;
    }

    this.rules.push(rule);
    return true;
  },

  'remove' : function(key) {
    const remaining = this.rules.filter(rule => MuteRules.key(rule) !== key);
    const changed = remaining.length !== this.rules.length;
    this.rules = remaining;
    return changed;
  },

  /**
   * Widens an endpoint rule to its whole host, dropping any rule the wider one now covers. This is
   * the common second step: one polling endpoint turns out to be one of several on the same host.
   */
  'broaden' : function(key) {
    const rule = this.rules.find(existing => MuteRules.key(existing) === key);
    if (!rule || rule.scope === MuteRules.HOST) {
      return false;
    }

    const wider = { scope: MuteRules.HOST, host: rule.host };
    this.rules = this.rules.filter(existing => existing.host !== rule.host);
    this.rules.push(wider);
    return true;
  },

  'clear' : function() {
    const changed = this.rules.length > 0;
    this.rules = [];
    return changed;
  },

  'isMuted' : function(request) {
    return this.rules.some(rule => MuteRules.matches(rule, request));
  }
};
