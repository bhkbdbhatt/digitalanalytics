/**
 * hooks.js
 *
 * Cucumber lifecycle hooks: browser / page setup and teardown, plus failure
 * diagnostics.
 *
 * The baseline had no hook file at all, so nothing ever launched Chrome even
 * though common.js was written around a browser and a page. The World
 * constructor resets the per-scenario scope fields; these hooks are what put a
 * real browser and page behind them.
 */

const {
    After,
    AfterStep,
    Before,
    Status,
} = require("@cucumber/cucumber");

const fs = require("fs");
const path = require("path");

const scope = require("./scope");
const common = require("./common");

/**
 * The World constructor runs before every Before hook, so the logger and
 * configuration pipeline are already in place here.
 * @returns {Promise<void>}
 */
Before(async function () {
    scope.logger.info("Before hook: launching the browser.");
    await common.iCreateBrowserAsync();
    await common.iCreatePageAsync();
});

/**
 * Attaches a screenshot for any step that failed, so a red scenario is
 * diagnosable from the HTML/Allure report alone.
 */
AfterStep(async function ({ result }) {
    if (result && result.status === Status.FAILED && scope.page) {
        try {
            await common.iAttachPageSnapshotToResultsAsync(scope.page);
        } catch (err) {
            // Never let diagnostics mask the original failure.
            scope.logger.warn(`Unable to attach a failure snapshot: ${err.message}`);
        }
    }
});

After(async function () {
    scope.logger.info("After hook: closing the browser.");
    if (scope.page) {
        try {
            await common.iAttachPageSnapshotToResultsAsync(scope.page);
        } catch (err) {
            scope.logger.warn(`Unable to attach the final snapshot: ${err.message}`);
        }
    }
    await common.iCloseBrowserAsync();
});

/**
 * Hooks the framework exposes for debugging: writing the intercepted request
 * log to disk makes it possible to inspect the analytics beacons of a failing
 * run without re-running it with verbose logging enabled.
 */
After(async function () {
    const target = process.env.DAT_REQUESTLOG_PATH;
    if (!target) {
        return;
    }
    try {
        const filepath = path.isAbsolute(target) ? target : path.join(process.cwd(), target);
        fs.mkdirSync(path.dirname(filepath), { recursive: true });
        const payload = {
            requestedUrls: scope.requestedUrls,
            requestedUrlPostData: scope.requestedUrlPostData,
        };
        fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf8");
        scope.logger.info(`Wrote the intercepted request log to ${filepath}`);
    } catch (err) {
        scope.logger.warn(`Unable to write the request log: ${err.message}`);
    }
});
