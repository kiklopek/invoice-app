# Založení firmy a přijetí pozvánky

## Zakladatel nové firmy

1. Na `/register` zadá jméno, e-mail a heslo a potvrdí podmínky. Server zkontroluje vstup a připraví nativní signup token v Supabase. Uživateli přes Resend odešle vlastní pětiznakový kód, žádný potvrzovací odkaz.
2. Na stejném formuláři zadá kód. Server atomicky ověří a spotřebuje pětiznakový kód. Teprve potom použije nativní signup token k potvrzení e-mailu v Supabase. Až potom se uloží zvolené heslo/profil a server nastaví přihlašovací i MFA cookies pro právě ověřenou session. Účet zůstává před tímto krokem nepotvrzený.
3. Toto jediné ověření platí i pro první přihlášení. Zakladatel pokračuje přímo na `/onboarding`, bez dalšího kódu. Na ověřeném zařízení platí dosavadní důvěryhodnost; jiné zařízení vyžaduje běžný přihlašovací kód.
4. Založí firmu, stane se administrátorem a dokončí firemní nastavení a předplatné. Další lidi zve z nastavení týmu.

Firma se vytváří pouze serverovým onboardingem. Člen existující firmy nemůže tímto postupem založit další firmu; databázová funkce chrání i souběžné požadavky a dvojklik.

Registrační formulář má opakované poslání kódu po minutě. Server omezuje odesílání na 3 pokusy na adresu za 15 minut a ověřování na 10 pokusů; oba limity mají i vlastní IP limit. Registrace i přihlašovací 2FA používají 5 různých znaků z `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, vždy alespoň jedno písmeno a číslici. Zadávání nerozlišuje velikost písmen. Kód platí 10 minut a po 5 chybných pokusech se zablokuje. Opakované nebo chybné kódy nemohou vytvořit MFA cookie. Pro potvrzený existující účet se generování signup OTP odmítne a server odpoví neutrálně; uživatel pokračuje přihlášením. Rozpracovaný účet může po novém ověření nastavit heslo z aktuální registrace, aby v něm nezůstalo cizí heslo ze starého nedokončeného pokusu.

Před nasazením kódu aplikujte migraci `registration_otp_rate_limits`. Pětiznaková registrace využívá existující tabulku/RPC MFA výzev s odděleným náhodným session ID a doménou HMAC; v databázi je pouze HMAC kódu. Nativní signup token je uložený v AES-256-GCM šifrované HttpOnly/SameSite cookie a nikdy není dostupný JavaScriptu. Je vázaný na konkrétní e-mail, uživatele a výzvu. Teprve správný kód zpřístupní nativní token serverovému potvrzení.

Nová aplikace nepoužívá Supabase `signUp` pro odesílání odkazů a nevyžaduje ruční změnu šablony hostovaného projektu. `supabase/templates/confirm.html` je záložní kódová šablona pro přímé signup volání; staré odeslané odkazy stále obsluhuje callback. Obnova zapomenutého hesla má nadále svůj samostatný jednorázový odkaz.

## Pozvaný kolega

1. Administrátor zvolí e-mail a roli kolegy a odešle pozvánku.
2. Kolega otevře `/pozvanka/<token>`. Vidí firmu a přidělenou roli; e-mail je pevně daný pozvánkou.
3. Zvolí „Ještě nemám účet“ (jméno a nové heslo), nebo „Už mám účet“ (současné heslo). Existujícímu účtu se nemění heslo ani jméno.
4. Server znovu ověří token a jeho platnost, ověří nebo vytvoří účet a připojí jej k firmě s rolí z databáze. Klient nemůže zadat jinou firmu, roli ani e-mail.
5. Po úspěchu pokračuje do firmy, bez vlastního firemního onboardingu a bez nového předplatného. Pokud uložení relace selže až po přijetí, přihlásí se běžným přihlášením.

Odkaz je jednorázový a platí sedm dní. Přijetí e-mailové pozvánky spolu s heslem ověřuje první relaci; další přihlášení používají standardní ověření. Účet v jiné firmě se automaticky nepřevádí. Prošlou, zrušenou nebo nahrazenou pozvánku musí administrátor odeslat znovu. Přihlášený jiný uživatel se musí nejprve odhlásit.

## Když uživatel použije jinou cestu

Existující účet se přihlašuje přes `/login`. Pokud pozvaný omylem použije obecnou registraci, zachovává se dosavadní bezpečné převzetí platné čekající pozvánky až po ověření vlastnictví e-mailu. Díky tomu si nezaloží duplicitní firmu. Veřejná kontrola registrace neprozrazuje existenci běžného účtu nebo pozvánky; samostatný odkaz z e-mailu je hlavní doporučená cesta. Pouhá shoda firemní domény členství nezakládá.

Starší vstup R. Hlavica zůstává oddělený: registraci povolí jen předem přidané adrese dané firmy. Obecné registrace ostatních firem na něj neodkazují.

## Ověření bez odesílání e-mailů

```sh
corepack pnpm exec vitest run src/app/api/auth/register src/lib/registration-email-server.test.ts src/app/api/invitations src/app/auth/callback src/app/api/auth/session-preference src/app/api/auth/registration-access src/app/api/onboarding/organization src/lib/auth-security.test.ts src/lib/auth-flow.test.ts src/app/\(auth\)/pozvanka
corepack pnpm exec playwright test --config playwright.faq.config.ts registration-flow.spec.ts
corepack pnpm typecheck
```

Testy ověřují zakladatele i člena po ověření, rozlišení nového a existujícího účtu, stávající hesla, prošlé odkazy, odmítnutí jiné firmy, obnovu po chybě ukládání relace a ochranu firemních dat. Skutečné doručení e-mailů je závislé na konfiguraci Supabase a e-mailové služby a těmito izolovanými testy se nesimuluje jako úspěšné doručení.

Prohlížečové testy projdou český i anglický formulář v Chromium a WebKit, kontrolují zadání kódu, chybný kód, opakované odeslání, přímý přechod do onboardingu a obnovu tlačítka po chybě připojení nebo doručení. Požadavky na Supabase Auth a zápisové API jsou zachycené testem, takže nevytvářejí skutečné účty ani neodesílají zprávy.
