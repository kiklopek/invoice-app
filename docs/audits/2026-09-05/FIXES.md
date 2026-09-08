# Cílené opravy po auditu

Opravené nálezy:

- **F01:** rozepsaná faktura se při klientském návratu Zpět zachová v paměti dané karty a po návratu do formuláře se obnoví. Nejde o nový zásah do historie prohlížeče. Výslovné zahození přes potvrzovací dialog a úspěšné uložení koncept odstraní. Koncepty se neukládají na disk; reload/odhlášení paměť odstraní, ochrana před zavřením neuloženého formuláře zůstává.
- **F02:** detail nepřepisuje globální počet faktur hodnotou 1. Při přímém otevření detailu bez předchozího načtení agregace se neukazuje vymyšlený počet.
- **F03:** Escape zavře platební potvrzení v seznamu i detailu, pokud právě neprobíhá uložení. Ostatní chování dialogů se nemění.
- **F04:** neprodukční server akceptuje aliasy loopback hostu při shodném protokolu a portu. Produkční origin kontrola zůstává přesná; cizí doména, jiný port/protokol a neplatný Origin se stále odmítají.
- **R06:** selektor testu navigace rozlišuje položku menu od loga.
- **R08:** potvrzený odchod přes interní odkaz používá klientskou navigaci, takže společný zelený sloupec zůstává připojený.

Ověření:

- TypeScript prošel.
- ESLint všech změněných implementačních souborů a testů prošel.
- 27 cílených testů v 6 souborech prošlo, včetně produkčního odmítnutí loopback aliasu a práce s koncepty.
- 6 prohlížečových testů prošlo: 3 nové regresní scénáře a 3 stávající smoke testy. Jeden mobilní test byl výslovně přeskočen v desktopovém běhu; není počítán jako úspěch.
- První běh testu detailu potřeboval doplnit čekání na dokončenou navigaci; po úpravě testu prošel samostatný opakovaný běh. Nešlo o nové selhání aplikace. Logy: `fixes-browser.log`, `fixes-browser-detail.log`.
- Zkoušeno na izolované kopii bez produkčních dat, přes `127.0.0.1:3100`. Žádné skutečné platby nebo e-maily nebyly odeslány.

Otevřené zůstávají ostatní bezpečnostní/konfigurační nálezy a integrační kontroly uvedené v původním auditu. Zejména nebyly měněny RLS, MFA, přihlašovací tajné údaje ani nastavení Supabase. Pro tyto změny dosud není k dispozici potvrzený staging s testovacími účty.
