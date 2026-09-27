/**
 * scope.js
 *
 * Single shared, mutable state bag for the framework.
 *
 * Cucumber loads this module exactly once per worker process; the World
 * constructor (features/support/world.js) resets the scenario-scoped members
 * at the start of every scenario, so anything hanging off `scope` behaves like
 * per-scenario state while still being reachable from the helper modules
 * (common.js / logInitializer.js) without re-plumbing parameters everywhere.
 *
 * NOTE: this module was an empty file in the baseline commit. The shape below
 * is derived from every `scope.<x>` reference in common.js and world.js, so it
 * is the contract those two modules depend on. Keep it in sync with them.
 */

const scope = {
    /**
     * Cucumber's attach() for the running scenario. Set by the World
     * constructor; used by common.iAttachPageSnapshotToResultsAsync.
     * @type {((data: Buffer, mediaType: string) => Promise<void>) | undefined}
     */
    attach: undefined,

    /**
     * Cucumber World parameters (--world-parameters).
     * @type {object | undefined}
     */
    parameters: undefined,

    /**
     * log4js logger instance created by logInitializer.initialize().
     * Always truthy once initialize() has run, so helpers may call
     * scope.logger.<level>() directly.
     * @type {object | undefined}
     */
    logger: undefined,

    /**
     * Resolved framework configuration.
     *   configuration.clioptions         - parsed CLI arguments
     *   configuration.envfilepath        - resolved environment config file
     *   configuration.environment        - contents of configs/<env>.yml
     *   configuration.browsersettings    - settings/browserSettings.yml (+ DAT_ overrides)
     *   configuration.cucumbersettings   - settings/cucumbersettings.yml (+ DAT_ overrides)
     *   configuration.loggersettings     - settings/loggerSettings.yml (+ DAT_ overrides)
     *   configuration.overridingsettings - raw DAT_* values collected from the environment
     * @type {object}
     */
    configuration: {},

    /**
     * Per-site data resolved from pageobjects YAML files.
     *   sites[siteName].urlFragments  - logical page name -> url fragment
     *   sites[siteName].locators      - pageName -> locatorName -> {xpath|selector|id|linktext}
     *   sites[siteName].defaultpage   - optional default page name for that site
     *   sites.cookiesToAdd            - cookies injected on the first navigation
     * @type {object}
     */
    sites: {},

    /**
     * Values resolved from SECRETFILES and SECRET_* environment variables,
     * addressable from data files as ${secrets.<key>}.
     * @type {object}
     */
    secrets: {},

    /**
     * Values resolved from ADDITIONAL_CONFIGS files and the process
     * environment, addressable from data files as ${env.<key>}.
     * @type {object}
     */
    env: {},

    /**
     * Every request URL observed by the request interceptor. This is the raw
     * material the analytics assertions are built from.
     * @type {string[]}
     */
    requestedUrls: [],

    /**
     * Post bodies keyed by request URL, for analytics beacons sent via POST.
     * @type {Object<string, string>}
     */
    requestedUrlPostData: {},
};

module.exports = scope;

