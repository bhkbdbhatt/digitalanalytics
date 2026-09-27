// Dependencies 
const scope = require("./scope");
const urlresolver = require("url");
const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");
const puppeteer = require("puppeteer-core");
// The baseline had `require("command - line - args")` - a space was injected
// into the module name, which made every require of this file fail with
// MODULE_NOT_FOUND and killed the whole Cucumber run before any step executed.
const commandLineArgs = require("command-line-args");
const ElementNotFoundError = require("./customerrors/elementnotfounderror.js");
const clioptionDefinitions = [
    { name: "configfilepath", type: String, defaultValue: "UNDEFINED" },
    { name: "verbosetrace", type: String, defaultValue: "UNDEFINED" },
    { name: "environment", type: String, defaultValue: "UNDEFINED" },
    { name: "parallel", type: Number, defaultValue: "1" }
];
function iInitializeClioptions() {
    if (scope.configuration.clioptions && !!scope.configuration.clioptions.initialized) {
        return;
    }
    require("dotenv").config();
    scope.configuration.clioptions = commandLineArgs(clioptionDefinitions, {
        partial: true
    });
    scope.configuration.clioptions.initialized = true;
}

/**
 * scope.logger only exists after logInitializer.initialize() has run, and the
 * helpers below are also exercised directly (logInitializer bootstrap, unit
 * tests), so route logging through a guard instead of assuming a logger exists.
 * @param {"trace"|"debug"|"info"|"warn"|"error"|"fatal"} level
 * @param {string} message
 */
function logSafely(level, message) {
    if (scope.logger && typeof scope.logger[level] === "function") {
        scope.logger[level](message);
    }
}
/**
 * Splits a semicolon separated list of paths and resolves every entry to an
 * absolute path. Entries may already be absolute or relative to the repository
 * root (see .env.rpenrollment.example).
 * @param {string} rawvalue
 * @returns {string[]}
 */
function iSplitPathListSync(rawvalue) {
    const lst = [];
    if (!rawvalue) {
        return lst;
    }
    for (let file of rawvalue.split(";")) {
        const entry = file.trim();
        // Baseline bug: `file.trim === ''` compared the function reference
        // instead of calling it, so empty entries were never skipped.
        if (!entry) continue;
        lst.push(path.isAbsolute(entry) ? entry : path.join(process.cwd(), entry));
    }
    return lst;
}

/**
 * ADDITIONAL_CONFIGS is a semicolon separated list of YAML files whose contents
 * are merged into scope.env (later files override earlier ones).
 * @returns {string[]} absolute paths
 */
function iGetAdditionalConfigFilePathsSync() {
    const lst = iSplitPathListSync(process.env.ADDITIONAL_CONFIGS);
    lst.forEach(file => logSafely("info", `ADDITIONAL CONFIGS file at : ${file}`));
    return lst;
}

/**
 * SECRETFILES is a semicolon separated list of YAML files holding a SECRETS
 * mapping (see additionalconfigs/sample.secrets.yml).
 * @returns {string[]} absolute paths
 */
function iGetSecretsFilePathsSync() {
    const lst = iSplitPathListSync(process.env.SECRETFILES);
    lst.forEach(file => logSafely("info", `SECRETS files at : ${file}`));
    return lst;
}

/**
 * Resolves the environment configuration file to load, in priority order:
 *   1. ENV_CONFIG_PATH    (always wins)
 *   2. configs/<ENVIRONMENTCONFIG>
 *   3. configs/prod.yml   (default)
 * The result is absolute so it can be read regardless of the working directory.
 * @returns {string}
 */
function iGetConfigFilePathSync() {
    let candidate;
    if (process.env.ENV_CONFIG_PATH) {
        candidate = process.env.ENV_CONFIG_PATH.trim();
    } else if (process.env.ENVIRONMENTCONFIG) {
        candidate = path.join("configs", process.env.ENVIRONMENTCONFIG.trim());
    } else {
        candidate = path.join("configs", "prod.yml");
    }
    return path.isAbsolute(candidate) ? candidate : path.join(process.cwd(), candidate);
}

/**
 * @param {string} inputText
 * @returns {string}
 */

