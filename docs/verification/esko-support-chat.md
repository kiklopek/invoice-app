# Esko jako neblokující chat

25. 10. 2026 – podle navazujícího požadavku uživatele nahrazuje předchozí modální chování.

- Navigace i záhlaví používají pouze název Esko.
- Chat se otevírá vpravo dole, maximálně 380 × 560 px a nejvýše na 75 % výšky viditelného viewportu. Na mobilu zachovává bezpečný okraj alespoň 8 px, na desktopu 16 px. Položka Esko v desktopovém menu má zvětšeného maskota 48 × 42 px a vodorovně vycentrovaný text.
- Společná komponenta Modal má volitelný modeless režim: nativní dialog.show(), portál do body, bez backdropu a bez blokování stránky. Ostatní modální okna nadále používají showModal().
- Výchozí čtyři otázky lze rozšířit tlačítkem Další otázky. Historie se posouvá uvnitř; zavření a vstup zůstávají dostupné i při zmenšení visualViewport pro klávesnici.
- Zachováno načítání až při otevření, oprávnění, historie, rozepsaná zpráva, návrat fokusu a Escape. Otevření mobilní navigace chat zavře se zachováním jeho obsahu.

Ověření: 31 testů ve třech souborech, lint a typecheck. Chromium/WebKit ověřují všechny role při 320, 390 a 1440 px, umístění, rozměry, neblokované kliknutí na stránku, chybový stav, opětovné otevření a simulovaný viewport klávesnice. Screenshoty jsou samostatně v docs/design-audit/2026-10-25/support-chat. Bez nasazení.
