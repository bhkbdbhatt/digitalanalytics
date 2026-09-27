// Dependencies 
const scope = require("./scope");
const urlresolver = require("url");
const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");
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
    scope.logger.debug(`Take Snapshot for : ${page.url()}.`);
    if (!scope.configuration.browsersettings.takesnapshots) {
        scope.logger.debug("Snapshots disabled.");
        return;
    }
    scope.logger.debug("Snapshots are enabled");
    scope.logger.trace("Taking SNapshot");
    const buffer = await page.screenshot({ encoding: "base64", fullPage: true });
    scope.logger.trace(`Snapshot in bffer.(${buffer.length} bytes)`);
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
    return await page.on('request', request => {
        const url = request.url();
        scope.logger.verbosetrace(`Request intercepted : ${url}`);
        scope.requestedUrls.push(url);
        const pd = request.postData();
        if (pd) {
            scope.logger.verbosetrace(`Request intercepted has Postdata : ${pd}`);
            scope.requestedUrlPostData[url] = pd;
        }
        request.continue();
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
 * @param {string} site
 * @param {string} pageName
 * @param {string} locator
 * @param {string} inputText
 * @returns {Promise<ElementHandle>}}
 */
const iGetShadowWebElementAsync = async (site, pageName, locator, inputText) => {
    logSafely("trace", `Get web element : ${locator} locator on ${site}'s ${pageName} page`);
    // KNOWN GAP (Phase 3 of the remediation plan). The baseline was a single log
    // statement with no return value. Implementing this needs a decision on the
    // shadow-piercing strategy (puppeteer `pierce/` query handler vs manual
    // evaluateHandle traversal), so it deliberately throws instead of guessing.
    throw new Error(
        `iGetShadowWebElementAsync is not implemented yet (${site}.${pageName}.${locator}).`
    );
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
// KNOWN GAPS - referenced above / by the hooks but not present in this file.
// Tracked for Phase 3 of the remediation plan:
//   iGetElementByXpathAsync, iGetElementBySelectorAsync  (used by iGetWebElementAsync)
//   iCreateBrowserAsync, iCreatePageAsync, iClosePageAsync, iCloseBrowserAsync,
//   iNavigateAsync, iInjectCookiesAsync, iWaitForElementAsync
// ---------------------------------------------------------------------------

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
    ElementNotFoundError,
};