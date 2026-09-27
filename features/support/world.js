/////////////////dependencies////////

const { setWorldConstructor } = require('@cucumber/cucumber')

const { setDefaultTimeout } = require('@cucumber/cucumber')

const puppeteer = require("puppeteer-core");

const yaml = require("js-yaml");

const fs = require("fs");

const path = require("path");

const scope = require("./scope");

const logInitializer = require("./logInitializer");

const common = require("./common");

/////internal methods/////// //

/**
 * Loads the urlFragments of every site from the page-object files referenced by
 * environment.urlFragments, e.g.
 *   urlFragments:
 *     advisor:
 *       - pageobjects/rp/advisor.yml
 * Results land on scope.sites[site].urlFragments.
 */
function getUrlfragments() {
    if (!scope.configuration.environment || !scope.configuration.environment.urlFragments) {
        scope.logger.warn(`No urlFragments found in config`);
        return;
    }

    const urlfragments = scope.configuration.environment.urlFragments;
    scope.logger.trace(`URL fragments files list: ${JSON.stringify(urlfragments)}`);

    for (let site in urlfragments) {
        // A site may declare one file, a list of files, or a keyed map of files.
        const declared = urlfragments[site];
        const filelist = Array.isArray(declared)
            ? declared
            : (typeof declared === "string" ? [declared] : Object.values(declared || {}));

        for (let file of filelist) {
            scope.logger.trace(`UrlFragments for: ${site} | from file: ${file}`);
            try {
                scope.logger.trace(`Loading Url Fragments for: ${site}`);
                // Baseline called a misspelled `getVamlData` (undefined function)
                // after a pointless JSON.stringify/JSON.parse round trip that was
                // actually JSON.parse(String) - parsing the String constructor.
                const yData = getYamlData(file);
                if (!scope.sites[site]) scope.sites[site] = {};
                scope.sites[site].urlFragments = yData.urlFragments;
                scope.logger.trace(`UrlFragments loaded for: ${site}`);
            } catch (err) {
                // either file does not exist or simply is not readable/valid yaml
                const str = `Unable to find/read file: ${file}, Got Error: ${err}`;
                scope.logger.fatal(str);
                throw new Error(str);
            }
        }
    }
}
/**
 * Builds scope.sites.cookiesToAdd from
 * environment.addCookiesOnFirstNavigation, which is a map of cookie name to
 * value (optionally grouped one level deep).
 */
function getDefaultCookiesInfo() {
    scope.sites.cookiesToAdd = null;

    if (!scope.configuration.environment || !scope.configuration.environment.addCookiesOnFirstNavigation) {
        scope.logger.warn("No default cookies to set");
        return;
    }

    const cookies = scope.configuration.environment.addCookiesOnFirstNavigation;
    scope.logger.trace(`Default Cookies list: ${JSON.stringify(cookies)}`);
    scope.sites.cookiesToAdd = [];

    for (let group in cookies) {
        for (let name in cookies[group]) {
            const value = cookies[group][name];
            scope.logger.trace(`Cookie: ${name} | value: ${value}`);
            scope.sites.cookiesToAdd.push({ name: name, value: value });
        }
    }
    scope.logger.debug(`Cookies that would be added: ${JSON.stringify(scope.sites.cookiesToAdd)}`);
}

function loadSecrets() {
    for (let file of common.iGetSecretsFilePathsSync()) {
        try {
            const data = getYamlData(file) || {};
            const secrets = data["SECRETS"] || {};
            if (!data["SECRETS"]) {
                scope.logger.warn(`No SECRETS mapping found in secrets file: ${file}`);
            }
            for (let key in secrets) {
                scope.secrets[key] = secrets[key];
            }
        }
        catch (err) {
            // either file does not exist or simply is not readable/valid yaml 
            const str = `Unable to find/read file: ${file}, Got Error: ${err}`;
            scope.logger.fatal(str);
            throw new Error(str);
        }
    }
    for (let [key, value] of Object.entries(process.env)) {
        if (key.startsWith("SECRET_")) {
            scope.secrets[key.slice(7)] = value;
        }
    }
}

/** Prefix that marks an environment variable as a settings override. */
const DAT_PREFIX = "dat_";

/** Settings groups that accept DAT_* overrides, lower-cased for matching. */
const OVERRIDE_GROUPS = ["browsersettings", "cucumbersettings", "loggersettings"];

/**
 * Returns (creating if needed) scope.configuration.overridingsettings[group].
 * @param {string} group
 * @returns {object}
 */
function ensureOverridingBag(group) {
    if (!scope.configuration.overridingsettings) {
        scope.configuration.overridingsettings = {};
    }
    if (!scope.configuration.overridingsettings[group]) {
        scope.configuration.overridingsettings[group] = {};
    }
    return scope.configuration.overridingsettings[group];
}

