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

    /**
     * The puppeteer Browser for the running scenario, created by
     * common.iCreateBrowserAsync from the Before hook in features/support/hooks.js
     * and closed again in the After hook. Per-scenario rather than shared so a
     * crash in one scenario cannot leave a zombie Chrome behind.
     * @type {import("puppeteer-core").Browser | undefined}
     */
    browser: undefined,

    /**
     * The puppeteer Page under test. Re-created per scenario so cookies,
     * localStorage and the request-interception buffers all start clean.
     * @type {import("puppeteer-core").Page | undefined}
     */
    page: undefined,

    /**
     * True once the page under test has completed at least one navigation.
     * common.iInjectCookiesAsync is driven off this so the configured cookies
     * are applied exactly once, before the first navigation of a scenario.
     * @type {boolean}
     */
    hasNavigated: false,

    /**
     * The site most recently selected by the `Set the default to "<x>" site`
     * step. Steps that take a site but receive no explicit argument fall back
     * to this, which is what lets the feature file read `I navigate to the
     * "productSelector" page` without repeating the site name.
     * @type {string | undefined}
     */
    defaultsite: undefined,

    /**
     * The analytics provider the current scenario is asserting on, e.g.
     * "Adobe Analytics". Set by the `Set the default analytics provider to
     * "<x>"` step and used to pick which beacon pattern the Then steps match.
     * @type {string | undefined}
     */
    defaultprovider: undefined,
};

module.exports = scope;

