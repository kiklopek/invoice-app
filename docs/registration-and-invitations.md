# Založení firmy a přijetí pozvánky

## Zakladatel nové firmy

1. Na `/register` si vytvoří osobní účet, potvrdí podmínky a ověří e-mail.
2. Uloží se přihlašovací relace, i když účet ještě nemá firmu.
3. Po požadovaném ověření přihlášení pokračuje přímo na `/onboarding`.
4. Založí firmu, stane se administrátorem a dokončí firemní nastavení a předplatné. Další lidi zve z nastavení týmu.

Firma se vytváří pouze serverovým onboardingem. Člen existující firmy nemůže tímto postupem založit další firmu; databázová funkce chrání i souběžné požadavky a dvojklik.

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
corepack pnpm exec vitest run src/app/api/invitations src/app/auth/callback src/app/api/auth/session-preference src/app/api/auth/registration-access src/app/api/onboarding/organization src/lib/auth-security.test.ts src/lib/auth-flow.test.ts src/app/\(auth\)/pozvanka
corepack pnpm exec playwright test --config playwright.faq.config.ts registration-flow.spec.ts
corepack pnpm typecheck
```

Testy ověřují zakladatele i člena po ověření, rozlišení nového a existujícího účtu, stávající hesla, prošlé odkazy, odmítnutí jiné firmy, obnovu po chybě ukládání relace a ochranu firemních dat. Skutečné doručení e-mailů je závislé na konfiguraci Supabase a e-mailové služby a těmito izolovanými testy se nesimuluje jako úspěšné doručení.

Prohlížečové testy projdou český i anglický formulář v Chromium a WebKit, kontrolují přechod k potvrzení e-mailu, okamžitou session s tokenem i obnovu tlačítka po chybě připojení. Požadavky na Supabase Auth a zápisové API jsou zachycené testem, takže nevytvářejí skutečné účty ani neodesílají zprávy.