const iGetSecretTextIfRequiredSync = inputText => {
    logSafely("trace", "inside iGetSecretTextIfRequiredSync");
    if (inputText.startsWith("${secrets.") && inputText.endsWith("}")) {
        const x = inputText.slice(10).slice(0, -1);
        scope.logger.trace(`Input text found to be secret key (${x})`);
        if (scope.secrets[x]) {
            scope.logger.info(`Secret text forund for ${x}`);
            return scope.secrets[x];
        } else {
            const msg = `Secret text was not found for ${x}. Are you sure this was set via the environment variables/files`;
            logSafely("error", msg);
            throw new Error(msg);
        }
    }
    else if (inputText.startsWith("${env.") && inputText.endsWith("}")) {
        const x = inputText.slice(6).slice(0, -1)
        scope.logger.trace(`Input text found to be env key (${x})`);
        if (scope.env[x]) {
            scope.logger.info(`env key found to be :${scope.env[x]}`);
            //scope.logger.info(`env text was not found ${x}. Are you sure this was set via the environment variables/file?`)
            return scope.env[x];
        } else {
            const msg = `Env text was not found for ${x}. Are yo sure this was set via the environment variables/file?`
            scope.logger.error(msg);
            throw new Error(msg);
        }
    } else {
        return inputText;
    }
};

/**
 * @param {Number} duration
 * @returns {Promise<void>}
 */

const iDelayAsync = async function (duration) {
    return new Promise(function (resolve) {
        setTimeout(resolve, duration)
    });
};

/**
 * @param {string} site
 * @param {string} pageName
 * @returns {string}
 */

/**
 * Resolves the absolute url for a logical page name of a site, by joining the
 * configured baseUrl with the page's url fragment.
 * @param {string} site
 * @param {string} pageName
 * @returns {string}
 */
const iGetUrlSync = function (site, pageName) {
    if (!scope.sites[site]) {
        throw new Error(
            `site (${site}) is not defined. Check the urlFragments settings in the environment config.`
        );
    }
    // `defaultpage` is a per-site property. The baseline read it off scope.sites
    // directly (always undefined) and mixed "defaultPage"/"defaultpage" casing.
    const defaultpage = scope.sites[site].defaultpage;
    if (defaultpage && defaultpage !== "null" && (!pageName || pageName.toLowerCase() === "defaultpage")) {
        pageName = defaultpage;
    }
    logSafely("trace", `Getting Url from fragment for: ${pageName}`);
    const fragments = scope.sites[site].urlFragments || {};
    if (!fragments[pageName]) {
        throw new Error(
            `Url Fragment ${pageName} does not exist in config file for ${site}`
        );
    }
    const baseUrl = scope.configuration.environment && scope.configuration.environment.baseUrl;
    if (!baseUrl) {
        throw new Error(
            `baseUrl is not configured. Check scope.configuration.environment.baseUrl for the ${site} site.`
        );
    }
    const url = urlresolver.resolve(baseUrl, fragments[pageName]);
    logSafely("debug", `Url found to be :${url}`);
    // Baseline bug: the resolved url was computed and logged but never returned,
    // so every caller received undefined.
    return url;
}

/**
 * @param {Page} page
 * @returns {Promise<void>}
 */
const iAttachPageSnapshotToResultsAsync = async function (page) {
    logSafely("debug", `Take Snapshot for : ${page.url()}.`);
    const browsersettings = scope.configuration.browsersettings || {};
    if (!browsersettings.takesnapshots) {
        logSafely("debug", "Snapshots disabled.");
        return;
    }
    logSafely("debug", "Snapshots are enabled");
    logSafely("trace", "Taking SNapshot");
    // The baseline passed encoding: "base64", which makes puppeteer return a
    // base64 *string*. Cucumber's attach() writes its argument as binary, so a
    // string produced a zero-byte (or corrupt) attachment in every report.
    // Omitting the encoding yields the raw PNG Buffer that attach() expects.
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    logSafely("trace", `Snapshot in buffer.(${buffer.length} bytes)`);
    return await scope.attach(buffer, "image/png");
};

/**
 * @param {Page} page
 * @returns {Promise<void>}
 */

