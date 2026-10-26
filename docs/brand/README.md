# Splatno — aktuální značka

Jediným aktuálním znakem produktu je zelená stuha ve tvaru S: horní část `#1F5E43`, střed `#B9DBA0`, spodní část `#12372A`. Název se píše `splatno`. Žluté, modré a starší dokumentové varianty se nepoužívají a byly odstraněny z veřejných souborů.

## Jediný zdroj a výstupy

- `public/brand/splatno-mark.svg` — hlavní vektorový zdroj, průhledné pozadí, poměr 100 : 134.
- `public/brand/splatno-mark.png` — stejný znak na průhledném čtvercovém plátně pro původní rastrové adresy.
- `public/brand/splatno-auth-mark.png` — stejný znak v přirozeném poměru pro e-maily a PDF.
- `public/brand/splatno-email-avatar.svg` a `.png` — stejný znak na bílém čtverci pro profil odesílatele.
- `public/brand/splatno-favicon.svg`, `public/icon.png`, `public/apple-icon.png`, `public/favicon.ico` — ikony prohlížeče a zařízení se stejným znakem.

Všechny rastrové varianty, avatar i ikony se obnovují příkazem `node scripts/generate-favicons.mjs` z hlavního SVG. Nevytvářet další samostatné barevné návrhy v `public/brand`. Inline komponenta `RibbonMark` používá stejnou geometrii a barvy pro web a Open Graph obrázky.

## Použití

Zachovávat poměr stran a celý znak, bez deformace a ořezu. Značka Splatna je oddělená od vlastních log firem: nahraná firemní loga zůstávají na jejich dokumentech a v komunikaci; pokud vlastní logo není dostupné, používá se tento nový znak Splatna.

Ve fakturačních a upomínkových e-mailech je výchozí logo vložené přímo přes CID; není závislé na dostupnosti nebo cache veřejného obrázku. Stejný znak používají přihlašovací kódy, pozvánky, obnova hesla, náhledy faktur a PDF/reporty.

Podklady profilové fotografie samy neaktivují zobrazení avataru ve schránce. Nastavení odesílací domény a případného certifikátu je popsáno v [profilovém obrázku odesílatele](../email-sender-avatar.md).
