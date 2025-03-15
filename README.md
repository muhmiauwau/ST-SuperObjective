# SillyTavern-SuperObjective

## This extension is currently in beta testing, there may be bugs or other weirdness. Please open an issue if you find any problems.

## What is it?

The SuperObjective extension lets you specify an objective for the AI to strive towards during your chat. This objective is broken down into step-by-step tasks that can be organized in a hierarchical structure. Tasks may be branched, where child tasks can be created automatically or manually, giving you the ability to create complex task trees.

This differs from static prompting by adding sequential and paced directives for the AI to follow without user intervention, creating a more genuine experience of the AI autonomously working toward a goal.

## Prerequisites

Before you begin, ensure you've met the following prerequisites:

- Make sure you're on the latest version of SillyTavern
- Install the ST-SuperObjective extension using this link and the "Install extension" button on the extensions panel.

## Common Use Cases

Your imagination is the limit! You can give the AI any objective you wish, and it will plan out how to achieve it. Examples include:
- Planning how to slay a dragon
- Designing a marketing campaign
- Creating a detailed story outline
- Developing a business strategy
- Building a fictional world

## Getting Started

1. Open the Extensions menu and select Objective
2. Type an objective into the top text box
3. Click "Auto-Generate Tasks" to have the AI create a task list
4. Watch as the AI works through the tasks automatically

## Key Features

### Task Generation and Management

- **Auto-Generate Tasks**: Creates a complete task list based on your objective
- **Generate More Tasks**: Adds additional tasks without starting over
- **Task Hierarchy**: Create parent/child relationships between tasks
- **Manual Task Creation**: Add your own tasks at any position
- **Task Editing**: Modify task descriptions at any time
- **Task Movement**: Reorder tasks using up/down buttons
- **Task Deletion**: Remove tasks with the delete button

### Task Progress Visualization

- Progress bar shows completion percentage at a glance
- Displays count of completed vs. total tasks
- Updates dynamically as tasks are completed
- Provides visual feedback with a green progress bar

### Task Completion Tracking

- Automatic task completion checking at configurable intervals
- Manual task completion via checkboxes
- Manual task check via the Extras menu
- Parent tasks auto-complete when all children are done

### Recently Completed Tasks

- Maintains a configurable list of recently completed tasks
- Automatically adds tasks when marked complete
- Control how many completed tasks are included in the prompt
- View completed tasks in a dedicated popup
- Purge tasks when no longer needed
- Enable/disable including completed tasks in the prompt

### Upcoming Tasks

- Automatically identifies and tracks tasks that follow the current task
- Prioritizes tasks in the same parent container as the current task
- Control how many upcoming tasks are included in the prompt
- View upcoming tasks in a dedicated popup
- Purge tasks when no longer needed
- Enable/disable including upcoming tasks in the prompt

### Templates and Import/Export

- **Task Templates**: Save and load reusable task structures
- **Export Tasks**: Save your current tasks to a JSON file
- **Import Tasks**: Load tasks from a previously exported file
- **Template Management**: Preview, rename, and delete templates

### Statistics and History

- Track task completion with timestamps
- View statistics on completed tasks and objectives
- Global statistics across all chats
- Chat-specific statistics for the current session
- View recently completed tasks with descriptions and dates

## Configuration

### Basic Settings

- **Position in Chat**: Controls how prominently the task appears in the AI's context 
- **Task Check Frequency**: How often the AI checks if a task is complete (3 default, 0 disables)
- **Hide Tasks**: Option to hide the task list for a more mysterious experience

### Advanced Settings

- **Custom Prompts**: Edit the prompts used for task generation and checking
- **Save/Load Prompts**: Persist your custom prompts for future use

## Usage Tips

### Current Task Selection

The current task will always be the first listed incomplete task. Any updates to tasks will trigger a check for what the current task should be. Tasks are selected depth-first, meaning all child tasks will be selected in order first, then continue down the list.

### Branch Tasks

Click the Branch Task button to set the current task as an objective where you can generate or manually create child tasks. You can continue to turn any child task into an objective to create deeper hierarchies.

### Hiding Tasks

If you want to remain unaware of what tasks the AI is attempting to complete, check the Hide Tasks box to hide the task list. For maximum mystery, do this before clicking Auto-Generate Tasks!

### Task Context Awareness

With the recently completed and upcoming tasks features, the AI maintains awareness of both past accomplishments and future goals, creating a more coherent and goal-directed conversation experience.

## Warning

Task checking happens in a separate API request. Setting Task Check Frequency to 1 will double your API calls to the LLM service. Be careful with this if you are using a paid service.