const fse = require('fs-extra');
const path = require('path');
const JSZip = require('jszip');

const {ScriptureDocSet} = require('proskomma-render');
const MainEpubDocument = require('./CanonicalDocument');
const GlossaryEpubDocument = require('./GlossaryDocument');
const PeripheralEpubDocument = require('./PeripheralDocument');

class MainDocSet extends ScriptureDocSet {

    constructor(result, context, config) {
        super(result, context, config);
        this.zip = null;
        this.bookTitles = {};
        this.glossaryLemma = null;
        addActions(this);
    }

    modelForDocument(document) {
        const bookCode = document.headers.filter(h => h.key === 'bookCode')[0];
        if (bookCode && bookCode.value === 'GLO') {
            return 'glossary';
        } else if (document.idParts.type === 'periph') {
            return 'peripheral';
        } else {
            return 'default';
        }
    }

    renderDocument(document, renderSpec) {
        if (document.headers.filter(h => h.key === 'bookCode' && this.usedDocuments.includes(h.value)).length === 1) {
            super.renderDocument(document, renderSpec);
        }
    }
}

const addActions = (dsInstance) => {
    const dInstance = new MainEpubDocument(dsInstance.result, dsInstance.context, dsInstance.config);
    const gDInstance = new GlossaryEpubDocument(dsInstance.result, dsInstance.context, dsInstance.config);
    const pDInstance = new PeripheralEpubDocument(dsInstance.result, dsInstance.context, dsInstance.config);
    dsInstance.addDocumentModel('default', dInstance);
    dsInstance.addDocumentModel('glossary', gDInstance);
    dsInstance.addDocumentModel('peripheral', pDInstance);
    dsInstance.addAction(
        'startDocSet',
        () => true,
        (renderer) => {
            const flattenedStructure = a => {
                let ret = [];
                for (const e of a) {
                    if (e[0] === 'section') {
                        ret = [...ret, ...flattenedStructure(e[2])];
                    } else {
                        ret.push(e);
                    }
                }
                return ret;
            }
            renderer.bookTitles = {};
            renderer.usedDocuments = flattenedStructure(renderer.config.structure)
                .map(e => {
                    if (e[0] === 'bookCode') {
                        return e[1];
                    } else if (e[0] === 'image') {
                        return ['image', e[1], e[2]];
                    } else {
                        return renderer.context.docSet.peripherals[e[1]];
                    }
                });
            renderer.zip = new JSZip();
            renderer.zip.file("mimetype", "application/epub+zip");
            renderer.zip.file("META-INF/container.xml", fse.readFileSync(path.resolve(dsInstance.config.codeRoot, 'resources/container.xml')));
            renderer.config.fontManifestEntries = [];
            const fontFaces = [];
            if (dsInstance.config.fonts) {
                const fontMimeType = {
                    'ttf': 'application/x-font-truetype',
                    'otf': 'application/vnd.ms-opentype',
                    'woff': 'application/font-woff',
                    'woff2': 'font/woff2',
                }
                for (const embeddedType of ['body', 'heading']) {
                    if (embeddedType in dsInstance.config.fonts) {
                        const fontDefs = dsInstance.config.fonts[embeddedType];
                        for (const fontVariant of ['regular', 'bold', 'italic', 'boldItalic']) {
                            if (fontVariant in fontDefs) {
                                const fontPath = `FONTS/${fontDefs[fontVariant].name}_${fontVariant}.${fontDefs[fontVariant].format}`;
                                renderer.zip.file(
                                    `OEBPS/${fontPath}`,
                                    fse.readFileSync(path.resolve(dsInstance.config.configRoot, fontDefs[fontVariant].path)));
                                renderer.config.fontManifestEntries.push(
                                    `<item id="font_${fontDefs[fontVariant].name}_${fontVariant}_${fontDefs[fontVariant].format}" href="${fontPath}" media-type="${fontMimeType[fontDefs[fontVariant].format]}" />
                                    `);
                                fontFaces.push(`@font-face {
                                    font-family: '${embeddedType === 'heading' ? 'embeddedHeading' : 'embedded'}';
                                    font-weight: ${fontVariant.includes('bold') ? 'bold' : 'normal'};
                                    font-style: ${fontVariant.includes('talic') ? 'italic' : 'normal'};
                                    src:url(../${fontPath}) format('${fontDefs[fontVariant].format}');
                                }\n`)
                            }
                        }
                    }
                }
            }
            let stylesTemplate = fse.readFileSync(path.resolve(dsInstance.config.codeRoot, 'resources/styles.css'), 'utf8');
            if (fontFaces.length > 0) {
                stylesTemplate = `${fontFaces.join('')}${stylesTemplate}`;
            }
            stylesTemplate = stylesTemplate.replace(/%left%/g, renderer.config.textDirection === 'rtl' ? 'right' : 'left');
            stylesTemplate = stylesTemplate.replace(/%right%/g, renderer.config.textDirection === 'rtl' ? 'left' : 'right');
            renderer.zip.file("OEBPS/CSS/styles.css", stylesTemplate);
            if (dsInstance.config.customCSS) {
                const customStyles = fse.readFileSync(path.resolve(dsInstance.config.configRoot, dsInstance.config.customCSS), 'utf8');
                renderer.zip.file("OEBPS/CSS/custom.css", customStyles);
                renderer.customLink = `<link type="text/css" rel="stylesheet" href="%css_path%/custom.css" />\n`;
            } else {
                renderer.customLink = '';
            }
            const coverImagePath = dsInstance.config.coverImage ?
                path.resolve(dsInstance.config.configRoot, dsInstance.config.coverImage) :
                path.resolve(dsInstance.config.codeRoot, 'resources/cover.png');
            const coverImageSuffix = coverImagePath.split("/").reverse()[0].split(".")[1];
            dsInstance.config.coverImageSuffix = coverImageSuffix;
            renderer.zip.file(`OEBPS/IMG/cover.${coverImageSuffix}`, fse.readFileSync(path.resolve(dsInstance.config.configRoot, coverImagePath)));
        }
    );
    dsInstance.addAction(
        'endDocSet',
        () => true,
        (renderer) => {
            const nestedToc = (records, level) => {
                level = level || 2;
                let ret = [];
                for (const record of records) {
                    if (record[0] === 'image') {
                        continue;
                    }
                    if (record[0] === 'section') {
                        ret.push(`<li>\n<span class="toc_level${level}">${renderer.config.i18n[record[1]] || '???'}</span>\n<ol>\n${nestedToc(record[2], level + 1)}</ol>\n</li>`);
                    } else if (record[0] === 'periph') {
                        const pName = renderer.context.docSet.peripherals[record[1]];
                        if (!(pName in renderer.bookTitles)) {
                            throw new Error(`bookTitle '${pName}' not found for peripheral '${record[1]}'`);
                        }
                        ret.push(`<li class="toc_periph"><a href="XHTML/${pName}/${pName}.xhtml">${renderer.bookTitles[pName][2]}</a></li>`);
                    } else if (record[1] === 'GLO') {
                        ret.push(`<li><a href="XHTML/GLO.xhtml">${renderer.config.i18n.glossary}</a></li>\n`);
                    } else {
                        if (!(record[1] in renderer.bookTitles)) {
                            throw new Error(`bookTitle '${record[1]}' not found for book'`);
                        }
                        ret.push(`<li><a href="XHTML/${record[1]}/${record[1]}.xhtml">${renderer.bookTitles[record[1]][2]}</a></li>`);
                    }
                }
                return ret.join('\n');
            }
            let opf = fse.readFileSync(path.resolve(renderer.config.codeRoot, 'resources/content.opf'), 'utf8');
            opf = opf.replace(/%title%/g, renderer.config.title);
            if ("isbn" in renderer.config) {
                opf = opf.replace(/%uid_or_isbn%/g, 'isbn');
                opf = opf.replace(/%uid_or_isbn_value%/g, `isbn:urn:${renderer.config.isbn}`);
            } else {
                opf = opf.replace(/%uid_or_isbn%/g, 'uid');
                opf = opf.replace(/%uid_or_isbn_value%/g, renderer.config.uid);
            }
            opf = opf.replace(/%uid%/g, renderer.config.uid);
            opf = opf.replace(/%creator%/g, renderer.config.creator || 'proskomma-render-epub');
            opf = opf.replace(/%language%/g, renderer.config.language);
            opf = opf.replace(/%timestamp%/g, new Date().toISOString().replace(/\.\d+Z/g, "Z"));
            opf = opf.replace(/%coverImageSuffix%/g, renderer.config.coverImageSuffix);
            opf = opf.replace(/%coverImageMimetype%/g, renderer.config.coverImageSuffix === "png" ? "image/png" : "image/jpeg");
            opf = opf.replace(/%custom_css%/g, renderer.customLink ? `<item id="customCss" href="CSS/custom.css" media-type="text/css" />` : '');
            let spineContent = renderer.usedDocuments
                .map(b => {
                    if (typeof b === 'string') {
                        return `<itemref idref="body_${b}" />\n`;
                    } else {
                        return `<itemref idref="spineImg_${b[2]}" />\n`
                    }
                }).join("");
            if (renderer.config.bookSources.includes("GLO")) {
                spineContent = spineContent.concat(`<itemref idref="body_glossary_notes" linear="no" />\n`);
            }
            opf = opf.replace(/%spine%/g, spineContent);
            let manifestContent = [
                ...renderer.usedDocuments
                    .filter(d => d !== 'GLO')
                    .map(b => {
                        if (typeof b === 'string') {
                            return `<item id="body_${b}" href="XHTML/${b}/${b}.xhtml" media-type="application/xhtml+xml" />`;
                        } else {
                            const img = fse.readFileSync(path.resolve(renderer.config.configRoot, b[1]));
                            renderer.zip.file(`OEBPS/IMG/${b[1]}`, img);
                            let spineImg = fse.readFileSync(path.resolve(renderer.config.codeRoot, 'resources/img.xhtml'), 'utf8');
                            spineImg = spineImg.replace(/%imgPage%/g, b[2]);
                            spineImg = spineImg.replace(/%filename%/g, b[1]);
                            spineImg = spineImg.replace(/%imgAlt%/g, b[2]);
                            renderer.zip.file(`OEBPS/XHTML/img_${b[2]}.xhtml`, spineImg);
                            return `<item id="spineImg_${b[2]}" href="XHTML/img_${b[2]}.xhtml" media-type="application/xhtml+xml" />\n<item id="img_${b[2]}" href="IMG/${b[1]}" media-type="image/${b[1].split('.')[1]}" />`
                        }
                    }),
                ...renderer.config.fontManifestEntries
            ].join("");
            if (renderer.config.bookSources.includes("GLO")) {
                manifestContent = manifestContent.concat(`<item id="body_GLO" href="XHTML/GLO.xhtml" media-type="application/xhtml+xml" />`);
                manifestContent = manifestContent.concat(`<item id="body_glossary_notes" href="XHTML/glossary_notes.xhtml" media-type="application/xhtml+xml" />`);
            }
            opf = opf.replace(/%book_manifest_items%/g, manifestContent);
            renderer.zip.file("OEBPS/content.opf", opf);
            let title = fse.readFileSync(path.resolve(renderer.config.codeRoot, 'resources/title.xhtml'), 'utf8');
            title = title.replace(/%titlePage%/g, renderer.config.i18n.titlePage);
            title = title.replace(/%copyright%/g, renderer.config.i18n.copyright);
            title = title.replace(/%coverAlt%/g, renderer.config.i18n.coverAlt);
            title = title.replace(/%coverImageSuffix%/g, renderer.config.coverImageSuffix);
            title = title.replace(/%pubIds%/g, renderer.config.pubIds ? renderer.config.pubIds.map(p => '<p class="pub_id">' + p + '</p>\n').join("") : '');
            title = title.replace(/%custom_style%/g, renderer.customLink);
            title = title.replace(/%css_path%/g, '../CSS');
            renderer.zip.file("OEBPS/XHTML/title.xhtml", title);
            let toc = fse.readFileSync(path.resolve(renderer.config.codeRoot, 'resources/toc.xhtml'), 'utf8');
            toc = toc.replace(/%contentLinks%/g, nestedToc(renderer.config.structure));
            toc = toc.replace(/%toc_books%/g, renderer.config.i18n.tocBooks);
            toc = toc.replace(/%custom_style%/g, renderer.customLink);
            toc = toc.replace(/%css_path%/g, 'CSS');
            renderer.zip.file("OEBPS/toc.xhtml", toc);
            renderer.zip.generateNodeStream({type: "nodebuffer", streamFiles: true})
                .pipe(fse.createWriteStream(renderer.config.outputPath));
        }
    );
}

module.exports = MainDocSet;
