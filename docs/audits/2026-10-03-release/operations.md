# Postup dokončení a vydání

1. Připravit oddělený Supabase projekt a HTTPS staging. Založení nového zpoplatněného prostředí ani nasazení hlavního projektu nebylo tímto lokálním auditem provedeno. Nepoužívat hlavní projekt jako testovací databázi.
2. Nasadit konkrétní auditovaný commit do stagingu, aplikovat všechny nové migrace a ověřit kompatibilitu dosavadního enginu při vypnutých přepínačích. Zajistit dvě organizace, admin/účetní/čtenář a běžný MFA účet. Použít syntetická data a oddělené úložiště.
3. Doručování omezit na testovací schránky poskytovatele; nesmí odesílat skutečným zákazníkům. Ověřit chybové odpovědi poskytovatele, retry a webhooky.
4. Vyřešit AUTH-01 a kapacitní blokátory. Pro každý peněžní scénář založit nezávislá očekávání: částky, měny, alokace, zůstatky, počet auditních záznamů a invariantu opakování. Doplnit přímé Data API/RPC/Storage testy všech rolí.
5. Nastavit proměnné a tajemství samostatného `release-audit.yml`; klíče neukládat do reportu ani artefaktů. Spustit běžného uživatele celým MFA včetně doručení a ověřit životnost cookies. Vyhodnotit JSON report, nikoli pouze počet zelených testů. Povinné scénáře nesmějí být přeskočené nebo zelené až po opakování.
6. Doplnit všechny chybějící scénáře matice a provést responsivitu včetně breakpointů, zoomu a fyzických telefonů. Staging je jediný vhodný cíl zátěžového HTTP testu s 50 skutečnými relacemi a 20 současnými zápisy.
7. Ověřit zálohování databáze **i souborů**. Zaznamenat timestamp obnovovaného bodu, začátek obnovy, obnovu konfigurace, počty/hash souborů, finanční součty, dokončení a funkční smoke test. RPO ≤ 24 hodin a RTO ≤ 4 hodiny musí vycházet ze skutečné zkoušky a dostupného tarifu.
8. Ověřit monitoring: chybovost a latence API, poslední úspěšný cron, stáří a chyby front, selhání e-mailů. Pro každý alert určit příjemce a zkušební incident, bez odeslání zákaznických zpráv.
9. Nacvičit návrat předchozí aplikace při již aplikovaných migracích. Nevracet potvrzené úhrady plošným rollbackem. Nové párování vypnout přepínači; úhrady opravovat auditovaným existujícím postupem.
10. Porovnat nový engine na ručně označených anonymizovaných datech bez zápisů a teprve pak pilot jedné firmy s ručním potvrzováním. CAMT nepovolit bez skutečného exportu KB. Výsledky archivovat k vydávanému commitu.
11. Zopakovat celou regresi, uzavřít P1 a zdokumentovat zbývající vady. Připojit release workflow jako povinnou kontrolu skutečného vydání; samotný ručně spustitelný YAML není enforcement nasazení.
12. Po schváleném vydání provést smoke test a první týden denně sledovat chyby, fronty, cron a doručování. Tento audit žádné ostré nasazení neschvaluje.

## Opakování lokálních důkazů

Z kořene projektu:

```powershell
node scripts/run-release-audit.mjs
node scripts/build-release-audit.mjs
node scripts/test-payment-assistance-concurrency.mjs
node scripts/audit-release-database.mjs
```

Zátěžový skript používá výhradně lokální izolovaný PostgreSQL a může několik minut běžet. Nevydává se za stagingový API test. Build používá syntetické služby; nelze jej použít jako schválený artefakt pro skutečné nasazení. Snímky a reporty neobsahují produkční dokumenty ani přihlašovací tajemství.
