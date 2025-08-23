---
applyTo: '**'
---

**Rewrite Task: ST-SuperObjective Extension**

Beim Rewrite der Extension sind folgende Anforderungen und Kriterien zu beachten:

1. **Modularität & Lesbarkeit**
   - Trenne Logik, Datenhaltung und UI klar in eigene Module.
   - Nutze sprechende Funktions- und Variablennamen.
   - Dokumentiere alle öffentlichen Funktionen und wichtigen Datenstrukturen.

2. **User/Charakter-basierte Aufgabenverwaltung**
   - Jeder User/Charakter hat eigene Tasks und Objectives.
   - Die Datenstruktur muss Aufgaben und Ziele pro User/Charakter kapseln.
   - Funktionen und UI müssen den aktiven User/Charakter berücksichtigen.

3. **Erweiterbarkeit**
   - Das System soll leicht um neue Task-Typen, Statistiken oder User-Attribute erweiterbar sein.
   - Nutze Schnittstellen/Abstraktionen, wo sinnvoll.

4. **Persistenz**
   - Aufgaben und Ziele werden pro User/Charakter gespeichert und geladen.
   - Die Speicherung soll robust und fehlertolerant sein.

5. **UI/UX**
   - Die Oberfläche zeigt immer nur die Tasks/Objectives des aktuell gewählten Users/Charakters.
   - Einfache Möglichkeit zum Wechseln des aktiven Users/Charakters.

6. **Fehlerbehandlung**
   - Alle kritischen Funktionen prüfen Eingaben und liefern sinnvolle Fehlermeldungen.
   - Keine globalen Zustände ohne Kontext.

7. **Testbarkeit**
   - Schreibe Unit-Tests für zentrale Funktionen.
   - Die Kernlogik ist unabhängig von der UI testbar.

**Success Criteria:**
- Die Extension ist übersichtlich, modular und leicht wartbar.
- Jeder User/Charakter kann unabhängig Aufgaben und Ziele verwalten.
- Die wichtigsten Funktionen sind