const iAddRequestInterceptionAsync = async function (page) {
    scope.logger.trace(`inside iAddRequestInterceptionAsync`);
    scope.logger.trace(`setRequestInterception to true`);
    await page.setRequestInterception(true);
    scope.logger.trace('adding to page');
    // `page.on` returns the page itself, so this is a registration only - the
    // returned value is deliberately not propagated to callers.
    page.on('request', request => {
        const url = request.url();
        scope.logger.verbosetrace(`Request intercepted : ${url}`);
        scope.requestedUrls.push(url);
        const pd = request.postData();
        if (pd) {
            scope.logger.verbosetrace(`Request intercepted has Postdata : ${pd}`);
            scope.requestedUrlPostData[url] = pd;
        }
        // With interception on, every request must be continued or the load
        // hangs forever. A rejection here (typically the target was torn down
        // mid-flight) is an unhandled rejection otherwise, which kills the
        // worker process and loses the whole scenario's results.
        request.continue().catch(err => {
            scope.logger.trace(`Unable to continue request ${url}: ${err.message}`);
        });
    });
};
/**
 * @param {string} site
 * @param {string} pageName
 * @param {string} locator
 * @returns {string} }
 */
const iGetLocatorSync = function (site, pageName, locator) {
    if (!scope.sites[site]) {
        throw new Error(
            `site (${site}) is not defined. Check the urlFragments settings in the environment config.`
        );
    }
    // `defaultpage` is a per-site property; the baseline read scope.sites.defaultpage
    // (always undefined) and used "defaultPage" here vs "defaultpage" in iGetUrlSync.
    const defaultpage = scope.sites[site].defaultpage;
    if (defaultpage && defaultpage !== "null" && (!pageName || pageName.toLowerCase() === "defaultpage")) {
        pageName = defaultpage;
    }
    logSafely("trace", `Get Locator : ${locator} locator on ${site}'s ${pageName} page`);
    const locators = (scope.sites[site].locators || {})[pageName] || {};
    const by = locators[locator];
    if (!by) {
        logSafely("fatal", `locator (${site}.${pageName}.${locator}) does not exist`);
        throw new Error(`locator (${site}.${pageName}.${locator}) does not exist`);
    }
    if (by.xpath || by.selector || by.jspath) {
        return by;
    }
    else if (by.id) {
        by.selector = `#${by.id}`;
        return by;
    }
    else if (by.linktext) {
        by.xpath = `//a[contains(.,'${by.linktext}')]`;
        return by;
    }
    else {
        logSafely(
            "fatal",
            `locator not identified correctly in yaml file for ${site}/${pageName}/${locator}`
        );
        throw new Error(
            `locator (${site}/${pageName}/${locator}) identification needs to be by xpath or selector only.`
        );
    }
};
/**
 * @param {string} site
 * @param {string} pageName
 * @param {string} locator
 * @returns {Promise<ElementHandle>}}
 */
const iGetWebElementAsync = async (site, pageName, locator) => {
    scope.logger.trace(`Get Web Element : ${locator} locator on ${site}'s ${pageName} page`);
    const by = iGetLocatorSync(site, pageName, locator);
    scope.logger.trace(`By : ${JSON.stringify(by)}`);
    if (by.xpath) {
        return await iGetElementByXpathAsync(by.xpath);
    }
    else {
        return await iGetElementBySelectorAsync(by.selector);
    }
};

/**
 * Folder holding the settings/*.yml files. Prefers environment.settingsfolder
 * from the environment config and otherwise falls back to the repo-level
 * settings folder that sits next to this package.
 * @returns {string} absolute path
 */
function iGetSettingsFolderPathSync() {
    const configuredfolder =
        scope.configuration &&
        scope.configuration.environment &&
        scope.configuration.environment.settingsfolder;
    if (configuredfolder) {
        return path.isAbsolute(configuredfolder)
            ? configuredfolder
            : path.join(process.cwd(), configuredfolder);
    }
    return path.join(__dirname, "..", "..", "settings");
}

/**
 * Reads and parses a single settings/*.yml file. A missing or unreadable file
 * yields an empty object so callers can apply their own defaults instead of
 * failing the whole run.
 * @param {string} filename
 * @returns {object}
 */
function iReadSettingsFileSync(filename) {
    const fullpath = path.join(iGetSettingsFolderPathSync(), filename);
    try {
        return yaml.load(fs.readFileSync(fullpath, "utf8")) || {};
    } catch (err) {
        logSafely("warn", `Unable to read settings file: ${fullpath}. ${err.message}`);
        return {};
    }
}

// ---------------------------------------------------------------------------
// Browser / page lifecycle
// ---------------------------------------------------------------------------

/**
 * Resolves the effective element wait time, preferring an explicit
 * `elementwaittime` setting and falling back to `networkwaittime`.
 * @returns {number} milliseconds
 */
