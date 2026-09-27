/**
 * advisor.FundDetail.js
 *
 * Step definitions for features/advisorfeatures/advisor.FundDetail.feature.
 *
 * The baseline shipped this file as advisor.FundDetail.ts: a TypeScript file
 * importing @badeball/cypress-cucumber-preprocessor (a Cypress preprocessor,
 * not Puppeteer) whose every step body was an empty stub, and which Cucumber
 * never even loaded because its default step glob only matches .js. So the
 * whole suite silently reported every step as undefined.
 *
 * Steps are registered against the site/page/provider selected in the
 * Background, which keeps the feature files free of plumbing.
 */

const { Given, When, Then } = require("@cucumber/cucumber");

const scope = require("../support/scope");
const common = require("../support/common");
const analytics = require("../support/analyticsproviders");

/**
 * Resolves the site a navigation step should act on, failing with an
 * actionable message rather than silently navigating somewhere unexpected.
 * @param {string} [site] an explicit site, if the step supplied one
 * @returns {string}
 */
function iResolveSite(site) {
    const resolved = site || scope.defaultsite;
    if (!resolved) {
        throw new Error(
            'No site was selected. Add a `Given Set the default to "<site>" site` step to the Background first.'
        );
    }
    return resolved;
}

Given('Set the default to {string} site', function (site) {
    // A site is only usable once its page objects have been loaded; fail here
    // rather than part way through a navigation.
    if (!scope.sites[site]) {
        throw new Error(
            `Site "${site}" is not defined. Add it under environment.urlFragments in the environment config ` +
            `(currently: ${JSON.stringify(Object.keys(scope.configuration.environment.urlFragments || {}))}).`
        );
    }
    scope.defaultsite = site;
    scope.logger.info(`Default site set to "${site}".`);
});

Given('Set the default analytics provider to {string}', function (provider) {
    scope.defaultprovider = provider;
    // Resolving now surfaces a bad provider config at setup time rather than
    // three steps later inside an assertion.
    const resolved = analytics.iGetProviderConfig(provider);
    scope.logger.info(
        `Default analytics provider set to "${provider}" (urlmatches: ${JSON.stringify(resolved.urlmatches)}).`
    );
});

When('I navigate to the {string} page', async function (pageName) {
    const site = iResolveSite();
    await common.iNavigateAsync(site, pageName);
});

When('I navigate to the {string} site {string} page', async function (site, pageName) {
    await common.iNavigateAsync(iResolveSite(site), pageName);
});

// Only {int} is registered: cucumber's {int} and {float} both match a plain
// "5", so declaring both makes the step ambiguous.
Given('I wait for {int} seconds', async function (seconds) {
    scope.logger.info(`Waiting for ${seconds} second(s).`);
    await common.iDelayAsync(Number(seconds) * 1000);
});

When('I wait for the {string} locator on the {string} page', async function (locator, pageName) {
    await common.iWaitForElementAsync(iResolveSite(), pageName, locator);
});

Then('Analytics should be triggered', function () {
    analytics.iAssertAnalyticsTriggered();
});

Then('{string} Provider should be triggered {int} time', function (provider, expected) {
    analytics.iAssertProviderTriggeredTimes(provider, Number(expected));
});

Then('{string} Provider should be triggered {int} times', function (provider, expected) {
    analytics.iAssertProviderTriggeredTimes(provider, Number(expected));
});

Then('Provider should have {string} key and {string} value', function (key, value) {
    const provider = scope.defaultprovider;
    if (!provider) {
        throw new Error(
            'No analytics provider was selected. Add a `Given Set the default analytics provider to "<provider>"` step to the Background first.'
        );
    }
    analytics.iAssertProviderHasValue(provider, key, value);
});

Then('Provider should have values', function (dataTable) {
    const provider = scope.defaultprovider;
    if (!provider) {
        throw new Error(
            'No analytics provider was selected. Add a `Given Set the default analytics provider to "<provider>"` step to the Background first.'
        );
    }
    if (!dataTable || !dataTable.hashes) {
        throw new Error("`Provider should have values` needs a data table of `key | value` rows.");
    }
    const rows = dataTable.hashes();
    const skipped = [];
    for (const row of rows) {
        // Tolerate a blank placeholder row rather than asserting on "".
        if (!row.key && !row.value) {
            skipped.push(row);
            continue;
        }
        if (!row.key) {
            throw new Error(`Data table row ${JSON.stringify(row)} has a value but no key.`);
        }
        analytics.iAssertProviderHasValue(provider, row.key, row.value === undefined ? "" : row.value);
    }
    if (skipped.length) {
        scope.logger.warn(
            `Ignored ${skipped.length} empty data table row(s); a step must assert on something.`
        );
    }
});
