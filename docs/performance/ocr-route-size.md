# Velikost balíku OCR routy

Měřeno 22. 9. 2026 na `main`, produkční build (`pnpm build`), macOS arm64.

Plán dokončení nechal konsolidaci PDF/OCR stacku mimo scope s tím, že se
v F8 **jen změří a zdokumentuje**, a rozhodne se až podle produkčních dat.
Tohle je to měření.

## Zjištění

`/api/invoices/extract` je **69 MB**. Druhá největší routa má 3,5 MB.

| MB | balíček | k čemu je |
|---:|---|---|
| 25,8 | `@napi-rs/canvas` | rasterizace stránek PDF na obrázek pro OCR (předává se do `renderPageAsImage` z unpdf) |
| 17,3 | `@img/sharp-libvips` | předzpracování bitmapy před OCR (`invoice-ocr-server.ts`) |
| 10,4 | `@tesseract.js-data/eng` | anglický jazykový model |
| 6,8 | `@tesseract.js-data/ces` | český jazykový model |
| 3,3 | `pdfjs-dist` | čtení PDF; navíc dodává fonty pro generování faktur |
| 2,0 | vlastní kód + Next | |

Zbytek rout se drží do 3,5 MB, takže jde o ojedinělý případ, ne o plošný
problém. Dopad je na cold start téhle jediné routy.

## Reprodukce měření

```bash
pnpm build
# součet velikostí souborů z .next/server/app/**/route.js.nft.json
```

Pozor: nativní binárky se stahují podle platformy. Na macOS je to
`darwin-arm64`, na Vercelu `linux-x64` — absolutní čísla se budou lišit,
poměry ne.

## Co se nabízí a proč se to zatím nedělá

**Vyhodit anglický jazykový model (−10,4 MB, 15 %).** Worker se vytváří jako
`createWorker(["ces", "eng"])`. Aplikace je výhradně česká, takže angličtina
vypadá zbytečně. **Neověřitelné bez dat:** OCR čte z faktur částky a
identifikátory, a v repu nejsou žádné testovací faktury, na kterých by šlo
porovnat přesnost s angličtinou a bez ní. Odebrat jazykový model naslepo
znamená riskovat horší čtení částek kvůli místu na disku — to je špatný obchod.

Než se to udělá, je potřeba: sada reálných faktur jako fixtury a srovnání
přesnosti čtení klíčových polí (částka, VS, IČO, datum) v obou variantách.

**Sloučit `@napi-rs/canvas` a `sharp` (−17 až −26 MB).** Obě dělají práci
s obrázky, ale jinou: canvas vykresluje stránku PDF, sharp upravuje výslednou
bitmapu. Zaměnitelné nejsou (sharp PDF nerenderuje), takže by to znamenalo
přepsat celý předzpracovávací řetězec OCR — vysoké riziko regrese v nejcitlivější
funkci aplikace za úsporu cold startu jedné routy.

## Závěr

Žádný z kandidátů není dnes bezpečně proveditelný. Měření je tu proto, aby se
příště nezačínalo od dohadů a aby bylo vidět, že 75 % té velikosti tvoří dvě
nativní knihovny a dva jazykové modely, ne aplikační kód.
