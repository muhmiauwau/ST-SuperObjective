# Funktionen in index.js (ST-SuperObjective)

Diese Datei implementiert die Kernlogik der SuperObjective-Erweiterung für SillyTavern. Sie verwaltet Aufgaben (Tasks), Ziele (Objectives), UI-Interaktionen und die Kommunikation mit anderen Modulen. Nachfolgend eine Übersicht der wichtigsten Funktionen und Klassen:

## Hauptklassen & Datenstrukturen

### ObjectiveTask
- Repräsentiert eine Aufgabe mit Eigenschaften wie `id`, `description`, `completed`, `parentId`, `children`, `duration`, `elapsedMessages`.
- Methoden: `addTask`, `completeTask`, `addUiElement`, `onCompleteClick`, `onDescriptionUpdate`, `onDeleteClick`, `onAddClick`, `onDurationClick`, `toSaveStateRecurse`, u.a.

## Aufgabenmanagement
- **getTaskById(taskId)**: Sucht eine Aufgabe anhand ihrer ID im Aufgabenbaum.
- **generateTasks()**: Erstellt neue Aufgaben für ein Ziel mittels KI-Prompt.
- **generateAdditionalTasks()**: Fügt zusätzliche Aufgaben zu einem bestehenden Ziel hinzu.
- **markTaskCompleted()**: Markiert die aktuelle Aufgabe als abgeschlossen.
- **checkTaskCompleted()**: Prüft per KI, ob eine Aufgabe abgeschlossen ist.
- **getNextIncompleteTaskRecurse(task)**: Sucht die nächste unerledigte Aufgabe im Baum.
- **incrementTaskElapsedMessages()**: Zählt Nachrichten für Aufgaben mit Dauer.
- **setCurrentTask(taskId, skipSave)**: Setzt die aktuelle Aufgabe und aktualisiert die UI/Prompts.

## Custom Prompts & Templates
- Verwaltung und Bearbeitung von benutzerdefinierten Prompts für die KI-Interaktion.
- Export/Import von Prompts und Task-Templates als JSON.

## UI-Funktionen
- **updateUiTaskList()**: Aktualisiert die Aufgabenliste im UI.
- **initSortable()**: Ermöglicht Drag-and-Drop für Aufgaben.
- **updateProgressBar()**: Zeigt den Fortschritt der Aufgaben an.
- **addManualTaskCheckUi()**: Fügt UI-Elemente für manuelle Aufgabenprüfung hinzu.
- **doPopout(e)**: Öffnet ein Popout-Fenster für die Erweiterung.

## Statistik & Historie
- **updateStatistics(taskCompleted)**: Aktualisiert Aufgaben- und Zielstatistiken.
- **showStatistics()**: Zeigt Statistiken und Historie im Popup.
- **addToCompletionHistory(task)**: Fügt abgeschlossene Aufgaben zur Historie hinzu.

## Einstellungen & State
- **saveState() / loadSettings() / resetState()**: Speichern und Laden des aktuellen Zustands und der Einstellungen.
- **saveUIState() / loadUIState()**: Speichern/Laden des UI-Zustands (z.B. Panel offen/geschlossen).

## Event-Handling
- Initialisiert Event-Listener für UI-Elemente und Chat-Events (z.B. neue Nachricht, Swipe, Chat-Wechsel).

## Sonstiges
- **substituteParamsPrompts(content, substituteGlobal)**: Ersetzt Platzhalter in Prompts mit aktuellen Werten.
- **updateUpcomingTasks() / updateCompletedTasksCount()**: Aktualisiert Listen für bevorstehende und abgeschlossene Aufgaben.

---


## Erweiterung: Aufgaben und Ziele pro User/Charakter

Um das System so zu erweitern, dass jeder Charakter oder User eigene Aufgaben und Ziele hat, sollte die Datenstruktur und die Logik wie folgt angepasst werden:

### Verbesserte Datenstruktur

```js
{
  settings: { /* globale Einstellungen */ },
  templates: { /* globale Task-/Prompt-Templates */ },
  history: [ /* globale Task-Historie */ ],
  users: {
    userId1: { objectives: [...], tasks: [...] },
    userId2: { objectives: [...], tasks: [...] }
  },
  chars: {
    charId1: { objectives: [...], tasks: [...] }
  }
}
```
- **settings**: gelten für alle User/Charaktere.
- **templates**: zentrale Vorlagen für Tasks/Prompts.
- **history**: globale Historie aller abgeschlossenen Tasks.
- **users/chars**: nur die Aufgaben/Ziele sind individuell.

**Wichtig für den Rewrite:**  
- Trenne strikt globale und individuelle Daten.
- Funktionen wie `saveState`, `loadState` und die UI müssen nur die Aufgaben/Ziele pro User/Charakter unterscheiden, nicht die Settings oder Historie.
- Statistiken können wahlweise global oder pro User/Charakter geführt werden – je nach Anwendungsfall.

Damit bleibt die Struktur

### Anpassungen in der Logik
- Alle Funktionen wie `getTaskById`, `setCurrentTask`, `saveState` etc. müssen einen User/Charakter-Kontext bekommen (z.B. als Parameter oder über ein aktives Profil).
- Die UI zeigt immer die Aufgaben/Ziele des aktuell gewählten Users/Charakters an.
- Beim Wechsel des Users/Charakters werden die entsprechenden Daten geladen und angezeigt.
- Das Speichern/Laden erfolgt pro User/Charakter.

### Vorteile
- Jeder User/Charakter kann eigene Ziele und Aufgaben unabhängig bearbeiten.
- Statistiken, Historie und Templates können ebenfalls pro User/Charakter geführt werden.

### Beispiel für Methoden
- `getTaskById(taskId, ownerId)`
- `setCurrentTask(taskId, ownerId)`
- `saveState(ownerId)`

### UI-Erweiterung
- Auswahlfeld für User/Charakter im Interface
- Aufgabenlisten, Statistiken und Prompts werden dynamisch für den gewählten User/Charakter angezeigt

---

**Hinweis:** Die Datei ist modular aufgebaut und nutzt viele asynchrone Funktionen, Templates und jQuery für die UI. Die Aufgabenstruktur ist baumartig (Tasks mit Subtasks). Die Prompts steuern die KI-Interaktion für Aufgabenmanagement.

Für einen kompletten Rewrite empfiehlt sich:
- Trennung von Logik und UI
- Nutzung moderner JS-Features (z.B. Klassen, Module)
- Reduzierung von globalen Variablen
- Klare Schnittstellen für Aufgaben, Ziele und Events
