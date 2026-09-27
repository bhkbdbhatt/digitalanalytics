class ElementNotFoundError extends Error {
    /**
     * @param {string} searchedby - description of the locator that was searched
     * @param {string} [customMessage] - extra context appended to the message
     */
    constructor(searchedby, customMessage = "") {
        const message = `Unable to find element using(${searchedby}). ${customMessage}`.trim();
        super(message);
        this.name = "ElementNotFoundError";
        this.searchedBy = searchedby;
    }
}
// The baseline read `module.exports.ElementNotFoundError;` which exported nothing
// (require() returned `{}`), so `new ElementNotFoundError(...)` threw
// "not a constructor". Export both shapes so either import style works.
module.exports = ElementNotFoundError;
module.exports.ElementNotFoundError = ElementNotFoundError;