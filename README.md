# proskomma-render-epub
Scripture ePub generator based on proskomma-render

## Example Sources

[unfoldingWord Literal Text](https://www.unfoldingword.org/ult) (Psalms and Gospels)

## To set up

You will need Node and NPM.
```
cd proskomma-render-epub
npm install
npm test # Currently not in Windows
```
## To make an epub

```
node ./make_epub.js config/config_ult.json ~/Desktop/ult_demo.epub
```
