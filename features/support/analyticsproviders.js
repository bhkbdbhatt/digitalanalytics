/**
 * analyticsproviders.js
 *
 * Knows how to recognise an analytics beacon in the intercepted request log
 * and how to pull values out of it, so the Then steps can assert on
 * "the provider fired" and "the provider carried key X = Y".
 *
 * Everything site-specific comes from configuration rather than code, because
 * the collect endpoint differs per environment and per vendor account. Look
 * under `analyticsproviders` in configs/<env>.yml (or an additional config
 * listed in ADDITIONAL_CONFIGS):
 *
 *   analyticsproviders:
 *     Adobe Analytics:
 *       urlmatches: ["s.gif", "b/ssrs", "2o7.net"]   # any one => a beacon
 *       queryparams: ["s_account", "pageName"]       # at least one must be present
 *       valueencoding: urlencoded | json | auto
 *       aliases:
 *         "page name": pageName                      # label -> real parameter
 *
 * A provider that is not configured falls back to DEFAULT_PROVIDER_CONFIG, so
 * a provider can be exercised before anyone has written its YAML.
 */

const scope = require("./scope");
const common = require("./common");

/** Applied to any provider that has no explicit configuration. */
const DEFAULT_PROVIDER_CONFIG = {
    urlmatches: ["/collect", "s.gif", "s_code", "b/ssrs", "omtrdc.net", "2o7.net"],
    queryparams: [],
    valueencoding: "auto",
    aliases: {},
};

/** Schemas whose beacons are not analytics beacons at all. */
const IGNORED_URL_PREFIXES = [
    "data:",
    "blob:",
    "about:",
    "chrome-extension:",
    "devtools:",
];

/**
 * @param {*} level
 * @param {string} message
 */
function logSafely(level, message) {
    if (scope.logger && typeof scope.logger[level] === "function") {
        scope.logger[level](message);
    }
}

/**
 * Reduces a key to a comparable form so the feature files can use human labels
 * ("Page name") against the wire parameter (`pageName`).
 * @param {string} value
 * @returns {string}
 */
function iNormalizeKey(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Decodes the HTML entities a page beacon tends to carry in its values, then
 * collapses whitespace and lower-cases, so `"investments &gt; Product"`
 * written in a feature file matches what actually went over the wire.
 * @param {*} value
 * @returns {string}
 */
function iNormalizeValue(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value)
        .replace(/&nbsp;/gi, " ")
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&apos;|&rsquo;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&amp;/gi, "&")
        .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/**
 * Parses a query string into an ordered list of [key, value] pairs. Order
 * matters for the Adobe beacon formats, which encode a payload as a
 * positional list rather than a map.
 * @param {string} querystring
 * @returns {Array<[string, string]>}
 */
function iParseOrderedPairsSync(querystring) {
    const pairs = [];
    if (!querystring) {
        return pairs;
    }
    for (const pair of querystring.replace(/^\?/, "").split("&")) {
        if (!pair) {
            continue;
        }
        const separator = pair.indexOf("=");
        const rawkey = separator === -1 ? pair : pair.slice(0, separator);
        const rawvalue = separator === -1 ? "" : pair.slice(separator + 1);
        pairs.push([decodeURIComponentSafe(rawkey), decodeURIComponentSafe(rawvalue)]);
    }
    return pairs;
}

/**
 * Folds ordered key/value pairs into a map.
 *
 * Two encodings are supported:
 *   - a plain map, e.g. `pageName=Home&prop1=abc`
 *   - Adobe's positional `n`/`v` form, e.g. `n=pageName&v=Home&n=prop1&v=abc`,
 *     which is what the image collection endpoint accepts as a POST body. A
 *     plain parse of that collapses to a single `n` key, so the pairs have to
 *     be zipped up by position instead.
 *
 * @param {Array<[string, string]>} pairs
 * @returns {Object<string, string>}
 */
function iFoldPairsSync(pairs) {
    const values = {};
    const isAdobeList = pairs.some(([key]) => key === "n");
    if (isAdobeList) {
        let pendingname = null;
        for (const [key, value] of pairs) {
            if (key === "n") {
                pendingname = value;
            } else if (key === "v" && pendingname !== null) {
                values[pendingname] = value;
                pendingname = null;
            } else if (pendingname !== null) {
                // A `k`-style body pairs each name with the next value.
                values[pendingname] = value;
                pendingname = null;
            }
        }
        return values;
    }
    for (const [key, value] of pairs) {
        values[key] = value;
    }
    return values;
}

/**
 * Parses a query string into a plain object.
 * @param {string} querystring
 * @returns {Object<string, string>}
 */
function iParseQueryStringSync(querystring) {
    return iFoldPairsSync(iParseOrderedPairsSync(querystring));
}

