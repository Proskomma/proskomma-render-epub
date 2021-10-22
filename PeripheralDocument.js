const { ScriptureParaDocument } = require('proskomma-render');
const sharedActions = require('./shared_actions');

class PeripheralDocument extends ScriptureParaDocument {

    constructor(result, context, config) {
        super(result, context, config);
        this.head = [];
        this.bodyHead = [];
        this.body = [];
        this.footnotes = {};
        this.nextFootnote = 1;
        this.glossaryLemma = null;
        addActions(this);
    }

    renderStartItems(items) {
        this.applyClassActions(this.allActions.startItems, items);
    };

}

const addActions = (dInstance) => {
    // Initialize headers (not including title) and other state
    dInstance.addAction(
        'startDocument',
        () => true,
        (renderer, context) => {
            let cssPath = "../../CSS/styles.css";
            dInstance.head = [
                '<meta charset=\"utf-8\"/>\n',
                `<link type="text/css" rel="stylesheet" href="${cssPath}" />\n`,
                `<title>${context.document.headers.h}</title>`,
            ];
            dInstance.body = [];
            dInstance.bodyHead = [];
            dInstance.footnotes = {};
            dInstance.nextFootnote = 1;
            const periphTitle = context.document.idParts[3];
            dInstance.docSetModel.bookTitles[context.document.headers.bookCode] = [
                periphTitle,
                periphTitle,
                periphTitle,
                periphTitle,
            ];
            dInstance.context.document.chapters = [];
        }
    );
    // Follow some block grafts to secondary content
    dInstance.addAction(
        'blockGraft',
        context => ["title", "heading", "introduction"].includes(context.sequenceStack[0].blockGraft.subType),
        (renderer, context, data) => {
            renderer.renderSequenceId(data.payload);
        }
    );
    // Start new stack row for new block
    dInstance.addAction(...sharedActions.startBlock);
    // Render title block
    dInstance.addAction(
        'endBlock',
        context => context.sequenceStack[0].type === "title",
        (renderer, context, data) => {
            const htmlClass = data.bs.payload.split('/')[1];
            const tag = ["mt", "ms"].includes(htmlClass) ? "h1" : "h2";
            renderer.bodyHead.push(`<${tag} class="${htmlClass}">${renderer.topStackRow().join("").trim()}</${tag}>\n`);
            renderer.popStackRow();
        },
    );
    // Render heading block
    dInstance.addAction(
        'endBlock',
        context => context.sequenceStack[0].type === "heading",
        (renderer, context, data) => {
            const htmlClass = data.bs.payload.split("/")[1];
            let headingTag;
            switch (htmlClass) {
                case "s":
                case "is":
                    headingTag = "h3";
                    break;
                default:
                    headingTag = "h4";
            }
            renderer.body.push(`<${headingTag} class="${htmlClass}">${renderer.topStackRow().join("").trim()}</${headingTag}>\n`);
            renderer.popStackRow();
        },
    );
    // add footnote to lookup (apparently handling multi-block footnotes?)
    dInstance.addAction(
        'endBlock',
        context => context.sequenceStack[0].type === "footnote",
        renderer => {
            const footnoteKey = renderer.nextFootnote.toString();
            if (!(footnoteKey in dInstance.footnotes)) {
                dInstance.footnotes[footnoteKey] = [];
            }
            dInstance.footnotes[footnoteKey] = dInstance.footnotes[footnoteKey].concat(renderer.topStackRow());
        },
    );
    // Render main or introduction block in a div with class derived from the block scope
    dInstance.addAction(
        'endBlock',
        context => ["main", "introduction"].includes(context.sequenceStack[0].type),
        (renderer, context, data) => {
            const htmlClass = data.bs.payload.split("/")[1];
            renderer.body.push(`<div class="${htmlClass}">${renderer.topStackRow().join("").trim()}</div>\n`);
            renderer.popStackRow();
        },
    );
    // A glossary word lemma: store the lemma for later
    dInstance.addAction(
        'scope',
        (context, data) => data.payload.startsWith("attribute/spanWithAtts/w/lemma"),
        (renderer, context, data) => {
            renderer.glossaryLemma = data.payload.split("/")[5];
        }
    );
    // Character markup - open or close an element
    dInstance.addAction(...sharedActions.characterScope);
    // Cell - fixed width
    dInstance.addAction(...sharedActions.cell);
    // A glossary word: use glossaryLemma to catch lemma after start with a separate action, then use value to produce glossary link
    dInstance.addAction(
        'scope',
        (context, data) => data.payload === "spanWithAtts/w",
        (renderer, context, data) => {
            if (data.subType === "start") {
                renderer.pushStackRow();
                renderer.glossaryLemma = null;
            } else {
                const spanContent = renderer.topStackRow().join("");
                const spanKey = renderer.glossaryLemma || spanContent;
                renderer.popStackRow();
                renderer.topStackRow().push(spanContent);
                const glossaryN = renderer.config.glossaryTerms[spanKey];
                if (glossaryN) {
                    renderer.topStackRow().push(`<a epub:type="noteref" class="glossaryLink" href="../glossary_notes.xhtml#glo_${renderer.config.glossaryNToAside[glossaryN]}">*</a>`);
                }
            }
        }
    );
    // Unhandled scope
    dInstance.addAction(...sharedActions.unhandledScope);
    // Tokens, including attempt to add French spaces and half-spaces after punctuation
    dInstance.addAction(
        'token',
        () => true,
        (renderer, context, data) => {
            let tokenString;
            if (["lineSpace", "eol"].includes(data.subType)) {
                tokenString = " ";
            } else {
                if (renderer.config.frenchSpacing === 'change') {
                    if ([";", "!", "?"].includes(data.payload)) {
                        if (renderer.topStackRow().length > 0) {
                            let lastPushed = renderer.topStackRow().pop();
                            lastPushed = lastPushed.replace(/ $/, "&#8239;");
                            renderer.appendToTopStackRow(lastPushed);
                        }
                        tokenString = data.payload;
                    } else if ([":", "»"].includes(data.payload)) {
                        if (renderer.topStackRow().length > 0) {
                            let lastPushed = renderer.topStackRow().pop();
                            lastPushed = lastPushed.replace(/ $/, "&#160;");
                            renderer.appendToTopStackRow(lastPushed);
                        }
                        tokenString = data.payload;
                    }
                } else if (renderer.config.frenchSpacing === 'add') {
                    if ([";", "!", "?"].includes(data.payload)) {
                        tokenString = "&#8239;" + data.payload;
                    } else if ([":", "»"].includes(data.payload)) {
                        tokenString = "&#160;" + data.payload;
                    } else if (data.payload === '«') {
                        tokenString = data.payload + "&#160;";
                    } else {
                        tokenString = data.payload;
                    }
                } else {
                    tokenString = data.payload.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                }
            }
            return renderer.appendToTopStackRow(tokenString);
        }
    ),
        // Add footnote link, then process the footnote sequence
        dInstance.addAction(
            'inlineGraft',
            (context, data) => data.subType === "footnote",
            (renderer, context, data) => {
                renderer.appendToTopStackRow(`<a epub:type="noteref" id="footnote_anchor_${renderer.nextFootnote}" href="#footnote_${renderer.nextFootnote}" class="footnote_anchor"><sup>${renderer.nextFootnote}</sup></a>`);
                renderer.renderSequenceId(data.payload);
                renderer.nextFootnote++;
            }
        );
    // Generate document HTML
    dInstance.addAction(
        'endSequence',
        context => context.sequenceStack[0].type === "main",
        (renderer, context) => {
            let bodyHead = renderer.bodyHead.join("");
            let textDirection = renderer.config.textDirection || 'ltr';
            if (renderer.config.reversedPeriphs.includes(context.document.headers.bookCode)) {
                textDirection = textDirection === 'ltr' ? 'rtl' : 'ltr';
            }
            renderer.docSetModel.zip
                .file(
                    `OEBPS/XHTML/${context.document.headers.bookCode}/${context.document.headers.bookCode}.xhtml`,
                    [
                        `<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" dir="${textDirection}">\n<head>\n${renderer.head.join("")}\n</head>\n`,
                        '<body id="top">\n',
                        `<header>\n${bodyHead}\n</header>\n`,
                        `<section epub:type="bodymatter">\n`,
                        renderer.body.join(""),
                        `\n</section>\n`,
                        Object.entries(renderer.footnotes)
                            .map(fe =>
                                `<aside epub:type="footnote" id="footnote_${fe[0]}" class="footnote_number"><p>${fe[1].join("")}</p></aside>\n`)
                            .join(""),
                        '</body>\n</html>\n'
                    ].join("")
                );
        }
    );
};

module.exports = PeripheralDocument;
