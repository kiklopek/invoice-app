# Kontroly údajů v onboardingu

Formulář a API používají společné validátory. Nepovinná prázdná pole jsou platná;
vyplněná pole se kontrolují při opuštění pole, při pokračování a na serveru.
Chyba vrácená serverem otevře odpovídající krok a zaměří příslušné pole.

| Údaj | Kontrola |
| --- | --- |
| IČO | 8 číslic, kontrolní číslice, existence v ARES. Duplicitní IČO ve Splatnu odmítá databázové založení firmy. |
| Název | Povinný, 2–240 znaků, bez řídicích znaků. ARES předvyplní oficiální název. |
| DIČ | Nepovinné; povinné při volbě plátce DPH. Formát CZ a 8–10 číslic. |
| Sídlo | Povinné; nejvýš 300 znaků, text a číslo domu. ARES předvyplní adresu. |
| Provozovna | Stejná základní kontrola adresy; lze nechat prázdnou. |
| Telefon | České 9místné číslo nebo mezinárodní zápis s předvolbou; povolené mezery a běžné oddělovače. |
| Datová schránka | Přesně 7 písmen nebo číslic. |
| Kontaktní e-mail, odpovědi, kopie, pozvánky | Společný formát e-mailu a délkové limity; kopie nejvýš 5 adres. Pozvánky navíc odmítají vlastní a opakovanou adresu. |
| CZK účet | Povinný český tvar, délky částí, kontrolní číslice předčíslí a základu, nenulový základ. |
| EUR účet | Nepovinný český účet nebo IBAN s kontrolním součtem. |
| Upomínky | Nejméně jeden vybraný den; validované odpovědi a kopie. Server rovněž kontroluje rozsah dnů. |
| Logo | PNG/JPEG/WebP podle obsahu, nejvýš 512 kB a 4096 × 4096 px, skutečně dekódovatelný obrázek. |
| Role a tarif | Výběr z povolených hodnot; API provádí vlastní kontrolu oprávnění a hodnot. |

ARES: <https://data.mf.gov.cz/api/ares.html>. Nalezený subjekt a skutečné
„nenalezeno“ jsou odlišné od výpadku služby. Při výpadku lze pokračovat ručním
zadáním; před založením firmy kontrolu opakuje server. Opožděná odpověď pro
staré IČO nesmí změnit aktuální formulář. Ručně upravené údaje se zachovávají.

Validace formátu nepotvrzuje majitele telefonu, existenci e-mailové/datové
schránky, vlastnictví bankovního účtu ani registraci k DPH. Samotná přítomnost
DIČ proto automaticky nezaškrtává plátce DPH. Volba plátce se ukládá do konceptu.

## Návrat po přihlášení

Nedokončený účet se po přihlášení vrací na `/onboarding`. Server načte koncept
z `onboarding_drafts` podle ID ověřeného uživatele. Koncept obsahuje aktuální
krok 1–7, dosažené kroky, údaje firmy, upomínky, připravené pozvánky i logo.
Pozvánky se samotným ukládáním konceptu neodesílají a firma nevzniká.

Změna kroku se ukládá ihned, psaní s krátkým zpožděním. Místní záloha používá
klíč obsahující ID účtu. Novější místní záloha může obnovit změny po výpadku
sítě; obecný starý klíč bez vlastníka se nepřebírá mezi účty. Databáze odmítá
opožděný starší zápis. Stav načtený na jiném zařízení tak tvoří základ dalšího
ukládání i při rozdílném nastavení hodin zařízení.

Tabulka má RLS a odebraná oprávnění `anon` i `authenticated`; přístup je pouze
přes API s ověřenou session a MFA. ID vlastníka vybírá server. Po založení firmy
se koncept smaže a serverové členství/předplatné má vždy přednost: nedokončená
platba pokračuje krokem 8, aktivní firma přejde do aplikace.