function iGetElementWaitTimeSync() {
    const browsersettings = scope.configuration.browsersettings || {};
    const configured = browsersettings.elementwaittime || browsersettings.networkwaittime;
    const value = Number(configured);
    return Number.isFinite(value) && value >= 0 ? value : 30000;
}

/**
 * Resolves the configured navigation wait strategy, e.g. "networkidle0".
 * @returns {string} a puppeteer PuppeteerLifeCycleEvent
 */
function iGetNavigationWaitUntilSync() {
    const browsersettings = scope.configuration.browsersettings || {};
    return browsersettings.networkidle || "networkidle0";
}

/**
 * Resolves the navigation timeout.
 * @returns {number} milliseconds
 */
function iGetNavigationTimeoutSync() {
    const browsersettings = scope.configuration.browsersettings || {};
    const value = Number(browsersettings.networkwaittime);
    return Number.isFinite(value) && value > 0 ? value : 30000;
}

/**
 * Wraps a value coming from YAML/env (which is a string) in a boolean.
 * @param {*} value
 * @returns {boolean}
 */
function iAsBoolean(value) {
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
}

/**
 * Launches the Chrome instance described by settings/browserSettings.yml and
 * stores it on scope.browser. Idempotent: a live browser is reused.
 * @returns {Promise<import("puppeteer-core").Browser>}
 */
const iCreateBrowserAsync = async function () {
    if (scope.browser) {
        const connected = scope.browser.connected === undefined || scope.browser.connected;
        if (connected) {
            scope.logger.debug("Browser already running - reusing it.");
            return scope.browser;
        }
        scope.logger.warn("Found a disconnected browser - replacing it.");
        scope.browser = undefined;
    }

    const browsersettings = scope.configuration.browsersettings || {};
    const chromepath = browsersettings.chromepath;
    if (!chromepath) {
        throw new Error(
            "browsersettings.chromepath is not configured. Set it in settings/browserSettings.yml or with DAT_browserSettings_chromepath."
        );
    }
    if (!fs.existsSync(chromepath)) {
        throw new Error(
            `browsersettings.chromepath does not exist: ${chromepath}. Override it with DAT_browserSettings_chromepath.`
        );
    }

    const width = Number(browsersettings.width) || 1364;
    const height = Number(browsersettings.height) || 1024;
    const slowmo = Number(browsersettings.slowmo) || 0;

    const launchoptions = {
        executablePath: chromepath,
        headless: iAsBoolean(browsersettings.headless),
        slowMo: slowmo > 0 ? slowmo : undefined,
        defaultViewport: { width: width, height: height },
        args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            `--window-size=${width},${height}`,
        ],
    };

    // Puppeteer will not launch a persistent profile that is already locked by
    // a running Chrome, so this is opt-in via uselocalchromeprofile.
    if (iAsBoolean(browsersettings.uselocalchromeprofile)) {
        const profile = browsersettings.localchromeprofile;
        if (!profile) {
            throw new Error(
                "browsersettings.uselocalchromeprofile is true but localchromeprofile is not set."
            );
        }
        launchoptions.userDataDir = path.isAbsolute(profile) ? profile : path.join(process.cwd(), profile);
    }

    scope.logger.info(
        `Launching Chrome (headless=${launchoptions.headless}, slowMo=${slowmo}, viewport=${width}x${height})`
    );
    scope.browser = await puppeteer.launch(launchoptions);
    return scope.browser;
};

/**
 * Closes the page under test, tolerating an already-closed page.
 * @returns {Promise<void>}
 */
const iClosePageAsync = async function () {
    if (!scope.page) {
        return;
    }
    const page = scope.page;
    scope.page = undefined;
    try {
        if (!page.isClosed()) {
            await page.close();
        }
    } catch (err) {
        // A page whose target already died throws on close; that is fine during
        // teardown as long as we still release the reference.
        logSafely("warn", `Ignoring error while closing the page: ${err.message}`);
    }
};

/**
 * Closes the page (if any) and then the browser, releasing both scope fields
 * even when teardown throws.
 * @returns {Promise<void>}
 */
const iCloseBrowserAsync = async function () {
    await iClosePageAsync();
    if (!scope.browser) {
        return;
    }
    const browser = scope.browser;
    scope.browser = undefined;
    try {
        await browser.close();
    } catch (err) {
        logSafely("warn", `Ignoring error while closing the browser: ${err.message}`);
    }
};

/**
 * Creates the page under test, applies the configured timeouts and starts
 * request interception so the analytics assertions have something to inspect.
 * Any previous page is closed first to keep per-scenario state clean.
 * @returns {Promise<import("puppeteer-core").Page>}
 */
