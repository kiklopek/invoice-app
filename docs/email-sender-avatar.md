# Profilový obrázek odesílatele Splatno

Připravené soubory:

- `public/brand/splatno-email-avatar.svg`: čtvercové logo 512 × 512, plné bílé
  pozadí, stávající znak Splatno, profil SVG Tiny PS pro předložení certifikační autoritě.
- `public/brand/splatno-email-avatar.png`: stejný obrázek pro nastavení profilové
  fotografie v poštovním účtu.

Toto jsou podklady, nikoli aktivované zobrazení profilovky příjemcům. Logo uvnitř
HTML zprávy ani CID příloha neurčují avatar v seznamu doručených zpráv.

## Současná konfigurace (kontrola 15. 10. 2026)

Lokální konfigurace používá `prihlaseni@mail.splatno.cz` pro přihlášení/registraci
a `upominky@mail.splatno.cz` pro upomínky. Profil odesílatele se proto nastavuje
pro odesílací doménu `mail.splatno.cz`; nezávisí na tom, zda uživatel otevřel web
na `.cz` nebo `.com`.

Ve veřejném DNS nebyly nalezeny TXT záznamy `_dmarc.mail.splatno.cz`,
`_dmarc.splatno.cz` ani `default._bimi.mail.splatno.cz`. Kontrola proběhla přes
systémový resolver a Google Public DNS. Před změnou ověřit aktuální produkční
adresy odesílatele a všechny služby odesílající za doménu.

## Dokončení nastavení BIMI

1. Zkontrolovat SPF, DKIM a DMARC alignment pro skutečné zprávy z Resendu.
2. Nastavit DMARC v režimu `p=quarantine` nebo `p=reject`, `pct=100`. Zpřísnění
   může ovlivnit neověřené odesílatele; nejdřív zkontrolovat používané služby.
3. Získat VMC nebo CMC od certifikační autority. Pro Gmail je certifikát potřebný;
   samotný SVG soubor nestačí. Logo předložit autoritě a respektovat její validaci.
4. Po nasazení aplikace zveřejnit logo přes HTTPS a doplnit skutečný vydaný PEM
   certifikát. Certifikát se nevyrábí v aplikaci ani se nenahrazuje zástupným souborem.
5. Publikovat BIMI TXT záznam `default._bimi.mail.splatno.cz`. Pro certifikát
   obsahující logo uvádí Google tvar `v=BIMI1;l=;a=<HTTPS URL skutečného PEM>`.
   Varianta se samostatným SVG může obsahovat také
   `l=https://splatno.cz/brand/splatno-email-avatar.svg` podle požadavků autority.
6. Ověřit DNS, HTTPS, řetězec certifikátu a doručenou zprávu v podporovaných klientech.
   Zobrazení nadále řídí poskytovatel schránky; Google uvádí po publikaci až 48 hodin.

Současnou poštu aplikace tento přípravný krok nemění. Nejsou publikovány DNS
záznamy odkazující na nenasazené soubory ani upravena doručitelnost zpráv.

Zdroje: [Google – Set up BIMI](https://knowledge.workspace.google.com/admin/security/set-up-bimi?hl=en),
[BIMI Group – SVG logo](https://bimigroup.org/creating-bimi-svg-logo-files/),
[Resend – vysvětlení loga v dashboardu a BIMI](https://resend.com/legal/terms-of-service#third-party-trademarks).
