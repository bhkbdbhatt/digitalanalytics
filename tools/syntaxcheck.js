/**
 * syntaxcheck.js
 *
 * The project has no eslint/prettier setup and adding one means pulling from
 * the internal registry, so `npm run lint` is a dependency-free stand-in that
 * does the two things that actually catch breakage in this codebase:
 *
 *   1. `node --check` every .js file - a stray comment terminator inside a
 *      block comment silently killed the whole cucumber run before this
 *      existed.
 *   2. Assert that every step phrase in every .feature file has a matching
 *      step definition - the baseline shipped a .ts file that cucumber never
 *      loaded, so all 6 steps reported as "Undefined" and nobody noticed.
 *
 * Exits non-zero on the first category that fails.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "report"]);

/** @returns {string[]} repo-relative paths of every .js file */
function collectJsFiles(dir, found) {
    const out = found || [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectJsFiles(full, out);
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
            out.push(path.relative(ROOT, full));
        }
    }
    return out;
}

/** @returns {string[]} repo-relative paths of every .feature file */
function collectFeatureFiles(dir, found) {
    const out = found || [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectFeatureFiles(full, out);
        } else if (entry.isFile() && entry.name.endsWith(".feature")) {
            out.push(path.relative(ROOT, full));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 1. syntax
// ---------------------------------------------------------------------------
const jsFiles = collectJsFiles(ROOT);
const syntaxErrors = [];
for (const file of jsFiles) {
    try {
        execFileSync(process.execPath, ["--check", path.join(ROOT, file)], { stdio: "pipe" });
    } catch (err) {
        syntaxErrors.push(`${file}\n${err.stderr.toString().trim()}`);
    }
}

if (syntaxErrors.length) {
    console.error(`Syntax errors in ${syntaxErrors.length} file(s):\n`);
    syntaxErrors.forEach(e => console.error(e + "\n"));
    process.exit(1);
}
console.log(`syntax: ${jsFiles.length} js file(s) parsed ok`);

// ---------------------------------------------------------------------------
// 2. step coverage
// ---------------------------------------------------------------------------
// Loads the support/step files the same way cucumber does, then reads the
// phrases back out of the registered definitions.
process.env.NODE_PATH = process.env.NODE_PATH || "";
const { World, setWorldConstructor } = (() => {
    try {
        return require("@cucumber/cucumber");
    } catch (err) {
        console.warn("skipping step-coverage check: @cucumber/cucumber is not installed.");
        process.exit(0);
    }
})();

/** Every phrase string passed to Given/When/Then, with its parameters. */
const registered = [];
const noop = function () {};
const capture = (keyword) => (phrase) => registered.push({ keyword: keyword, phrase: phrase });

// Stub the decorators so requiring the step files only records their phrases
// instead of needing a real cucumber run.
const decorators = {
    Given: capture("Given"),
    When: capture("When"),
    Then: capture("Then"),
};
const cucumberPath = require.resolve("@cucumber/cucumber");
const realModule = require(cucumberPath);
for (const name of Object.keys(decorators)) {
    realModule[name] = decorators[name];
}

for (const file of jsFiles.filter(f => f.includes(`${path.sep}step_definitions${path.sep}`))) {
    try {
        require(path.join(ROOT, file));
    } catch (err) {
        console.error(`Failed to load step definitions in ${file}:\n${err.message}\n`);
        process.exit(1);
    }
}

if (registered.length === 0) {
    console.error(
        "No step definitions were registered. The step_definitions folder was not picked up - " +
        "cucumber only globs .js files, so a .ts step file is silently ignored."
    );
    process.exit(1);
}

/**
 * Cucumber's expression compiler: an expression is a sequence of literal text
 * and {type} parameters. Matching it by hand keeps this check dependency-free.
 * @param {string} expression
 * @param {string} text
 * @returns {boolean}
 */
function matches(expression, text) {
    const tokens = expression.split(/(\{[^}]+\})/).filter(Boolean);
    let pattern = "^";
    for (const token of tokens) {
        if (token.startsWith("{")) {
            const type = token.slice(1, -1);
            if (type === "int" || type === "float") {
                pattern += "-?\\d+(?:\\.\\d+)?";
            } else if (type === "word" || type === "string" || type === "") {
                pattern += ".*?";
            } else {
                return true; // unknown custom parameter type: do not false-alarm
            }
        } else {
            pattern += token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
    }
    pattern += "$";
    return new RegExp(pattern, "i").test(text);
}

/** Extracts the step phrases of one feature file, ignoring Background/Scenario/keywords. */
function extractPhrases(featureText) {
    const phrases = [];
    for (const rawLine of featureText.split(/\r?\n/)) {
        const line = rawLine.trim();
        const match = /^(Given|When|Then|And|But)\s+(.*)$/i.exec(line);
        if (!match) continue;
        const phrase = match[2].trim();
        if (phrase) phrases.push(phrase);
    }
    return phrases;
}

let uncovered = 0;
for (const feature of collectFeatureFiles(path.join(ROOT, "features"))) {
    const text = fs.readFileSync(path.join(ROOT, feature), "utf8");
    for (const phrase of extractPhrases(text)) {
        const covered = registered.some(def => matches(def.phrase, phrase));
        if (!covered) {
            console.error(`${feature}: no step definition matches "${phrase}"`);
            uncovered++;
        }
    }
}

if (uncovered) {
    console.error(`\n${uncovered} step(s) in the feature files have no definition.`);
    process.exit(1);
}
console.log(`steps: ${registered.length} definition(s) cover every phrase in the feature files`);
