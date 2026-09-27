/**
 * logInitializer.js
 *
 * Builds the log4js logger that the rest of the framework reaches through
 * `scope.logger`, and registers the framework's custom VERBOSETRACE level.
 *
 * NOTE: this module was an empty file in the baseline commit while
 * world.js already called logInitializer.initialize(), so every
 * `scope.logger.*` call in common.js threw "Cannot read properties of
 * undefined". The behaviour below is reconstructed from the two settings keys
 * in settings/loggerSettings.yml and from every log call site:
 *
 *   loggerlevel             - the category level passed to log4js
 *                             (trace|debug|info|warn|error|fatal|verbosetrace)
 *   loggerlevelverbosetrace - separate switch gating the extra-verbose
 *                             `logger.verbosetrace()` calls used to dump every
 *                             intercepted request / post data
 */

const log4js = require("log4js");
const scope = require("./scope");
const common = require("./common");

/** Category name; log4js requires every logger to have one. */
const CATEGORY = "digitalanalytics";

/**
 * log4js' built-in TRACE is 5000 and DEBUG is 10000, so VERBOSETRACE sits
 * between them: it is finer grained than TRACE but is additionally gated by
 * the `loggerlevelverbosetrace` toggle below.
 */
const VERBOSETRACE = { value: 5500, colour: "grey" };

/** log4js configuration is process global, so it must only be applied once. */
let configured = false;

/** Settings resolved on the first call and re-applied to scope on every call. */
let resolved = null;

/**
 * Reads settings/loggerSettings.yml and normalises the two keys.
 *
 * world.js re-calls initialize() after it has run the full configuration
 * pipeline, so an already-resolved `scope.configuration.loggersettings`
 * (which is where DAT_loggerSettings_* land) takes precedence over the raw file.
 * @returns {{loggerlevel: string, loggerlevelverbosetrace: boolean}}
 */
function resolveSettings() {
    const fromconfiguration = scope.configuration && scope.configuration.loggersettings;
    const settings = fromconfiguration || common.iReadSettingsFileSync("loggerSettings.yml");
    const level = String(settings.loggerlevel || "info").toLowerCase();
    const verbosetrace = String(settings.loggerlevelverbosetrace).toLowerCase() === "true";
    return { loggerlevel: level, loggerlevelverbosetrace: verbosetrace };
}

/** The level last handed to log4js; settings can change between calls. */
let appliedlevel = null;

/**
 * Applies the one-off log4js configuration.
 * @param {{loggerlevel: string}} settings
 */
function configureLog4js(settings) {
    log4js.configure({
        levels: { VERBOSETRACE },
        appenders: {
            console: {
                type: "stdout",
                layout: {
                    type: "pattern",
                    pattern: "%d{yyyy-MM-dd hh:mm:ss.SSS} [%5.5p] %c - %m",
                },
            },
        },
        categories: {
            default: { appenders: ["console"], level: settings.loggerlevel },
        },
    });
}

/**
 * log4js auto-creates a `verbosetrace()` prototype method for any custom
 * level, but the framework keeps a second on/off switch for it. This shadows
 * the generated method with a flag-aware version so
 * `loggerlevelverbosetrace=false` really does silence it.
 *
 * @param {object} logger
 * @param {{loggerlevelverbosetrace: boolean}} settings
 */
function applyVerboseTraceToggle(logger, settings) {
    const enabled = settings.loggerlevelverbosetrace;

    logger.isVerboseTraceEnabled = function () {
        return enabled;
    };

    logger.verbosetrace = function (...args) {
        if (!enabled) {
            return;
        }
        logger.log("VERBOSETRACE", ...args);
    };

    return logger;
}

/**
 * Idempotent. Safe to call from every World construction (world.js does).
 * @returns {object} the log4js logger stored on scope.logger
 */
function initialize() {
    resolved = resolveSettings();

    if (!configured || appliedlevel !== resolved.loggerlevel) {
        configureLog4js(resolved);
        appliedlevel = resolved.loggerlevel;

        if (!configured) {
            configured = true;
            applyVerboseTraceToggle(log4js.getLogger(CATEGORY), resolved).info(
                `Logger initialised (level=${resolved.loggerlevel}, verbosetrace=${resolved.loggerlevelverbosetrace})`
            );
        } else {
            log4js.getLogger(CATEGORY).info(`Logger level changed to ${resolved.loggerlevel}`);
        }
    }

    const logger = applyVerboseTraceToggle(log4js.getLogger(CATEGORY), resolved);

    // world.js resets scope.configuration for every scenario, so re-attach the
    // resolved logger settings each time rather than only on first use.
    if (!scope.configuration) {
        scope.configuration = {};
    }
    scope.configuration.loggersettings = Object.assign({}, resolved);
    scope.logger = logger;

    return logger;
}

/**
 * Convenience accessor for modules that need the logger without going through
 * scope (initialised on demand).
 * @returns {object}
 */
function getLogger() {
    return initialize();
}

module.exports = {
    initialize,
    getLogger,
    CATEGORY,
    VERBOSETRACE,
};