/**
 * decodeURIComponent throws on malformed sequences, which real-world beacons
 * do contain. Fall back to the raw text instead of failing the scenario.
 * @param {string} value
 * @returns {string}
 */
function decodeURIComponentSafe(value) {
    try {
        return decodeURIComponent(value.replace(/\+/g, " "));
    } catch (err) {
        return value;
    }
}

/**
 * Flattens a decoded JSON beacon body into dotted key paths, so
 * {"a":{"b":1}} becomes {"a.b": "1"} and the feature files can assert on it.
 * @param {*} value
 * @param {string} [prefix]
 * @param {Object<string, string>} [into]
 * @returns {Object<string, string>}
 */
function iFlattenJson(value, prefix, into) {
    const target = into || {};
    if (value === null || typeof value !== "object") {
        return target;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            iFlattenJson(item, prefix ? `${prefix}.${index}` : String(index), target);
        });
        return target;
    }
    for (const key of Object.keys(value)) {
        const child = value[key];
        const path = prefix ? `${prefix}.${key}` : key;
        if (child !== null && typeof child === "object") {
            iFlattenJson(child, path, target);
        } else {
            target[path] = child === null || child === undefined ? "" : String(child);
        }
    }
    return target;
}

/**
 * Extracts key/value pairs from a beacon body, honouring the urlencoded,
 * json and auto encodings.
 * @param {string} postdata
 * @param {string} encoding
 * @returns {Object<string, string>}
 */
function iParsePostDataSync(postdata, encoding) {
    if (!postdata) {
        return {};
    }
    const trimmed = postdata.trim();
    const looksjson = trimmed.startsWith("{") || trimmed.startsWith("[");
    const usejson = encoding === "json" || (encoding !== "urlencoded" && looksjson);
    if (usejson) {
        try {
            return iFlattenJson(JSON.parse(trimmed));
        } catch (err) {
            logSafely("debug", `Beacon body looked like JSON but failed to parse: ${err.message}`);
            return iParseQueryStringSync(trimmed);
        }
    }
    // Adobe's image-collection POST body is a positional list rather than a
    // map, so this must go through iParseOrderedPairsSync rather than a plain
    // query-string parse.
    return iFoldPairsSync(iParseOrderedPairsSync(trimmed));
}

/**
 * Looks up the configuration for a provider, case-insensitively, merged over
 * the defaults.
 * @param {string} providername
 * @returns {object}
 */
function iGetProviderConfig(providername) {
    const configured = (scope.configuration.environment || {}).analyticsproviders || {};
    let match = configured[providername];
    if (!match) {
        const wanted = providername.toLowerCase();
        const key = Object.keys(configured).find(candidate => candidate.toLowerCase() === wanted);
        match = key ? configured[key] : null;
    }
    return Object.assign({}, DEFAULT_PROVIDER_CONFIG, match || {});
}

/**
 * Collects every intercepted request that looks like a beacon for the given
 * provider, together with the key/value pairs it carried.
 * @param {string} providername
 * @returns {Array<{url: string, values: Object<string, string>}>}
 */
