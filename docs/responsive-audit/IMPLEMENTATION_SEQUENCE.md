# Následná implementace — pořadí malých změn

Tento dokument je plán dalších změn, nikoliv seznam úprav provedených auditem. Každý krok má vlastní diff, důkazy a možnost vrácení. Nepřepisovat současný pracovní strom; nejprve oddělit existující lokální změny od produkčního základu.

| Krok                 | Obsah                                                                                  | Povinný důkaz dokončení                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0. Reference         | Změřit skutečné okno MacBooku, zachytit přihlášenou produkci a přiřadit přesný commit  | B-01/B-02 vyřešeny; žádný náhradní odhad/login screenshot                                                        |
| 1. Baseline          | Schválit odpovídající syntetické kandidáty a geometrii; doplnit stavy/font/SSR rozdíly | Pixelový a funkční guard funguje bez automatického updatu snímků                                                 |
| 2. Kontakt zákazníka | Jedna lokální oprava R-001: dostupný kontakt/editace v kompaktní variantě              | Admin má dosažitelný kontakt v 390/768/1024/1280/reference; viewer nemá editaci; uložení/chyba zachová draft     |
| 3. Invoice řádek     | Kompaktní varianta podle vlastního kontejneru pod 1090 px                              | 1024×768 bez nutnosti horizontálního posunu k akcím, data/selection/sort/paging zachovány; Standard beze změny   |
| 4. Částky            | Přezkoumat již existující lokální R-003 opravu místo druhého řešení                    | Žádný zbytečný scroll span; přesná hodnota i tooltip po resize/font load; sdílené ostatní částky bez regrese     |
| 5. Shell kontrakt    | Vyřešit pouze doložené konflikty viewport/JS nav; nezačínat přepisem celé navigace     | Drawer/scroll lock/focus, 600px výška, změna šířky s rozepsanou fakturou, sidebar 244 px                         |
| 6. Rolové aliasy     | Jedna rodina komponent za krok; nejprve aliasovat stávající hodnoty                    | Chráněný Standard/mobil beze změny; explicitní diff každé záměrné změny                                          |
| 7. Skupiny a Wide    | KPI/grafy/upload/editor zvlášť; role Expanded mají omezené maximum                     | Multi-currency/long-content/short-window; nepřevzít lokální zoom jako nový globální standard                     |
| 8. Interakce a úklid | Popup/keyboard/print a odstranění prokazatelně nahrazených pravidel                    | Staging/Next a fyzické Safari, keyboard, print; odstranění má konkrétní náhradu a žádný nový globální workaround |

Každý krok rozliší: opravu potvrzené chyby, změnu mimo chráněnou referenci a návrh viditelné změny referenčního desktopu. Třetí typ se nesmí schovat do technického refaktoru.

## Obecná akceptace

- Schválená reference bez nechtěné změny; screenshoty nepřepisovat jen proto, že test selhal.
- Důležité informace/akce nezmizí při změně kontejneru a nedochází k horizontálnímu přetékání dokumentu.
- Funkce se ověřují skutečnou interakcí. HTTP mock bez zobrazeného stavu není důkaz chybového UI.
- Drafty, výběry, přesné peněžní hodnoty, role, auth/MFA/cookies, routování, backend a exporty zůstávají zachované.
- Kontroly zahrnou opravenou šířku, její sousední hranice a nedotčené mobilní/Standard režimy.
- Změny se nejprve ověří izolovaně a v reálném Next/staging prostředí; deploy není součástí této auditní fáze.