const iCreatePageAsync = async function () {
    await iClosePageAsync();
    if (!scope.browser) {
        await iCreateBrowserAsync();
    }

    const page = await scope.browser.newPage();
    page.setDefaultTimeout(iGetElementWaitTimeSync());
    page.setDefaultNavigationTimeout(iGetNavigationTimeoutSync());

    await iAddRequestInterceptionAsync(page);

    scope.page = page;
    scope.hasNavigated = false;
    scope.logger.info("Created a new page and enabled request interception.");
    return page;
};

/**
 * Adds the cookies from environment.addCookiesOnFirstNavigation. Puppeteer
 * needs a url (or domain/path) on every cookie, so the navigation target is
 * used to scope them.
 * @param {string} url absolute url the cookies must be valid for
 * @returns {Promise<void>}
 */
const iInjectCookiesAsync = async function (url) {
    const cookies = scope.sites.cookiesToAdd;
    if (!cookies || cookies.length === 0) {
        logSafely("debug", "No cookies to inject.");
        return;
    }
    if (!scope.page) {
        throw new Error("Cannot inject cookies because there is no page. Call iCreatePageAsync first.");
    }
    const withurl = cookies.map(cookie => Object.assign({}, cookie, { url: url }));
    scope.logger.debug(`Injecting ${withurl.length} cookie(s) before the first navigation.`);
    await scope.page.setCookie(...withurl);
};

/**
 * Navigates the page under test to a logical page of a site, injecting the
 * configured cookies on the first navigation of the scenario.
 * @param {string} site
 * @param {string} [pageName] defaults to the site's defaultpage
 * @returns {Promise<string>} the url navigated to
 */
const iNavigateAsync = async function (site, pageName) {
    if (!scope.page) {
        await iCreatePageAsync();
    }
    const url = iGetUrlSync(site, pageName);
    if (!scope.hasNavigated) {
        await iInjectCookiesAsync(url);
    }
    scope.logger.info(`Navigating to ${site}/${pageName || "(default)"} -> ${url}`);
    const response = await scope.page.goto(url, {
        waitUntil: iGetNavigationWaitUntilSync(),
        timeout: iGetNavigationTimeoutSync(),
    });
    if (response && !response.ok()) {
        scope.logger.warn(`Navigation to ${url} returned HTTP ${response.status()}.`);
    }
    scope.hasNavigated = true;
    return url;
};

// ---------------------------------------------------------------------------
// Element lookup
// ---------------------------------------------------------------------------

/**
 * Turns a resolved locator into a puppeteer query string. XPath locators are
 * addressed through puppeteer's `xpath/` query handler - the standalone
 * `page.$x` / `page.waitForXPath` helpers were removed in puppeteer v22.
 * @param {{xpath?: string, selector?: string}} by
 * @param {string} [prefix] an extra query handler to wrap with, e.g. "pierce"
 * @returns {string}
 */
function iToQueryString(by, prefix) {
    const base = by.xpath ? `xpath/${by.xpath}` : by.selector;
    return prefix ? `${prefix}/${base}` : base;
}

/**
 * Waits for a locator on a site page to appear in the DOM.
 * @param {string} site
 * @param {string} pageName
 * @param {string} locator
 * @returns {Promise<import("puppeteer-core").ElementHandle>}
 */
const iWaitForElementAsync = async function (site, pageName, locator) {
    if (!scope.page) {
        throw new Error("No page is open. Navigate or call iCreatePageAsync before waiting for an element.");
    }
    const by = iGetLocatorSync(site, pageName, locator);
    const query = iToQueryString(by);
    logSafely("info", `Waiting for ${query}`);
    return await iWaitForElementHandleAsync(query, `${site}.${pageName}.${locator}`);
};

/**
 * Waits for a query to resolve to an element, translating puppeteer's
 * TimeoutError into the framework's ElementNotFoundError.
 *
 * Note that `page.waitForSelector` *rejects* on timeout rather than resolving
 * null, so the null check below is only a belt-and-braces guard - the
 * try/catch is what actually produces the error type callers expect.
 * @param {string} query
 * @param {string} description used in the error message
 * @param {number|undefined} timeout
 * @returns {Promise<import("puppeteer-core").ElementHandle>}
 */
