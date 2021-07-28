const sharedActions = {
    // Character markup - open or close an element
    characterScope: [
        'scope',
        (context, data) => data.payload.startsWith("span") && ["add", "bd", "bk", "dc", "em", "fdc", "ft", "fq", "fqa", "fr", "fv", "it", "k", "ord", "pn", "qs", "sc", "qt", "sls", "tl", "wj", "xt"].includes(data.payload.split("/")[1]),
        (renderer, context, data) => {
            if (data.subType === "start") {
                renderer.pushStackRow();
            } else {
                const spanContent = renderer.topStackRow().join("");
                renderer.popStackRow();
                renderer.topStackRow().push(`<span class="${data.payload.split("/")[1]}">${spanContent}</span>`);
            }
        }
    ],
    cell: [
        'scope',
        (context, data) => data.payload.startsWith("cell/"),
        (renderer, context, data) => {
            if (data.subType === "start") {
                renderer.pushStackRow();
            } else {
                const spanContent = renderer.topStackRow().join("");
                renderer.popStackRow();
                renderer.topStackRow().push(`<span class="${data.payload.split("/")[1] === 'colHeading' ? 'cellHeading' : 'cell'}${data.payload.split("/")[2] === 'left' ? 'Left' : 'Right'}">${spanContent}</span>`);
            }
        }
    ],
    startBlock: [
        'startBlock',
        () => true,
        renderer => renderer.pushStackRow(),
    ],
    unhandledScope: [
        'scope',
        (context, data) => data.payload.startsWith("span"),
        (renderer, context, data) => {
            if (data.subType === "start") {
                renderer.docSetModel.writeLogEntry(
                    'Warning',
                    `Unhandled span '${data.payload}'`,
                    renderer.key,
                )
            }
        }
    ],
    token: [
        'token',
        () => true,
        (renderer, context, data) => {
            let tokenString;
            if (["lineSpace", "eol"].includes(data.subType)) {
                tokenString = " ";
            } else {
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
                } else {
                    tokenString = data.payload.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                }
            }
            return renderer.appendToTopStackRow(tokenString);
        }
    ],
};

module.exports = sharedActions;