/**
 * Returns (creating if needed) scope.configuration[group].
 * @param {string} group
 * @returns {object}
 */
function ensureConfigurationBag(group) {
    if (!scope.configuration[group]) {
        scope.configuration[group] = {};
    }
    return scope.configuration[group];
}

/**
 * Collects DAT_* environment variables and applies them over the values loaded
 * from settings/*.yml.
 *
 * Naming convention (see .env.rpenrollment.example):
 *   DAT_browserSettings_chromepath   -> browsersettings.chromepath
 *   DAT_cucumberSettings_defaultTimeoutForStep
 *   DAT_loggerSettings_loggerlevel
 */
function overrideSettingsWithEnvVariables() {
    for (let [key, value] of Object.entries(process.env)) {
        if (!key.toLowerCase().startsWith(DAT_PREFIX)) {
            continue;
        }
        // e.g. "browserSettings_chromepath"
        const remainder = key.slice(DAT_PREFIX.length);
        const group = OVERRIDE_GROUPS.find(candidate =>
            remainder.toLowerCase().startsWith(`${candidate}_`)
        );
        if (!group) {
            scope.logger.warn(`Ignoring unrecognised DAT_ override: ${key}`);
            continue;
        }
        // The setting name keeps its original casing so it lines up with the key
        // as written in settings/*.yml. The baseline lower-cased everything,
        // which meant DAT_cucumberSettings_defaultTimeoutForStep never matched
        // defaultTimeoutForStep and was silently dropped.
        ensureOverridingBag(group)[remainder.slice(group.length + 1)] = value;
    }

    const overriding = scope.configuration.overridingsettings || {};
    const osb = overriding.browsersettings;
    const osc = overriding.cucumbersettings;
    const osl = overriding.loggersettings;

    // NOTE: this block sat INSIDE the 'loggersettings_' branch in the baseline,
    // so browser overrides only applied when a DAT_loggerSettings_* variable
    // happened to be set as well.
    if (osb) {
        const bs = ensureConfigurationBag("browsersettings");
        bs.chromepath = osb.chromepath || bs.chromepath;
        bs.localchromeprofile = osb.localchromeprofile || bs.localchromeprofile;
        bs.uselocalchromeprofile = osb.uselocalchromeprofile
            ? (osb.uselocalchromeprofile.toLowerCase() === "true")
            : bs.uselocalchromeprofile;
        bs.headless = osb.headless ? (osb.headless.toLowerCase() === "true") : bs.headless;
        bs.slowmo = osb.slowmo ? cleanInt(osb.slowmo) : bs.slowmo;
        bs.width = osb.width ? cleanInt(osb.width) : bs.width;
        bs.height = osb.height ? cleanInt(osb.height) : bs.height;
        bs.takesnapshots = osb.takesnapshots ? (osb.takesnapshots.toLowerCase() === "true") : bs.takesnapshots;
        // Baseline read scope.configuration.networkidle here instead of the
        // browsersettings one, so this override never took effect.
        bs.networkidle = osb.networkidle || bs.networkidle;
        bs.networkwaittime = osb.networkwaittime ? cleanInt(osb.networkwaittime) : bs.networkwaittime;
    }

    if (osc && osc.defaultTimeoutForStep !== undefined) {
        const cs = ensureConfigurationBag("cucumbersettings");
        cs.defaultTimeoutForStep = cleanInt(osc.defaultTimeoutForStep);
    }

    if (osl) {
        const ls = ensureConfigurationBag("loggersettings");
        ls.loggerlevel = osl.loggerlevel || ls.loggerlevel;
        ls.loggerlevelverbosetrace = osl.loggerlevelverbosetrace
            ? (osl.loggerlevelverbosetrace.toLowerCase() === "true")
            : ls.loggerlevelverbosetrace;
    }
}

/**
 * Coerces a value to an integer.
 * Baseline had no parameter at all and relied on an implicit global `x` that
 * leaked out of this function.
 * @param {string|number} x
 * @returns {number}
 */
function cleanInt(x) {
    const value = Number(x);
    return value >= 0 ? Math.floor(value) : Math.ceil(value);
}
function loadEnvConfigs() {
    // Baseline called a second, differently misspelled name here
    // (iGetAdditionalnalConfigFilePathsSync). The canonical name is now
    // iGetAdditionalConfigFilePathsSync; the old spellings remain exported.
    for (let file of common.iGetAdditionalConfigFilePathsSync()) {
        try {
            const data = getYamlData(file) || {};
            for (let k in data) {
                scope.env[k] = data[k];
            }
        }
        catch (err) {
            const str = `Unable to find/read file: ${file}. Got error: ${err}`;
            scope.logger.fatal(str);
            throw new Error(str);
        }
    }
    for (let [key, value] of Object.entries(process.env)) {
        scope.env[key] = value;
    }
}