async function iWaitForElementHandleAsync(query, description, timeout) {
    const waittime = timeout === undefined ? iGetElementWaitTimeSync() : timeout;
    let element;
    try {
        element = await scope.page.waitForSelector(query, { timeout: waittime });
    } catch (err) {
        throw new ElementNotFoundError(
            query,
            `Waiting for ${description} timed out after ${waittime}ms.`
        );
    }
    if (!element) {
        throw new ElementNotFoundError(query, `The element was not present in the DOM.`);
    }
    return element;
}

/**
 * Resolves an XPath expression to an element handle, waiting for it to appear.
 * @param {string} xpath
 * @param {number} [timeout]
 * @returns {Promise<import("puppeteer-core").ElementHandle>}
 */
const iGetElementByXpathAsync = async function (xpath, timeout) {
    if (!scope.page) {
        throw new Error("No page is open. Cannot look up an element by xpath.");
    }
    const query = iToQueryString({ xpath: xpath });
    return await iWaitForElementHandleAsync(query, `xpath ${xpath}`, timeout);
};

/**
 * Resolves a CSS selector to an element handle, waiting for it to appear.
 * @param {string} selector
 * @param {number} [timeout]
 * @returns {Promise<import("puppeteer-core").ElementHandle>}
 */
const iGetElementBySelectorAsync = async function (selector, timeout) {
    if (!scope.page) {
        throw new Error("No page is open. Cannot look up an element by selector.");
    }
    return await iWaitForElementHandleAsync(selector, `selector ${selector}`, timeout);
};

/**
 * Resolves a locator that lives inside one or more shadow roots by prefixing
 * the query with puppeteer's `pierce` handler, which recurses through open
 * shadow roots. When inputText is supplied the element is treated as a text
 * entry: its current contents are selected and replaced.
 * @param {string} site
 * @param {string} pageName
 * @param {string} locator
 * @param {string} [inputText] text to type into the element, if it is an input
 * @returns {Promise<import("puppeteer-core").ElementHandle>}
 */
const iGetShadowWebElementAsync = async function (site, pageName, locator, inputText) {
    if (!scope.page) {
        throw new Error("No page is open. Cannot look up a shadow-dom element.");
    }
    const by = iGetLocatorSync(site, pageName, locator);
    const query = iToQueryString(by, "pierce");
    logSafely("info", `Waiting for ${query} inside shadow dom`);

    let element;
    try {
        element = await iWaitForElementHandleAsync(query, `${site}.${pageName}.${locator} (shadow dom)`);
    } catch (err) {
        throw new ElementNotFoundError(query, `Piercing shadow roots for ${site}.${pageName}.${locator} found nothing.`);
    }

    if (inputText !== undefined && inputText !== null) {
        // Triple click selects whatever is already in the field so typing
        // replaces it instead of appending.
        await element.click({ clickCount: 3 });
        await element.type(String(inputText));
        logSafely("debug", `Typed "${inputText}" into ${site}.${pageName}.${locator}`);
    }
    return element;
};

// The baseline had two different misspellings of this function name - the
// definition and the call site in world.js disagreed. Both historical spellings
// stay exported as aliases so neither can silently regress.
const iGetAddiontionalnalConfigFilePathsSync = iGetAdditionalConfigFilePathsSync;
const iGetAdditionalnalConfigFilePathsSync = iGetAdditionalConfigFilePathsSync;

module.exports = {
    iInitializeClioptions,
    iSplitPathListSync,
    iGetAdditionalConfigFilePathsSync,
    iGetAddiontionalnalConfigFilePathsSync,
    iGetAdditionalnalConfigFilePathsSync,
    iGetSecretsFilePathsSync,
    iGetConfigFilePathSync,
    iGetSecretTextIfRequiredSync,
    iDelayAsync,
    iGetUrlSync,
    iAttachPageSnapshotToResultsAsync,
    iAddRequestInterceptionAsync,
    iGetLocatorSync,
    iGetWebElementAsync,
    iGetShadowWebElementAsync,
    iGetSettingsFolderPathSync,
    iReadSettingsFileSync,
    iGetElementWaitTimeSync,
    iGetNavigationWaitUntilSync,
    iGetNavigationTimeoutSync,
    iCreateBrowserAsync,
    iCreatePageAsync,
    iClosePageAsync,
    iCloseBrowserAsync,
    iNavigateAsync,
    iInjectCookiesAsync,
    iWaitForElementAsync,
    iGetElementByXpathAsync,
    iGetElementBySelectorAsync,
    ElementNotFoundError,
};