function iGetProviderBeacons(providername) {
    const providerconfig = iGetProviderConfig(providername);
    const markers = (providerconfig.urlmatches || []).map(marker => String(marker).toLowerCase());
    const required = (providerconfig.queryparams || []).map(param => iNormalizeKey(param));
    const beacons = [];

    for (const url of scope.requestedUrls) {
        const lowerurl = String(url).toLowerCase();
        if (IGNORED_URL_PREFIXES.some(prefix => lowerurl.startsWith(prefix))) {
            continue;
        }
        if (markers.length > 0 && !markers.some(marker => lowerurl.includes(marker))) {
            continue;
        }

        // NOTE: the query string has to be sliced out of the ORIGINAL url, not
        // out of `lowerurl`. Parsing the lowercased copy silently lowercases
        // every parameter name, so `pageName` would only ever match a
        // `pagename=` beacon and every real value assertion would fail.
        const withoutScheme = url.replace(/^https?:\/\//i, "");
        const querystart = withoutScheme.indexOf("?");
        const querystring = querystart === -1 ? "" : withoutScheme.slice(querystart + 1);
        const values = iParseQueryStringSync(querystring);
        Object.assign(
            values,
            iParsePostDataSync(scope.requestedUrlPostData[url], providerconfig.valueencoding)
        );

        if (required.length > 0) {
            const presentkeys = Object.keys(values).map(iNormalizeKey);
            if (!required.some(param => presentkeys.includes(param))) {
                continue;
            }
        }
        beacons.push({ url: url, values: values });
    }

    logSafely(
        "info",
        `${providername}: matched ${beacons.length} beacon(s) out of ${scope.requestedUrls.length} request(s).`
    );
    return beacons;
}

/**
 * Asserts how many beacons the provider fired.
 * @param {string} providername
 * @param {number} expected
 */
function iAssertProviderTriggeredTimes(providername, expected) {
    const beacons = iGetProviderBeacons(providername);
    if (beacons.length !== expected) {
        const detail = beacons
            .slice(0, 10)
            .map((beacon, index) => `  [${index}] ${beacon.url}`)
            .join("\n");
        throw new Error(
            `Expected "${providername}" to be triggered ${expected} time(s) but it was triggered ${beacons.length}.\n` +
            `Matched beacons:\n${detail || "  (none)"}`
        );
    }
}

/**
 * Asserts that at least one beacon for the provider carried the given key with
 * the given value. `key` is matched against both the real parameter name and
 * any configured alias, ignoring case and punctuation, so "Page name" in a
 * feature file matches the wire parameter `pageName`.
 *
 * @param {string} providername
 * @param {string} key
 * @param {string} value
 * @param {Array<{key: string, value: string}>} [expectedpairs] further pairs
 *        from a data table, each of which must appear on the same beacon
 */
function iAssertProviderHasValue(providername, key, value, expectedpairs) {
    const providerconfig = iGetProviderConfig(providername);
    const aliases = providerconfig.aliases || {};
    const wantedkey = iNormalizeKey(aliases[key] || key);
    const wantedvalue = iNormalizeValue(value);
    const extra = (expectedpairs || []).map(pair => ({
        key: iNormalizeKey(aliases[pair.key] || pair.key),
        value: iNormalizeValue(pair.value),
    }));

    const beacons = iGetProviderBeacons(providername);
    if (beacons.length === 0) {
        throw new Error(
            `"${providername}" did not trigger at all, so "${key}=${value}" could not be found.`
        );
    }

    // Map each requested key to its actual parameter name on this beacon, so
    // every pair has to be satisfied by one single beacon rather than by the
    // request log as a whole.
    const failures = [];
    const matched = beacons.find(beacon => {
        const actualkeys = Object.keys(beacon.values);
        const resolved = [{ wanted: wantedkey, actual: null, value: wantedvalue }]
            .concat(extra)
            .map(request => {
                const actual = actualkeys.find(candidate => iNormalizeKey(candidate) === request.wanted);
                return { wanted: request.wanted, actual: actual, value: request.value };
            });
        const satisfied = resolved.every(
            entry => entry.actual !== undefined && iNormalizeValue(beacon.values[entry.actual]) === entry.value
        );
        if (!satisfied) {
            resolved
                .filter(entry => entry.actual === undefined || iNormalizeValue(beacon.values[entry.actual]) !== entry.value)
                .forEach(entry =>
                    failures.push(
                        entry.actual === undefined
                            ? `  no parameter matching "${entry.wanted}"`
                            : `  ${entry.actual}="${beacon.values[entry.actual]}" (expected "${entry.value}")`
                    )
                );
        }
        return satisfied;
    });

    if (!matched) {
        throw new Error(
            `No "${providername}" beacon carried ${key}="${value}"` +
            (extra.length ? ` (plus ${extra.length} further expected value(s))` : "") +
            `.\nDifferences across the ${beacons.length} beacon(s):\n${failures.slice(0, 20).join("\n")}`
        );
    }
    logSafely("info", `"${providername}" beacon carried ${key}="${value}".`);
    return matched;
}

/**
 * Asserts that something analytics-shaped was requested at all, without pinning
 * it to a named provider.
 */
function iAssertAnalyticsTriggered() {
    // Check "the page never loaded" before "the beacon did not match": if
    // nothing was intercepted at all, tweaking urlmatches will not help.
    if (scope.requestedUrls.length === 0) {
        throw new Error(
            "Analytics should be triggered, but no requests were intercepted at all. " +
            "The page most likely never loaded - check the navigation step, the baseUrl in the " +
            "environment config, and the network idle setting."
        );
    }

    const provider = scope.defaultprovider;
    if (provider) {
        const beacons = iGetProviderBeacons(provider);
        if (beacons.length > 0) {
            logSafely("info", `Analytics was triggered (${beacons.length} ${provider} beacon(s)).`);
            return;
        }
        throw new Error(
            `Analytics should be triggered, but no "${provider}" beacon was captured. ` +
            `Check analyticsproviders.${provider}.urlmatches against the ${scope.requestedUrls.length} intercepted request(s).`
        );
    }

    logSafely("info", `Analytics was triggered (${scope.requestedUrls.length} request(s) intercepted).`);
}

module.exports = {
    DEFAULT_PROVIDER_CONFIG,
    iNormalizeKey,
    iNormalizeValue,
    iGetProviderConfig,
    iGetProviderBeacons,
    iAssertProviderTriggeredTimes,
    iAssertProviderHasValue,
    iAssertAnalyticsTriggered,
    // re-exported so the step definitions have a single import for assertions
    ElementNotFoundError: common.ElementNotFoundError,
};
