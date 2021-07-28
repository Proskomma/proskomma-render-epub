const {
    ScriptureDocSet,
    ScriptureParaDocument
} = require('proskomma-render');

class GlossaryScanDocSet extends ScriptureDocSet {

    constructor(result, context, config) {
        super(result, context, config);
        this.config.glossaryTerms = {};
        this.inK = false;
        addActions(this);
    }
}

const addActions = (dsInstance) => {
    const dInstance = new ScriptureParaDocument(dsInstance.result, dsInstance.context, dsInstance.config);
    dsInstance.addDocumentModel('default', dInstance);
    dInstance.addAction(
        'scope',
        (context, data) => context.document.headers.bookCode === "GLO" && data.payload === "span/k",
        (renderer, context, data) => {
            if (data.subType === "start") {
                renderer.pushStackRow();
                context.inK = true;
            } else {
                const kContent = renderer.popStackRow().join("").trim();
                if (kContent in renderer.config.glossaryTerms) {
                    renderer.writeLogEntry(
                        'WARNING',
                        `k value '${kContent}' used more than once`,
                    );
                } else {
                    renderer.config.glossaryTerms[kContent] = Object.keys(renderer.config.glossaryTerms).length + 1;
                }
                context.inK = false;
            }
        }
    );
    dInstance.addAction(
        'token',
        context => context.inK,
        (renderer, context, data) => {
            const tokenString = data.payload.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return renderer.appendToTopStackRow(tokenString);
        }
    );
}
module.exports = GlossaryScanDocSet;