/**
 * Reads and parses a YAML data file (env config, page objects, additional
 * configs, secrets).
 *
 * @param {string} filename absolute path, or a path relative to the repository
 *                          root / settings folder
 * @param {Boolean} [useSettingsFolder] when true the name is resolved inside
 *                          the settings folder instead of the repository root
 * @returns {object} parsed YAML
 */
function getYamlData(filename, useSettingsFolder) {
    let filepath = useSettingsFolder === true
        ? path.join(common.iGetSettingsFolderPathSync(), filename)
        : filename;

    if (!path.isAbsolute(filepath)) {
        filepath = path.join(process.cwd(), filepath);
    }
    return yaml.load(fs.readFileSync(filepath, "utf8"));
}
/**
 * Loads the settings/*.yml files into scope.configuration.
 *
 * The baseline defined getYamlData() for exactly this purpose but never called
 * it, so the entire settings folder (browser, cucumber and logger settings) was
 * dead weight and every DAT_* override was applied to an empty object.
 */
function loadSettingsFiles() {
    const settingsfiles = {
        browsersettings: "browserSettings.yml",
        cucumbersettings: "cucumbersettings.yml",
        loggersettings: "loggerSettings.yml",
        appsettings: "appSettings.yml",
    };
    for (let group in settingsfiles) {
        const filename = settingsfiles[group];
        const loaded = common.iReadSettingsFileSync(filename);
        Object.assign(ensureConfigurationBag(group), loaded);
        if (Object.keys(loaded).length === 0) {
            scope.logger.warn(`Settings file ${filename} is empty or unreadable - ${group} will use defaults.`);
        }
    }
}

/**
 * Loads the environment config chosen by ENV_CONFIG_PATH / ENVIRONMENTCONFIG
 * into scope.configuration.environment (baseUrl, settingsfolder, urlFragments,
 * addCookiesOnFirstNavigation).
 */
function loadEnvironmentConfig() {
    const envfilepath = scope.configuration.envfilepath;
    try {
        const data = getYamlData(envfilepath) || {};
        scope.configuration.environment = data;
        if (Object.keys(data).length === 0) {
            scope.logger.warn(
                `Environment config ${envfilepath} is empty. baseUrl and urlFragments must be supplied before any navigation step can run.`
            );
        }
    } catch (err) {
        const str = `Unable to find/read environment config file: ${envfilepath}. Got error: ${err}`;
        scope.logger.fatal(str);
        throw new Error(str);
    }
}

/////World construction/////

const World = function ({ attach, parameters }) {

    //default stuff

    scope.attach = attach;
    scope.parameters = parameters;
    scope.secrets = {};
    scope.sites = {};
    // Request capture is per scenario: the analytics assertions look at exactly
    // what the scenario under test triggered, so the baseline's never-reset
    // arrays would have leaked beacons from earlier scenarios into later ones.
    scope.requestedUrls = [];
    scope.requestedUrlPostData = {};
    scope.configuration = {};
    scope.configuration.overridingsettings = {};
    logInitializer.initialize();
    scope.logger.info(`Creating World`);

    common.iInitializeClioptions();

    scope.configuration.envfilepath = common.iGetConfigFilePathSync();
    scope.logger.info(`Config file: ${scope.configuration.envfilepath}`);

    // Configuration pipeline. Order matters: settings files first, then the
    // environment config, then environment-derived values, then the DAT_*
    // overrides on top, and finally the derived site/cookie data.
    loadSettingsFiles();
    loadEnvironmentConfig();
    loadEnvConfigs();
    loadSecrets();
    overrideSettingsWithEnvVariables();
    getUrlfragments();
    getDefaultCookiesInfo();

    // Re-apply the logger settings now that DAT_loggerSettings_* has been merged.
    logInitializer.initialize();
};

/////Cucumber registration/////

// The baseline imported setWorldConstructor and setDefaultTimeout but never
// called either of them, so Cucumber created a default empty World and
// scope.attach / scope.logger stayed undefined for every step.
setWorldConstructor(World);

// setDefaultTimeout must run while support code is being loaded. The value comes
// from settings/cucumbersettings.yml and is overridable with
// DAT_cucumberSettings_defaultTimeoutForStep.
const configuredDefaultTimeout = cleanInt(
    common.iReadSettingsFileSync("cucumbersettings.yml").defaultTimeoutForStep
);
setDefaultTimeout(Number.isNaN(configuredDefaultTimeout) ? 60000 : configuredDefaultTimeout);