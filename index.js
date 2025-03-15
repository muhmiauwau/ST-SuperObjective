import { chat_metadata, saveSettingsDebounced, is_send_press, extension_prompt_types } from '../../../../script.js';
import { getContext, extension_settings, saveMetadataDebounced, renderExtensionTemplateAsync } from '../../../extensions.js';
import {
    substituteParams,
    eventSource,
    event_types,
    generateQuietPrompt,
    animation_duration,
} from '../../../../script.js';
import { waitUntilCondition } from '../../../utils.js';
import { is_group_generating, selected_group } from '../../../group-chats.js';
import { dragElement } from '../../../../scripts/RossAscends-mods.js';
import { loadMovingUIState } from '../../../../scripts/power-user.js';
import { callGenericPopup, Popup, POPUP_TYPE } from '../../../popup.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

const MODULE_NAME = 'SuperObjective';


let taskTree = null;
let currentChatId = '';
let currentObjective = null;
let currentTask = null;
let checkCounter = 0;
let lastMessageWasSwipe = false;
let selectedCustomPrompt = 'default';
let recentlyCompletedTasks = []; // Array to store recently completed tasks
let upcomingTasks = []; // Array to store upcoming tasks


const defaultPrompts = {
    'createTask': 'Ignore previous instructions. Please generate a numbered list of plain text tasks to complete an objective. The objective that you must make a numbered task list for is: "{{objective}}". The tasks created should take into account the character traits of {{char}}. These tasks may or may not involve {{user}} directly. Include the objective as the final task.\n\nThe list should be formatted using a number followed by a fullstop and the task on each line, e.g. "1. Take over the world". Include only the list in your reply.',
    'checkTaskCompleted': 'Ignore previous instructions. Determine if this task is completed: [{{task}}]. To do this, examine the most recent messages. Your response must only contain either true or false, and nothing else. Example output: true',
    'currentTask': 'Your current task is [{{task}}]. Balance existing roleplay with completing this task.',
    'completedTasks': 'Recently completed tasks: {{completedTasks}}',
    'upcomingTasks': 'Upcoming tasks: {{upcomingTasks}}',
    'additionalTasks': 'Ignore previous instructions. Please generate additional numbered tasks to complete the objective: "{{objective}}". The tasks created should take into account the character traits of {{char}}. These tasks may or may not involve {{user}} directly.\n\nThe following tasks have already been created:\n{{existingTasks}}\n\nPlease generate additional tasks that complement these existing tasks. Continue the numbering from where the list left off. Do not repeat any existing tasks.\n\nThe list should be formatted using a number followed by a fullstop and the task on each line, e.g. "4. Investigate the mysterious cave". Include only the list in your reply.'
};

let objectivePrompts = defaultPrompts;

//###############################//
//#       Task Management       #//
//###############################//

// Return the task and index or throw an error
function getTaskById(taskId) {
    if (taskId == null) {
        throw 'Null task id';
    }
    return getTaskByIdRecurse(taskId, taskTree);
}

function getTaskByIdRecurse(taskId, task) {
    if (task.id == taskId) {
        return task;
    }
    for (const childTask of task.children) {
        const foundTask = getTaskByIdRecurse(taskId, childTask);
        if (foundTask != null) {
            return foundTask;
        }
    }
    return null;
}

function substituteParamsPrompts(content, substituteGlobal) {
    content = content.replace(/{{objective}}/gi, currentObjective?.description ?? '');
    content = content.replace(/{{task}}/gi, currentTask?.description ?? '');
    content = content.replace(/{{parent}}/gi, currentTask?.parent?.description ?? '');

    // Handle completed tasks if needed
    if (content.includes('{{completedTasks}}')) {
        if (recentlyCompletedTasks.length > 0) {
            const completedTasksText = recentlyCompletedTasks
                .map(task => `[${task.description}]`)
                .join(', ');
            content = content.replace(/{{completedTasks}}/gi, completedTasksText);
        } else {
            // Replace with a message indicating no completed tasks
            content = content.replace(/{{completedTasks}}/gi, "No tasks completed yet");
        }
    }

    // Handle upcoming tasks if needed
    if (content.includes('{{upcomingTasks}}')) {
        if (upcomingTasks.length > 0) {
            const upcomingTasksText = upcomingTasks
                .map(task => `[${task.description}]`)
                .join(', ');
            content = content.replace(/{{upcomingTasks}}/gi, upcomingTasksText);
        } else {
            // Replace with a message indicating no upcoming tasks
            content = content.replace(/{{upcomingTasks}}/gi, "No upcoming tasks yet");
        }
    }

    if (substituteGlobal) {
        content = substituteParams(content);
    }
    return content;
}

// Call Quiet Generate to create task list using character context, then convert to tasks. Should not be called much.
async function generateTasks() {
    const prompt = substituteParamsPrompts(objectivePrompts.createTask, false);
    console.log('Generating tasks for objective with prompt');
    toastr.info('Generating tasks for objective', 'Please wait...');
    const taskResponse = await generateQuietPrompt(prompt, false, false);

    // Clear all existing objective tasks when generating
    currentObjective.children = [];
    const numberedListPattern = /^\d+\./;

    // Track the first task we add
    let firstTask = null;

    // Create tasks from generated task list
    for (const task of taskResponse.split('\n').map(x => x.trim())) {
        if (task.match(numberedListPattern) != null) {
            const newTask = currentObjective.addTask(task.replace(numberedListPattern, '').trim());
            if (!firstTask) {
                firstTask = newTask;
            }
        }
    }
    updateUiTaskList();

    // Find and highlight the first task
    if (firstTask) {
        setCurrentTask(firstTask.id);
    } else {
        setCurrentTask();
    }

    console.info(`Response for Objective: '${currentObjective.description}' was \n'${taskResponse}', \nwhich created tasks \n${JSON.stringify(currentObjective.children.map(v => { return v.toSaveState(); }), null, 2)} `);
    toastr.success(`Generated ${currentObjective.children.length} tasks`, 'Done!');
}

// Generate additional tasks without clearing existing ones
async function generateAdditionalTasks() {
    // If there are no existing tasks, just use the regular generate function
    if (!currentObjective || currentObjective.children.length === 0) {
        return generateTasks();
    }

    // Create a list of existing tasks for the prompt
    let existingTasksText = currentObjective.children.map((task, index) =>
        `${index + 1}. ${task.description}`).join('\n');

    // Use the additionalTasks prompt with the existing tasks inserted
    let additionalPrompt = objectivePrompts.additionalTasks || defaultPrompts.additionalTasks;
    additionalPrompt = additionalPrompt.replace(/{{existingTasks}}/gi, existingTasksText);
    additionalPrompt = substituteParamsPrompts(additionalPrompt, false);

    console.log('Generating additional tasks for objective');
    toastr.info('Generating additional tasks', 'Please wait...');

    const taskResponse = await generateQuietPrompt(additionalPrompt, false, false);
    const initialTaskCount = currentObjective.children.length;
    const numberedListPattern = /^\d+\./;

    // Track the first new task we add
    let firstNewTask = null;

    // Add new tasks to the existing list
    for (const task of taskResponse.split('\n').map(x => x.trim())) {
        if (task.match(numberedListPattern) != null) {
            const newTask = currentObjective.addTask(task.replace(numberedListPattern, '').trim());
            if (!firstNewTask) {
                firstNewTask = newTask;
            }
        }
    }

    const newTaskCount = currentObjective.children.length - initialTaskCount;
    updateUiTaskList();

    // If new tasks were added, highlight the first new task
    if (newTaskCount > 0 && firstNewTask) {
        setCurrentTask(firstNewTask.id);
    } else {
        // Otherwise find the first incomplete task
        const nextTask = getNextIncompleteTaskRecurse(taskTree);
        if (nextTask) {
            setCurrentTask(nextTask.id);
        } else {
            setCurrentTask();
        }
    }

    console.info(`Generated ${newTaskCount} additional tasks for objective: '${currentObjective.description}'`);
    toastr.success(`Added ${newTaskCount} additional tasks`, 'Done!');
}

async function markTaskCompleted() {
    // Make sure there's a current task
    if (jQuery.isEmptyObject(currentTask)) {
        console.warn('No current task to mark as completed');
        toastr.warning('No current task to mark as completed');
        return;
    }

    console.info(`User determined task '${currentTask.description}' is completed.`);

    // Store the current task ID before completing it
    const taskId = currentTask.id;

    // Only add to recently completed tasks if it wasn't already completed
    if (!currentTask.completed) {
        currentTask.completeTask();

        // After completing the task, find the next task and highlight it
        const nextTask = getNextIncompleteTaskRecurse(taskTree);
        if (nextTask) {
            setCurrentTask(nextTask.id);
        } else {
            // If no next task, keep the completed task highlighted
            setCurrentTask(taskId);
        }
    } else {
        toastr.info('Task was already marked as completed');
    }
}

// Call Quiet Generate to check if a task is completed
async function checkTaskCompleted() {
    // Make sure there are tasks
    if (jQuery.isEmptyObject(currentTask)) {
        console.warn('No current task to check');
        return String(false);
    }

    try {
        // Wait for group to finish generating
        if (selected_group) {
            await waitUntilCondition(() => is_group_generating === false, 10000, 100);
        }
        // Another extension might be doing something with the chat, so wait for it to finish
        await waitUntilCondition(() => is_send_press === false, 30000, 100);
    } catch {
        console.debug('Failed to wait for group to finish generating');
        return String(false);
    }

    // Store the current task ID before checking
    const taskId = currentTask.id;

    checkCounter = Number($('#objective-check-frequency').val());
    const toast = toastr.info('Checking for task completion.');

    const prompt = substituteParamsPrompts(objectivePrompts.checkTaskCompleted, false);
    const taskResponse = (await generateQuietPrompt(prompt, false, false)).toLowerCase();
    toastr.clear(toast);

    // Check response if task complete
    if (taskResponse.includes('true')) {
        console.info(`Character determined task '${currentTask.description} is completed.`);
        currentTask.completeTask();
        return String(true);
    } else if (!(taskResponse.includes('false'))) {
        console.warn(`checkTaskCompleted response did not contain true or false. taskResponse: ${taskResponse}`);
    } else {
        console.debug(`Checked task completion. taskResponse: ${taskResponse}`);
        // If task is not completed, make sure to preserve the highlight
        setCurrentTask(taskId);
    }

    return String(false);
}

function getNextIncompleteTaskRecurse(task) {
    // First check direct children to prioritize tasks at the top level
    if (task.children && task.children.length > 0) {
        for (const childTask of task.children) {
            // Return the first incomplete task at this level
            if (childTask.completed === false && childTask.children.length === 0) {
                return childTask;
            }
        }

        // If no direct incomplete children, then recurse into each child
        for (const childTask of task.children) {
            if (childTask.completed === true) { // Don't recurse into completed tasks
                continue;
            }
            const foundTask = getNextIncompleteTaskRecurse(childTask);
            if (foundTask != null) {
                return foundTask;
            }
        }
    }

    // If this is a leaf task and it's incomplete, return it
    if (task.completed === false
        && task.children.length === 0
        && task.parentId !== '') {
        return task;
    }

    return null;
}

// Set a task in extensionPrompt context. Defaults to first incomplete
function setCurrentTask(taskId = null, skipSave = false) {
    const context = getContext();

    // TODO: Should probably null this rather than set empty object
    currentTask = {};

    // Find the task, either next incomplete, or by provided taskId
    if (taskId === null) {
        currentTask = getNextIncompleteTaskRecurse(taskTree) || {};
    } else {
        try {
            currentTask = getTaskById(taskId);
        } catch (e) {
            console.warn(`Failed to set current task with ID ${taskId}: ${e}`);
            currentTask = getNextIncompleteTaskRecurse(taskTree) || {};
        }
    }

    // Don't just check for a current task, check if it has data
    const description = currentTask.description || null;
    if (description) {
        let extensionPromptText = substituteParamsPrompts(objectivePrompts.currentTask, true);

        // Add recently completed tasks if enabled
        if ($('#objective-show-completed').prop('checked') && recentlyCompletedTasks.length > 0) {
            const completedTasksText = recentlyCompletedTasks
                .map(task => `[${task.description}]`)
                .join(', ');

            let completedTasksPrompt = objectivePrompts.completedTasks.replace(/{{completedTasks}}/gi, completedTasksText);
            completedTasksPrompt = substituteParams(completedTasksPrompt);

            extensionPromptText = `${extensionPromptText}\n${completedTasksPrompt}`;
        }

        // Update upcoming tasks based on the current task
        updateUpcomingTasks();

        // Add upcoming tasks if enabled
        if ($('#objective-show-upcoming').prop('checked') && upcomingTasks.length > 0) {
            const upcomingTasksText = upcomingTasks
                .map(task => `[${task.description}]`)
                .join(', ');

            let upcomingTasksPrompt = objectivePrompts.upcomingTasks.replace(/{{upcomingTasks}}/gi, upcomingTasksText);
            upcomingTasksPrompt = substituteParams(upcomingTasksPrompt);

            extensionPromptText = `${extensionPromptText}\n${upcomingTasksPrompt}`;
        }

        // Remove highlights from all tasks
        $('.objective-task').removeClass('objective-task-highlight');
        $('.objective-task').css({ 'border-color': '', 'border-width': '' });

        // Highlight only the current task with the new class
        if (currentTask.descriptionSpan) {
            currentTask.descriptionSpan.addClass('objective-task-highlight');
        }

        // Update the extension prompt
        context.setExtensionPrompt(MODULE_NAME, extensionPromptText, extension_prompt_types.IN_CHAT, Number($('#objective-chat-depth').val()));
        console.info(`Current task in context.extensionPrompts.Objective is ${JSON.stringify(context.extensionPrompts.Objective)}`);
    } else {
        context.setExtensionPrompt(MODULE_NAME, '', extension_prompt_types.NONE, 0);
        console.info('No current task');
    }

    // Save state if not skipping
    if (!skipSave) {
        saveState();
    }
}

function getHighestTaskIdRecurse(task) {
    let nextId = task.id;

    for (const childTask of task.children) {
        const childId = getHighestTaskIdRecurse(childTask);
        if (childId > nextId) {
            nextId = childId;
        }
    }
    return nextId;
}

//###############################//
//#         Task Class          #//
//###############################//
class ObjectiveTask {
    id;
    description;
    completed;
    parentId;
    children;
    completionDate;

    // UI Elements
    taskHtml;
    descriptionSpan;
    completedCheckbox;
    deleteTaskButton;
    addTaskButton;
    moveUpBotton;
    moveDownButton;

    constructor({ id = undefined, description, completed = false, parentId = '', completionDate = null }) {
        this.description = description;
        this.parentId = parentId;
        this.children = [];
        this.completed = completed;
        this.completionDate = completionDate;

        // Generate a new ID if none specified
        if (id == undefined) {
            this.id = getHighestTaskIdRecurse(taskTree) + 1;
        } else {
            this.id = id;
        }
    }

    // Accepts optional index. Defaults to adding to end of list.
    addTask(description, index = null) {
        index = index != null ? index : index = this.children.length;
        const newTask = new ObjectiveTask(
            { description: description, parentId: this.id }
        );
        this.children.splice(index, 0, newTask);

        // Update statistics - both chat-specific and global
        if (chat_metadata.objective.statistics) {
            chat_metadata.objective.statistics.tasksCreated++;
        }

        // Update global statistics
        if (extension_settings.objective.globalStatistics) {
            extension_settings.objective.globalStatistics.tasksCreated++;
            saveSettingsDebounced();
        }

        saveState();
        return newTask;
    }

    getIndex() {
        if (this.parentId !== null) {
            const parent = getTaskById(this.parentId);
            const index = parent.children.findIndex(task => task.id === this.id);
            if (index === -1) {
                throw `getIndex failed: Task '${this.description}' not found in parent task '${parent.description}'`;
            }
            return index;
        } else {
            throw `getIndex failed: Task '${this.description}' has no parent`;
        }
    }

    // Used to set parent to complete when all child tasks are completed
    checkParentComplete() {
        let all_completed = true;
        if (this.parentId !== '') {
            const parent = getTaskById(this.parentId);
            for (const child of parent.children) {
                if (!child.completed) {
                    all_completed = false;
                    break;
                }
            }
            if (all_completed) {
                parent.completed = true;
                console.info(`Parent task '${parent.description}' completed after all child tasks complated.`);
                updateUiTaskList();
            } else {
                parent.completed = false;
            }
        }
    }

    // Complete the current task, setting next task to next incomplete task
    completeTask() {
        // If already completed, don't do anything
        if (this.completed) {
            return;
        }

        // Store the current task ID before completing it
        const taskId = this.id;

        this.completed = true;
        this.completionDate = new Date().toISOString();
        console.info(`Task successfully completed: ${JSON.stringify(this.description)}`);

        // Add to completion history
        addToCompletionHistory(this);

        // Add to recently completed tasks
        addToRecentlyCompletedTasks(this);

        // Update statistics
        updateStatistics(true);

        this.checkParentComplete();

        // Find the next task to highlight
        const nextTask = getNextIncompleteTaskRecurse(taskTree);
        if (nextTask) {
            setCurrentTask(nextTask.id);
        } else {
            // If no next task, keep the completed task highlighted
            setCurrentTask(taskId);
        }

        updateUiTaskList();
    }

    // Add a single task to the UI and attach event listeners for user edits
    addUiElement() {
        const template = `
        <div id="objective-task-label-${this.id}" class="flex1 checkbox_label alignItemsCenter">
            <input id="objective-task-complete-${this.id}" type="checkbox">
            <span class="text_pole objective-task" id="objective-task-description-${this.id}" contenteditable>${this.description}</span>
            <div id="objective-task-delete-${this.id}" class="objective-task-button fa-solid fa-xmark fa-fw fa-lg" title="Delete Task"></div>
            <div id="objective-task-add-${this.id}" class="objective-task-button fa-solid fa-plus fa-fw fa-lg" title="Add Task"></div>
            <div id="objective-task-add-branch-${this.id}" class="objective-task-button fa-solid fa-code-fork fa-fw fa-lg" title="Branch Task"></div>
            <div id="objective-task-move-up-${this.id}" class="objective-task-button fa-solid fa-arrow-up fa-fw fa-lg" title="Move Up"></div>
            <div id="objective-task-move-down-${this.id}" class="objective-task-button fa-solid fa-arrow-down fa-fw fa-lg" title="Move Down"></div>
        </div><br>
        `;

        // Add the filled out template
        $('#objective-tasks').append(template);

        this.completedCheckbox = $(`#objective-task-complete-${this.id}`);
        this.descriptionSpan = $(`#objective-task-description-${this.id}`);
        this.addButton = $(`#objective-task-add-${this.id}`);
        this.deleteButton = $(`#objective-task-delete-${this.id}`);
        this.taskHtml = $(`#objective-task-label-${this.id}`);
        this.branchButton = $(`#objective-task-add-branch-${this.id}`);
        this.moveUpButton = $(`#objective-task-move-up-${this.id}`);
        this.moveDownButton = $(`#objective-task-move-down-${this.id}`);

        // Handle sub-task forking style
        if (this.children.length > 0) {
            this.branchButton.css({ 'color': '#33cc33' });
        } else {
            this.branchButton.css({ 'color': '' });
        }

        const parent = getTaskById(this.parentId);
        if (parent) {
            let index = parent.children.indexOf(this);
            if (index < 1) {
                $(`#objective-task-move-up-${this.id}`).removeClass('fa-arrow-up');
            } else {
                $(`#objective-task-move-up-${this.id}`).addClass('fa-arrow-up');
                $(`#objective-task-move-up-${this.id}`).on('click', () => (this.onMoveUpClick()));
            }

            if (index === (parent.children.length - 1)) {
                $(`#objective-task-move-down-${this.id}`).removeClass('fa-arrow-down');
            } else {
                $(`#objective-task-move-down-${this.id}`).addClass('fa-arrow-down');
                $(`#objective-task-move-down-${this.id}`).on('click', () => (this.onMoveDownClick()));
            }
        }
        // Add event listeners and set properties
        $(`#objective-task-complete-${this.id}`).prop('checked', this.completed);
        $(`#objective-task-complete-${this.id}`).on('click', () => (this.onCompleteClick()));
        $(`#objective-task-description-${this.id}`).on('keyup', () => (this.onDescriptionUpdate()));
        $(`#objective-task-description-${this.id}`).on('focusout', () => (this.onDescriptionFocusout()));
        $(`#objective-task-delete-${this.id}`).on('click', () => (this.onDeleteClick()));
        $(`#objective-task-add-${this.id}`).on('click', () => (this.onAddClick()));
        this.branchButton.on('click', () => (this.onBranchClick()));

        // If this is the current task, highlight it
        if (currentTask && currentTask.id === this.id) {
            this.descriptionSpan.addClass('objective-task-highlight');
        }
    }

    onBranchClick() {
        currentObjective = this;
        updateUiTaskList();

        // Find the first incomplete task in this branch
        const nextTask = getNextIncompleteTaskRecurse(this);
        if (nextTask) {
            setCurrentTask(nextTask.id);
        } else {
            // If no incomplete tasks in this branch, highlight the branch itself
            setCurrentTask(this.id);
        }
    }

    complete(completed) {
        this.completed = completed;

        // If marking as completed, set completion date if it doesn't exist
        if (completed && !this.completionDate) {
            this.completionDate = new Date().toISOString();
        }

        // Apply to all children recursively
        this.children.forEach(child => child.complete(completed));
    }
    onCompleteClick() {
        const wasCompleted = this.completed;
        this.complete(this.completedCheckbox.prop('checked'));

        // If task was just marked as completed, add to recently completed tasks
        if (!wasCompleted && this.completed) {
            // Set completion date if it doesn't exist
            if (!this.completionDate) {
                this.completionDate = new Date().toISOString();
            }

            // Add to recently completed tasks
            addToRecentlyCompletedTasks(this);

            // Add to completion history
            addToCompletionHistory(this);

            // Update statistics
            updateStatistics(true);

            // Find the next incomplete task to highlight
            const nextTask = getNextIncompleteTaskRecurse(taskTree);
            if (nextTask) {
                setCurrentTask(nextTask.id);
            } else {
                // If no next task, keep the completed task highlighted
                setCurrentTask(this.id);
            }
        }
        // If task was just marked as not completed, remove from recently completed tasks
        else if (wasCompleted && !this.completed) {
            // Remove from recently completed tasks
            recentlyCompletedTasks = recentlyCompletedTasks.filter(task => task.id !== this.id);

            // Update the UI with the new count
            updateCompletedTasksCount();

            // This task is now the first incomplete task, so highlight it
            setCurrentTask(this.id);
        }
        // If the completion state didn't change, just keep the current task highlighted
        else {
            setCurrentTask(this.id);
        }

        this.checkParentComplete();
        updateUiTaskList();
    }

    onDescriptionUpdate() {
        this.description = this.descriptionSpan.text();
    }

    onDescriptionFocusout() {
        // Preserve the highlight on the edited task
        setCurrentTask(this.id);
    }

    onDeleteClick() {
        const index = this.getIndex();
        const parent = getTaskById(this.parentId);

        // Check if this is the current task
        const isCurrentTask = (currentTask && currentTask.id === this.id);

        // Remove the task
        parent.children.splice(index, 1);

        // Update UI
        updateUiTaskList();

        // If we deleted the current task, find a new task to highlight
        if (isCurrentTask) {
            // Try to highlight the next task in the same parent
            if (index < parent.children.length) {
                // There's a next task at the same level
                setCurrentTask(parent.children[index].id);
            } else if (index > 0 && parent.children.length > 0) {
                // Highlight the previous task at the same level
                setCurrentTask(parent.children[index - 1].id);
            } else {
                // No siblings, highlight the parent or find the next incomplete task
                const nextTask = getNextIncompleteTaskRecurse(taskTree);
                if (nextTask) {
                    setCurrentTask(nextTask.id);
                } else {
                    // If no incomplete tasks, highlight the parent
                    setCurrentTask(parent.id);
                }
            }
        } else {
            // If we didn't delete the current task, preserve the current highlight
            setCurrentTask(currentTask.id);
        }
    }

    onMoveUpClick() {
        const parent = getTaskById(this.parentId);
        const index = parent.children.indexOf(this);
        if (index != 0) {
            // Swap positions
            let temp = parent.children[index - 1];
            parent.children[index - 1] = parent.children[index];
            parent.children[index] = temp;

            // Update UI
            updateUiTaskList();

            // Always highlight the first incomplete task after moving
            const firstIncompleteTask = parent.children.find(task => !task.completed);
            if (firstIncompleteTask) {
                setCurrentTask(firstIncompleteTask.id);
            } else {
                // If all tasks are completed, highlight the first task
                setCurrentTask(parent.children[0].id);
            }
        }
    }

    onMoveDownClick() {
        const parent = getTaskById(this.parentId);
        const index = parent.children.indexOf(this);
        if (index < (parent.children.length - 1)) {
            // Swap positions
            let temp = parent.children[index + 1];
            parent.children[index + 1] = parent.children[index];
            parent.children[index] = temp;

            // Update UI
            updateUiTaskList();

            // Always highlight the first incomplete task after moving
            const firstIncompleteTask = parent.children.find(task => !task.completed);
            if (firstIncompleteTask) {
                setCurrentTask(firstIncompleteTask.id);
            } else {
                // If all tasks are completed, highlight the first task
                setCurrentTask(parent.children[0].id);
            }
        }
    }

    onAddClick() {
        const index = this.getIndex();
        const parent = getTaskById(this.parentId);

        // Add the new task and get a reference to it
        const newTask = parent.addTask('', index + 1);

        updateUiTaskList();

        // Highlight the newly added task
        setCurrentTask(newTask.id);
    }

    toSaveStateRecurse() {
        let children = [];
        if (this.children.length > 0) {
            for (const child of this.children) {
                children.push(child.toSaveStateRecurse());
            }
        }
        return {
            'id': this.id,
            'description': this.description,
            'completed': this.completed,
            'parentId': this.parentId,
            'children': children,
            'completionDate': this.completionDate,
        };
    }
}

//###############################//
//#       Custom Prompts        #//
//###############################//

function onEditPromptClick() {
    let popupText = '';
    popupText += `
    <div class="objective_prompt_modal">
        <div class="objective_prompt_block justifyCenter">
            <label for="objective-custom-prompt-select">Custom Prompt Select</label>
            <select id="objective-custom-prompt-select" class="text_pole"><select>
        </div>
        <div class="objective_prompt_block justifyCenter">
            <input id="objective-custom-prompt-new" class="menu_button" type="submit" value="New Prompt" />
            <input id="objective-custom-prompt-save" class="menu_button" type="submit" value="Update Prompt" />
            <input id="objective-custom-prompt-delete" class="menu_button" type="submit" value="Delete Prompt" />
        </div>
        <hr class="m-t-1 m-b-1">
        <small>Edit prompts used by Objective for this session. You can use {{objective}} or {{task}} plus any other standard template variables. Save template to persist changes.</small>
        <hr class="m-t-1 m-b-1">
        <div>
            <label for="objective-prompt-generate">Generation Prompt</label>
            <textarea id="objective-prompt-generate" type="text" class="text_pole textarea_compact" rows="6"></textarea>
            <label for="objective-prompt-additional">Additional Tasks Prompt</label>
            <textarea id="objective-prompt-additional" type="text" class="text_pole textarea_compact" rows="6"></textarea>
            <label for="objective-prompt-check">Completion Check Prompt</label>
            <textarea id="objective-prompt-check" type="text" class="text_pole textarea_compact" rows="6"></textarea>
            <label for="objective-prompt-extension-prompt">Injected Prompt</label>
            <textarea id="objective-prompt-extension-prompt" type="text" class="text_pole textarea_compact" rows="6"></textarea>
            <label for="objective-prompt-completed-tasks">Completed Tasks Prompt</label>
            <textarea id="objective-prompt-completed-tasks" type="text" class="text_pole textarea_compact" rows="6"></textarea>
            <label for="objective-prompt-upcoming-tasks">Upcoming Tasks Prompt</label>
            <textarea id="objective-prompt-upcoming-tasks" type="text" class="text_pole textarea_compact" rows="6"></textarea>
        </div>
    </div>`;
    callGenericPopup(popupText, POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true, wide: true });
    populateCustomPrompts(selectedCustomPrompt);

    // Set current values
    $('#objective-prompt-generate').val(objectivePrompts.createTask);
    $('#objective-prompt-additional').val(objectivePrompts.additionalTasks || defaultPrompts.additionalTasks);
    $('#objective-prompt-check').val(objectivePrompts.checkTaskCompleted);
    $('#objective-prompt-extension-prompt').val(objectivePrompts.currentTask);
    $('#objective-prompt-completed-tasks').val(objectivePrompts.completedTasks || defaultPrompts.completedTasks);
    $('#objective-prompt-upcoming-tasks').val(objectivePrompts.upcomingTasks || defaultPrompts.upcomingTasks);

    // Handle value updates
    $('#objective-prompt-generate').on('input', () => {
        objectivePrompts.createTask = String($('#objective-prompt-generate').val());
        saveState();
        setCurrentTask();
    });
    $('#objective-prompt-additional').on('input', () => {
        objectivePrompts.additionalTasks = String($('#objective-prompt-additional').val());
        saveState();
        setCurrentTask();
    });
    $('#objective-prompt-check').on('input', () => {
        objectivePrompts.checkTaskCompleted = String($('#objective-prompt-check').val());
        saveState();
        setCurrentTask();
    });
    $('#objective-prompt-extension-prompt').on('input', () => {
        objectivePrompts.currentTask = String($('#objective-prompt-extension-prompt').val());
        saveState();
        setCurrentTask();
    });
    $('#objective-prompt-completed-tasks').on('input', () => {
        objectivePrompts.completedTasks = String($('#objective-prompt-completed-tasks').val());
        saveState();
        setCurrentTask();
    });
    $('#objective-prompt-upcoming-tasks').on('input', () => {
        objectivePrompts.upcomingTasks = String($('#objective-prompt-upcoming-tasks').val());
        saveState();
        setCurrentTask();
    });

    // Handle new
    $('#objective-custom-prompt-new').on('click', () => {
        newCustomPrompt();
    });

    // Handle save
    $('#objective-custom-prompt-save').on('click', () => {
        saveCustomPrompt();
    });

    // Handle delete
    $('#objective-custom-prompt-delete').on('click', () => {
        deleteCustomPrompt();
    });

    // Handle load
    $('#objective-custom-prompt-select').on('change', loadCustomPrompt);
}

async function newCustomPrompt() {
    const customPromptName = await Popup.show.input('Custom Prompt name', null);

    if (!customPromptName) {
        toastr.warning('Please set custom prompt name to save.');
        return;
    }
    if (customPromptName == 'default') {
        toastr.error('Cannot save over default prompt');
        return;
    }

    // Make sure we have all prompt types, including additionalTasks
    if (!objectivePrompts.additionalTasks) {
        objectivePrompts.additionalTasks = defaultPrompts.additionalTasks;
    }

    // Make sure we have the completed tasks prompt
    if (!objectivePrompts.completedTasks) {
        objectivePrompts.completedTasks = defaultPrompts.completedTasks;
    }

    // Make sure we have the upcoming tasks prompt
    if (!objectivePrompts.upcomingTasks) {
        objectivePrompts.upcomingTasks = defaultPrompts.upcomingTasks;
    }

    extension_settings.objective.customPrompts[customPromptName] = {};
    Object.assign(extension_settings.objective.customPrompts[customPromptName], objectivePrompts);
    saveSettingsDebounced();
    populateCustomPrompts(customPromptName);
}

function saveCustomPrompt() {
    const customPromptName = String($('#objective-custom-prompt-select').find(':selected').val());
    if (customPromptName == 'default') {
        toastr.error('Cannot save over default prompt');
        return;
    }
    Object.assign(extension_settings.objective.customPrompts[customPromptName], objectivePrompts);
    saveSettingsDebounced();
    populateCustomPrompts(customPromptName);
    toastr.success('Prompt saved as ' + customPromptName);
}

async function deleteCustomPrompt() {
    const customPromptName = String($('#objective-custom-prompt-select').find(':selected').val());

    if (customPromptName == 'default') {
        toastr.error('Cannot delete default prompt');
        return;
    }

    const confirmation = await Popup.show.confirm('Are you sure you want to delete this prompt?', null);

    if (!confirmation) {
        return;
    }

    delete extension_settings.objective.customPrompts[customPromptName];
    saveSettingsDebounced();
    selectedCustomPrompt = 'default';
    populateCustomPrompts(selectedCustomPrompt);
    loadCustomPrompt();
}

function loadCustomPrompt() {
    const optionSelected = String($('#objective-custom-prompt-select').find(':selected').val());
    Object.assign(objectivePrompts, extension_settings.objective.customPrompts[optionSelected]);
    selectedCustomPrompt = optionSelected;

    $('#objective-prompt-generate').val(objectivePrompts.createTask).trigger('input');
    $('#objective-prompt-additional').val(objectivePrompts.additionalTasks || defaultPrompts.additionalTasks).trigger('input');
    $('#objective-prompt-check').val(objectivePrompts.checkTaskCompleted);
    $('#objective-prompt-extension-prompt').val(objectivePrompts.currentTask);
    $('#objective-prompt-completed-tasks').val(objectivePrompts.completedTasks || defaultPrompts.completedTasks);
    $('#objective-prompt-upcoming-tasks').val(objectivePrompts.upcomingTasks || defaultPrompts.upcomingTasks);

    saveState();
    setCurrentTask();
}

/**
 * Populate the custom prompt select dropdown with saved prompts.
 * @param {string} selected Optional selected prompt
 */
function populateCustomPrompts(selected) {
    if (!selected) {
        selected = selectedCustomPrompt || 'default';
    }

    // Populate saved prompts
    $('#objective-custom-prompt-select').empty();
    for (const customPromptName in extension_settings.objective.customPrompts) {
        const option = document.createElement('option');
        option.innerText = customPromptName;
        option.value = customPromptName;
        option.selected = customPromptName === selected;
        $('#objective-custom-prompt-select').append(option);
    }
}

//###############################//
//#       UI AND Settings       #//
//###############################//


const defaultSettings = {
    currentObjectiveId: null,
    taskTree: null,
    chatDepth: 2,
    checkFrequency: 3,
    hideTasks: false,
    showCompletedTasks: false,
    completedTasksCount: 3,
    recentlyCompletedTasks: [],
    showUpcomingTasks: false,
    upcomingTasksCount: 3,
    upcomingTasks: [],
    prompts: defaultPrompts,
    templates: {},
    completionHistory: [],
    statistics: {
        tasksCompleted: 0,
        tasksCreated: 0,
        objectivesCompleted: 0,
        lastCompletionDate: null
    }
};

// Convenient single call. Not much at the moment.
function resetState() {
    lastMessageWasSwipe = false;
    recentlyCompletedTasks = [];
    upcomingTasks = [];
    updateCompletedTasksCount();
    updateUpcomingTasksCount();
    loadSettings();
}

//
function saveState() {
    const context = getContext();

    if (currentChatId == '') {
        currentChatId = context.chatId;
    }

    chat_metadata['objective'] = {
        currentObjectiveId: currentObjective.id,
        taskTree: taskTree.toSaveStateRecurse(),
        checkFrequency: $('#objective-check-frequency').val(),
        chatDepth: $('#objective-chat-depth').val(),
        hideTasks: $('#objective-hide-tasks').prop('checked'),
        showCompletedTasks: $('#objective-show-completed').prop('checked'),
        completedTasksCount: $('#objective-completed-count').val(),
        recentlyCompletedTasks: recentlyCompletedTasks,
        showUpcomingTasks: $('#objective-show-upcoming').prop('checked'),
        upcomingTasksCount: $('#objective-upcoming-count').val(),
        upcomingTasks: upcomingTasks,
        prompts: objectivePrompts,
        selectedCustomPrompt: selectedCustomPrompt,
        completionHistory: chat_metadata.objective.completionHistory,
        statistics: chat_metadata.objective.statistics
    };

    saveMetadataDebounced();
}

// Dump core state
function debugObjectiveExtension() {
    console.log(JSON.stringify({
        'currentTask': currentTask,
        'currentObjective': currentObjective,
        'taskTree': taskTree.toSaveStateRecurse(),
        'chat_metadata': chat_metadata['objective'],
        'extension_settings': extension_settings['objective'],
        'prompts': objectivePrompts,
    }, null, 2));
}

globalThis.debugObjectiveExtension = debugObjectiveExtension;


// Populate UI task list
function updateUiTaskList() {
    // Clear existing task list
    $('#objective-tasks').empty();

    // Remove existing filter/sort controls to prevent duplication
    $('#objective-filter-sort').remove();

    // Show button to navigate back to parent objective if parent exists
    if (currentObjective) {
        if (currentObjective.parentId !== '') {
            $('#objective-parent').show();
        } else {
            $('#objective-parent').hide();
        }
    }

    // Add progress bar
    updateProgressBar();

    // Update objective text
    $('#objective-text').val(currentObjective.description);

    // Show/hide Generate More Tasks button based on whether there are existing tasks
    if (currentObjective && currentObjective.children.length > 0) {
        $('#objective-generate-more').show();
    } else {
        $('#objective-generate-more').hide();
    }

    if (currentObjective.children.length > 0) {
        // Show all tasks in their original order
        for (const task of currentObjective.children) {
            task.addUiElement();
        }

        // Find the first incomplete task in the current objective's children
        const firstIncompleteTask = currentObjective.children.find(task => !task.completed);
        if (firstIncompleteTask) {
            setCurrentTask(firstIncompleteTask.id, true);
        } else if (currentObjective.children.length > 0) {
            // If all tasks are completed, highlight the first task
            setCurrentTask(currentObjective.children[0].id, true);
        }
    } else {
        // Show button to add tasks if there are none
        $('#objective-tasks').append(`
        <input id="objective-task-add-first" type="button" class="menu_button" value="Add Task">
        `);
        $('#objective-task-add-first').on('click', () => {
            const newTask = currentObjective.addTask('');
            updateUiTaskList();
            setCurrentTask(newTask.id);
        });
    }
}

// Calculate and update the progress bar
function updateProgressBar() {
    if (!currentObjective || currentObjective.children.length === 0) {
        // No tasks to show progress for
        $('#objective-progress-container').hide();
        return;
    }

    // Count completed tasks
    let completedCount = 0;
    let totalCount = currentObjective.children.length;

    for (const task of currentObjective.children) {
        if (task.completed) {
            completedCount++;
        }
    }

    const progressPercent = Math.round((completedCount / totalCount) * 100);

    // Create or update progress bar
    if ($('#objective-progress-container').length === 0) {
        // Create new progress bar if it doesn't exist
        $('#objective-tasks').before(`
            <div id="objective-progress-container" class="flex-container flexColumn marginTop10 marginBottom20">
                <div class="flex-container flexRow alignItemsCenter">
                    <div class="flex1">Progress: ${completedCount}/${totalCount} tasks (${progressPercent}%)</div>
                </div>
                <div class="progress-bar-container">
                    <div id="objective-progress-bar" class="progress-bar" style="width: ${progressPercent}%"></div>
                </div>
            </div>
        `);
    } else {
        // Update existing progress bar
        $('#objective-progress-container').show();
        $('#objective-progress-container .flex1').text(`Progress: ${completedCount}/${totalCount} tasks (${progressPercent}%)`);
        $('#objective-progress-bar').css('width', `${progressPercent}%`);
    }
}

function onParentClick() {
    currentObjective = getTaskById(currentObjective.parentId);
    updateUiTaskList();
    setCurrentTask();
}

// Trigger creation of new tasks with given objective.
async function onGenerateObjectiveClick() {
    await generateTasks();
    saveState();
}

// Trigger creation of additional tasks for the current objective
async function onGenerateAdditionalTasksClick() {
    await generateAdditionalTasks();
    saveState();
}

// Update extension prompts
function onChatDepthInput() {
    saveState();
    setCurrentTask(); // Ensure extension prompt is updated
}

function onObjectiveTextFocusOut() {
    if (currentObjective) {
        currentObjective.description = $('#objective-text').val();
        saveState();
    }
}

// Update how often we check for task completion
function onCheckFrequencyInput() {
    checkCounter = Number($('#objective-check-frequency').val());
    $('#objective-counter').text(checkCounter);
    saveState();
}

function onHideTasksInput() {
    $('#objective-tasks').prop('hidden', $('#objective-hide-tasks').prop('checked'));
    saveState();
}

function onClearTasksClick() {
    if (currentObjective) {
        currentObjective.children = [];
        // Clear recently completed tasks as well
        recentlyCompletedTasks = [];

        // Update the UI with the new count
        updateCompletedTasksCount();

        updateUiTaskList();
        setCurrentTask();
        saveState();
        toastr.success('All tasks cleared');
    }
}

function loadTaskChildrenRecurse(savedTask) {
    let tempTaskTree = new ObjectiveTask({
        id: savedTask.id,
        description: savedTask.description,
        completed: savedTask.completed,
        parentId: savedTask.parentId,
        completionDate: savedTask.completionDate || null,
    });
    for (const task of savedTask.children) {
        const childTask = loadTaskChildrenRecurse(task);
        tempTaskTree.children.push(childTask);
    }
    return tempTaskTree;
}

function loadSettings() {
    // Load/Init settings for chatId
    currentChatId = getContext().chatId;

    // Reset Objectives and Tasks in memory
    taskTree = null;
    currentObjective = null;

    // Init extension settings
    if (Object.keys(extension_settings.objective).length === 0) {
        Object.assign(extension_settings.objective, {
            'customPrompts': { 'default': defaultPrompts },
            'globalStatistics': {
                tasksCompleted: 0,
                tasksCreated: 0,
                objectivesCompleted: 0,
                lastCompletionDate: null
            }
        });
    }

    // Generate a temporary chatId if none exists
    if (currentChatId == undefined) {
        currentChatId = 'no-chat-id';
    }

    // Migrate existing settings
    if (currentChatId in extension_settings.objective) {
        // TODO: Remove this soon
        chat_metadata['objective'] = extension_settings.objective[currentChatId];
        delete extension_settings.objective[currentChatId];
    }

    if (!('objective' in chat_metadata)) {
        Object.assign(chat_metadata, { objective: defaultSettings });
    }

    // Migrate legacy flat objective to new objectiveTree and currentObjective
    if ('objective' in chat_metadata.objective) {

        // Create root objective from legacy objective
        taskTree = new ObjectiveTask({ id: 0, description: chat_metadata.objective.objective });
        currentObjective = taskTree;

        // Populate root objective tree from legacy tasks
        if ('tasks' in chat_metadata.objective) {
            let idIncrement = 0;
            taskTree.children = chat_metadata.objective.tasks.map(task => {
                idIncrement += 1;
                return new ObjectiveTask({
                    id: idIncrement,
                    description: task.description,
                    completed: task.completed,
                    parentId: taskTree.id,
                });
            });
        }
        saveState();
        delete chat_metadata.objective.objective;
        delete chat_metadata.objective.tasks;
    } else {
        // Load Objectives and Tasks (Normal path)
        if (chat_metadata.objective.taskTree) {
            taskTree = loadTaskChildrenRecurse(chat_metadata.objective.taskTree);
        }
    }

    // Make sure there's a root task
    if (!taskTree) {
        taskTree = new ObjectiveTask({ id: 0, description: $('#objective-text').val() });
    }

    currentObjective = taskTree;
    checkCounter = chat_metadata['objective'].checkFrequency;
    objectivePrompts = chat_metadata['objective'].prompts;

    // Load recently completed tasks
    recentlyCompletedTasks = chat_metadata.objective.recentlyCompletedTasks || [];

    // Load upcoming tasks
    upcomingTasks = chat_metadata.objective.upcomingTasks || [];

    // Ensure all prompt types exist
    if (!objectivePrompts.additionalTasks) {
        objectivePrompts.additionalTasks = defaultPrompts.additionalTasks;
    }

    if (!objectivePrompts.completedTasks) {
        objectivePrompts.completedTasks = defaultPrompts.completedTasks;
    }

    if (!objectivePrompts.upcomingTasks) {
        objectivePrompts.upcomingTasks = defaultPrompts.upcomingTasks;
    }

    selectedCustomPrompt = chat_metadata['objective'].selectedCustomPrompt || 'default';

    // Update UI elements
    $('#objective-counter').text(checkCounter);
    $('#objective-text').text(taskTree.description);
    updateUiTaskList();
    $('#objective-chat-depth').val(chat_metadata['objective'].chatDepth);
    $('#objective-check-frequency').val(chat_metadata['objective'].checkFrequency);
    $('#objective-hide-tasks').prop('checked', chat_metadata['objective'].hideTasks);
    $('#objective-tasks').prop('hidden', $('#objective-hide-tasks').prop('checked'));

    // Set recently completed tasks UI elements
    $('#objective-show-completed').prop('checked', chat_metadata.objective.showCompletedTasks || false);
    $('#objective-completed-count').val(chat_metadata.objective.completedTasksCount || 3);

    // Set upcoming tasks UI elements
    $('#objective-show-upcoming').prop('checked', chat_metadata.objective.showUpcomingTasks || false);
    $('#objective-upcoming-count').val(chat_metadata.objective.upcomingTasksCount || 3);

    // Update the UI with the count of recently completed tasks
    updateCompletedTasksCount();

    // Update the UI with the count of upcoming tasks
    updateUpcomingTasksCount();

    setCurrentTask(null, true);
}

function addManualTaskCheckUi() {
    const getWandContainer = () => $(document.getElementById('objective_wand_container') ?? document.getElementById('extensionsMenu'));
    const container = getWandContainer();
    container.append(`
        <div id="objective-task-manual-check-menu-item" class="list-group-item flex-container flexGap5">
            <div id="objective-task-manual-check" class="extensionsMenuExtensionButton fa-regular fa-square-check"/></div>
            Manual Task Check
        </div>`);
    container.append(`
        <div id="objective-task-complete-current-menu-item" class="list-group-item flex-container flexGap5">
            <div id="objective-task-complete-current" class="extensionsMenuExtensionButton fa-regular fa-list-check"/></div>
            Complete Current Task
        </div>`);
    $('#objective-task-manual-check-menu-item').attr('title', 'Trigger AI check of completed tasks').on('click', checkTaskCompleted);
    $('#objective-task-complete-current-menu-item').attr('title', 'Mark the current task as completed.').on('click', markTaskCompleted);
}

function doPopout(e) {
    const target = e.target;

    //repurposes the zoomed avatar template to server as a floating div
    if ($('#objectiveExtensionPopout').length === 0) {
        console.debug('did not see popout yet, creating');
        const originalHTMLClone = $(target).parent().parent().parent().find('.inline-drawer-content').html();
        const originalElement = $(target).parent().parent().parent().find('.inline-drawer-content');
        const template = $('#zoomed_avatar_template').html();
        const controlBarHtml = `<div class="panelControlBar flex-container">
        <div id="objectiveExtensionPopoutheader" class="fa-solid fa-grip drag-grabber hoverglow"></div>
        <div id="objectiveExtensionPopoutClose" class="fa-solid fa-circle-xmark hoverglow dragClose"></div>
    </div>`;
        const newElement = $(template);
        newElement.attr('id', 'objectiveExtensionPopout')
            .removeClass('zoomed_avatar')
            .addClass('draggable')
            .empty();
        originalElement.html('<div class="flex-container alignitemscenter justifyCenter wide100p"><small>Currently popped out</small></div>');
        newElement.append(controlBarHtml).append(originalHTMLClone);
        $('#movingDivs').append(newElement);
        $('#objectiveExtensionDrawerContents').addClass('scrollY');
        loadSettings();
        loadMovingUIState();

        $('#objectiveExtensionPopout').css('display', 'flex').fadeIn(animation_duration);
        dragElement(newElement);

        //setup listener for close button to restore extensions menu
        $('#objectiveExtensionPopoutClose').off('click').on('click', function () {
            $('#objectiveExtensionDrawerContents').removeClass('scrollY');
            const objectivePopoutHTML = $('#objectiveExtensionDrawerContents');
            $('#objectiveExtensionPopout').fadeOut(animation_duration, () => {
                originalElement.empty();
                originalElement.append(objectivePopoutHTML);
                $('#objectiveExtensionPopout').remove();
            });
            loadSettings();
        });
    } else {
        console.debug('saw existing popout, removing');
        $('#objectiveExtensionPopout').fadeOut(animation_duration, () => { $('#objectiveExtensionPopoutClose').trigger('click'); });
    }
}

// Add template management UI
function onManageTemplatesClick() {
    let popupText = '';
    popupText += `
    <div class="objective_templates_modal">
        <div class="objective_prompt_block justifyCenter">
            <label for="objective-template-select">Task Templates</label>
            <select id="objective-template-select" class="text_pole"><select>
        </div>
        <div class="objective_prompt_block justifyCenter">
            <input id="objective-template-save" class="menu_button" type="submit" value="Save Current Tasks as Template" />
            <input id="objective-template-load" class="menu_button" type="submit" value="Load Template" />
            <input id="objective-template-delete" class="menu_button" type="submit" value="Delete Template" />
        </div>
        <div class="objective_prompt_block justifyCenter">
            <input id="objective-template-export" class="menu_button" type="submit" value="Export Selected Template" />
            <input id="objective-template-import" class="menu_button" type="submit" value="Import Templates" />
        </div>
        <hr class="m-t-1 m-b-1">
        <small>Save your current task structure as a template to reuse later. Templates include all tasks and subtasks but not their completion status.</small>
        <hr class="m-t-1 m-b-1">
        <div id="objective-template-preview" class="objective_template_preview">
            <p>Select a template to preview</p>
        </div>
    </div>`;

    callGenericPopup(popupText, POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true, wide: true });
    populateTemplateSelect();

    // Handle save
    $('#objective-template-save').on('click', saveTaskTemplate);

    // Handle load
    $('#objective-template-load').on('click', loadTaskTemplate);

    // Handle delete
    $('#objective-template-delete').on('click', deleteTaskTemplate);

    // Handle export
    $('#objective-template-export').on('click', exportTaskTemplates);

    // Handle import
    $('#objective-template-import').on('click', importTaskTemplates);

    // Handle preview on select change
    $('#objective-template-select').on('change', previewTaskTemplate);
}

// Save current tasks as a template
async function saveTaskTemplate() {
    if (!currentObjective || currentObjective.children.length === 0) {
        toastr.warning('No tasks to save as template');
        return;
    }

    const templateName = await Popup.show.input('Template name', null);

    if (!templateName) {
        toastr.warning('Please provide a template name');
        return;
    }

    // Initialize templates object if it doesn't exist
    if (!extension_settings.objective.templates) {
        extension_settings.objective.templates = {};
    }

    // Save template without completion status
    const templateTasks = JSON.parse(JSON.stringify(currentObjective.children));
    clearCompletionStatusRecursive(templateTasks);

    extension_settings.objective.templates[templateName] = {
        description: currentObjective.description,
        tasks: templateTasks
    };

    saveSettingsDebounced();
    populateTemplateSelect(templateName);
    toastr.success(`Template "${templateName}" saved`);
}

// Clear completion status from all tasks recursively
function clearCompletionStatusRecursive(tasks) {
    for (const task of tasks) {
        task.completed = false;
        if (task.children && task.children.length > 0) {
            clearCompletionStatusRecursive(task.children);
        }
    }
}

// Load selected template
async function loadTaskTemplate() {
    const templateName = $('#objective-template-select').val();

    if (!templateName) {
        toastr.warning('Please select a template');
        return;
    }

    // Confirm if current tasks exist
    if (currentObjective.children.length > 0) {
        const confirmation = await Popup.show.confirm(
            'This will replace your current tasks. Continue?',
            null
        );

        if (!confirmation) {
            return;
        }
    }

    const template = extension_settings.objective.templates[templateName];

    if (!template) {
        toastr.error('Template not found');
        return;
    }

    // Update objective description if it exists in template
    if (template.description) {
        currentObjective.description = template.description;
    }

    // Clear current tasks and load from template
    currentObjective.children = [];

    // Deep clone the template tasks to avoid reference issues
    const templateTasks = JSON.parse(JSON.stringify(template.tasks));

    // Rebuild task objects with proper parentId references
    for (const taskData of templateTasks) {
        const task = new ObjectiveTask({
            description: taskData.description,
            parentId: currentObjective.id
        });

        if (taskData.children && taskData.children.length > 0) {
            loadChildTasksRecursive(task, taskData.children);
        }

        currentObjective.children.push(task);
    }

    updateUiTaskList();
    setCurrentTask();
    saveState();

    toastr.success(`Template "${templateName}" loaded`);
    $('#objective-template-select').closest('.popup_wrapper').find('.popup_cross').click();
}

// Recursively load child tasks
function loadChildTasksRecursive(parentTask, childrenData) {
    for (const childData of childrenData) {
        const childTask = new ObjectiveTask({
            description: childData.description,
            parentId: parentTask.id
        });

        if (childData.children && childData.children.length > 0) {
            loadChildTasksRecursive(childTask, childData.children);
        }

        parentTask.children.push(childTask);
    }
}

// Delete selected template
async function deleteTaskTemplate() {
    const templateName = $('#objective-template-select').val();

    if (!templateName) {
        toastr.warning('Please select a template');
        return;
    }

    const confirmation = await Popup.show.confirm(
        `Are you sure you want to delete template "${templateName}"?`,
        null
    );

    if (!confirmation) {
        return;
    }

    delete extension_settings.objective.templates[templateName];
    saveSettingsDebounced();
    populateTemplateSelect();
    $('#objective-template-preview').html('<p>Select a template to preview</p>');
    toastr.success(`Template "${templateName}" deleted`);
}

// Preview selected template
function previewTaskTemplate() {
    const templateName = $('#objective-template-select').val();

    if (!templateName) {
        $('#objective-template-preview').html('<p>Select a template to preview</p>');
        return;
    }

    const template = extension_settings.objective.templates[templateName];

    if (!template) {
        $('#objective-template-preview').html('<p>Template not found</p>');
        return;
    }

    let previewHtml = `<h4>${template.description || 'No description'}</h4><ul>`;

    for (const task of template.tasks) {
        previewHtml += `<li>${task.description}`;
        if (task.children && task.children.length > 0) {
            previewHtml += renderTaskChildrenPreview(task.children);
        }
        previewHtml += '</li>';
    }

    previewHtml += '</ul>';
    $('#objective-template-preview').html(previewHtml);
}

// Render child tasks for preview
function renderTaskChildrenPreview(children) {
    let html = '<ul>';

    for (const child of children) {
        html += `<li>${child.description}`;
        if (child.children && child.children.length > 0) {
            html += renderTaskChildrenPreview(child.children);
        }
        html += '</li>';
    }

    html += '</ul>';
    return html;
}

// Populate template select dropdown
function populateTemplateSelect(selected) {
    $('#objective-template-select').empty();

    // Add empty option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.innerText = '-- Select Template --';
    $('#objective-template-select').append(emptyOption);

    // Add templates
    if (extension_settings.objective.templates) {
        for (const templateName in extension_settings.objective.templates) {
            const option = document.createElement('option');
            option.value = templateName;
            option.innerText = templateName;
            option.selected = templateName === selected;
            $('#objective-template-select').append(option);
        }
    }
}

// Add task to completion history
function addToCompletionHistory(task) {
    if (!chat_metadata.objective.completionHistory) {
        chat_metadata.objective.completionHistory = [];
    }

    // Add to history with timestamp
    chat_metadata.objective.completionHistory.push({
        id: task.id,
        description: task.description,
        completionDate: task.completionDate,
        objectiveDescription: currentObjective.description
    });

    // Limit history size to prevent metadata from growing too large
    if (chat_metadata.objective.completionHistory.length > 100) {
        chat_metadata.objective.completionHistory =
            chat_metadata.objective.completionHistory.slice(-100);
    }

    saveMetadataDebounced();
}

// Update task statistics
function updateStatistics(taskCompleted = false) {
    // Initialize chat-specific statistics if they don't exist
    if (!chat_metadata.objective.statistics) {
        chat_metadata.objective.statistics = {
            tasksCompleted: 0,
            tasksCreated: 0,
            objectivesCompleted: 0,
            lastCompletionDate: null
        };
    }

    // Initialize global statistics if they don't exist
    if (!extension_settings.objective.globalStatistics) {
        extension_settings.objective.globalStatistics = {
            tasksCompleted: 0,
            tasksCreated: 0,
            objectivesCompleted: 0,
            lastCompletionDate: null
        };
    }

    // Update relevant statistics
    if (taskCompleted) {
        // Update chat-specific statistics
        chat_metadata.objective.statistics.tasksCompleted++;
        chat_metadata.objective.statistics.lastCompletionDate = new Date().toISOString();

        // Update global statistics
        extension_settings.objective.globalStatistics.tasksCompleted++;
        extension_settings.objective.globalStatistics.lastCompletionDate = new Date().toISOString();

        // Check if all tasks in the current objective are completed
        const allCompleted = currentObjective.children.every(task => task.completed);
        if (allCompleted && currentObjective.children.length > 0) {
            chat_metadata.objective.statistics.objectivesCompleted++;
            extension_settings.objective.globalStatistics.objectivesCompleted++;
        }

        // Save global statistics
        saveSettingsDebounced();
    }

    saveMetadataDebounced();
}

// Show task statistics
function showStatistics() {
    // Initialize chat-specific statistics if they don't exist
    if (!chat_metadata.objective.statistics) {
        chat_metadata.objective.statistics = {
            tasksCompleted: 0,
            tasksCreated: 0,
            objectivesCompleted: 0,
            lastCompletionDate: null
        };
    }

    // Initialize global statistics if they don't exist
    if (!extension_settings.objective.globalStatistics) {
        extension_settings.objective.globalStatistics = {
            tasksCompleted: 0,
            tasksCreated: 0,
            objectivesCompleted: 0,
            lastCompletionDate: null
        };
    }

    // Count total tasks in the current tree
    const totalTasks = countAllTasks(taskTree);

    // Count completed tasks in the current tree
    const completedTasks = countCompletedTasks(taskTree);

    // Calculate completion rate
    const completionRate = totalTasks > 0
        ? Math.round((completedTasks / totalTasks) * 100)
        : 0;

    // Format last completion date for chat-specific statistics
    let lastCompletionText = 'Never';
    if (chat_metadata.objective.statistics.lastCompletionDate) {
        const lastDate = new Date(chat_metadata.objective.statistics.lastCompletionDate);
        lastCompletionText = lastDate.toLocaleString();
    }

    // Format last completion date for global statistics
    let globalLastCompletionText = 'Never';
    if (extension_settings.objective.globalStatistics.lastCompletionDate) {
        const globalLastDate = new Date(extension_settings.objective.globalStatistics.lastCompletionDate);
        globalLastCompletionText = globalLastDate.toLocaleString();
    }

    // Create statistics popup
    const popupText = `
    <div class="objective_statistics_modal">
        <h3 class="stats-header">Task Statistics</h3>
        
        <div class="stats-container">
            <div class="stats-section">
                <h4 class="stats-section-header">Current Objective</h4>
                <div class="stats-grid">
                    <div class="stats-label">Total Tasks:</div>
                    <div class="stats-value">${totalTasks}</div>
                    
                    <div class="stats-label">Completed Tasks:</div>
                    <div class="stats-value">${completedTasks}</div>
                    
                    <div class="stats-label">Completion Rate:</div>
                    <div class="stats-value">${completionRate}%</div>
                </div>
            </div>
            
            <div class="stats-section">
                <h4 class="stats-section-header">Current Chat Statistics</h4>
                <div class="stats-grid">
                    <div class="stats-label">Tasks Completed:</div>
                    <div class="stats-value">${chat_metadata.objective.statistics.tasksCompleted}</div>
                    
                    <div class="stats-label">Objectives Completed:</div>
                    <div class="stats-value">${chat_metadata.objective.statistics.objectivesCompleted}</div>
                    
                    <div class="stats-label">Last Completion:</div>
                    <div class="stats-value">${lastCompletionText}</div>
                </div>
            </div>
            
            <div class="stats-section">
                <h4 class="stats-section-header">Global Statistics</h4>
                <div class="stats-grid">
                    <div class="stats-label">Total Tasks Completed:</div>
                    <div class="stats-value">${extension_settings.objective.globalStatistics.tasksCompleted}</div>
                    
                    <div class="stats-label">Total Objectives Completed:</div>
                    <div class="stats-value">${extension_settings.objective.globalStatistics.objectivesCompleted}</div>
                    
                    
                    <div class="stats-label">Total Tasks Created:</div>
                    <div class="stats-value">${extension_settings.objective.globalStatistics.tasksCreated}</div>
                    
                    <div class="stats-label">Last Completion:</div>
                    <div class="stats-value">${globalLastCompletionText}</div>
                </div>
            </div>
        </div>
        
        <div class="stats-section completion-history-section">
            <h4 class="stats-section-header">Recent Completions</h4>
            <div class="objective_completion_history">
                ${generateCompletionHistoryHtml()}
            </div>
        </div>
    </div>`;

    callGenericPopup(popupText, POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true });
}

// Generate HTML for completion history
function generateCompletionHistoryHtml() {
    if (!chat_metadata.objective.completionHistory ||
        chat_metadata.objective.completionHistory.length === 0) {
        return '<p>No completed tasks yet</p>';
    }

    // Get last 10 completed tasks, most recent first
    const recentCompletions = [...chat_metadata.objective.completionHistory]
        .reverse()
        .slice(0, 10);

    let html = '<ul class="objective_history_list">';

    for (const completion of recentCompletions) {
        const date = new Date(completion.completionDate);
        const formattedDate = date.toLocaleString();

        html += `
        <li class="objective_history_item">
            <div class="objective_history_task">${completion.description}</div>
            <div class="objective_history_objective">Objective: ${completion.objectiveDescription}</div>
            <div class="objective_history_date">${formattedDate}</div>
        </li>`;
    }

    html += '</ul>';
    return html;
}

// Count all tasks in a task tree
function countAllTasks(task) {
    let count = 0;

    // Don't count the root task
    if (task.parentId !== '') {
        count = 1;
    }

    // Count all children
    for (const child of task.children) {
        count += countAllTasks(child);
    }

    return count;
}

// Count completed tasks in a task tree
function countCompletedTasks(task) {
    let count = 0;

    // Don't count the root task
    if (task.parentId !== '' && task.completed) {
        count = 1;
    }

    // Count all completed children
    for (const child of task.children) {
        count += countCompletedTasks(child);
    }

    return count;
}

// Export tasks to JSON file
async function exportTasks() {
    if (!currentObjective || currentObjective.children.length === 0) {
        toastr.warning('No tasks to export');
        return;
    }

    // Prepare export data
    const exportData = {
        description: currentObjective.description,
        tasks: currentObjective.children.map(task => task.toSaveStateRecurse()),
        exportDate: new Date().toISOString(),
        version: '1.0'
    };

    // Convert to JSON string
    const jsonString = JSON.stringify(exportData, null, 2);

    // Create default filename based on objective description
    let defaultFilename = 'objective-tasks.json';
    if (currentObjective.description) {
        // Create a safe filename from the objective description
        defaultFilename = currentObjective.description
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 30) + '.json';
    }

    // Ask user for custom filename
    let filename = await Popup.show.input('Enter filename for export', defaultFilename);

    // If user cancels or provides empty filename, use the default
    if (!filename) {
        filename = defaultFilename;
    }

    // Ensure filename has .json extension
    if (!filename.toLowerCase().endsWith('.json')) {
        filename += '.json';
    }

    // Create and trigger download link
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // Clean up
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);

    toastr.success(`Tasks exported as "${filename}"`);
}

// Import tasks from JSON file
async function importTasks() {
    // Create file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    // Handle file selection
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Read file
            const text = await file.text();
            const importData = JSON.parse(text);

            // Validate import data
            if (!importData.tasks || !Array.isArray(importData.tasks)) {
                throw new Error('Invalid import file format');
            }

            // Confirm if current tasks exist
            if (currentObjective.children.length > 0) {
                const confirmation = await Popup.show.confirm(
                    'This will replace your current tasks. Continue?',
                    null
                );

                if (!confirmation) {
                    return;
                }
            }

            // Update objective description if it exists in import
            if (importData.description) {
                currentObjective.description = importData.description;
            }

            // Clear current tasks and load from import
            currentObjective.children = [];

            // Rebuild task objects with proper parentId references
            for (const taskData of importData.tasks) {
                const task = new ObjectiveTask({
                    description: taskData.description,
                    completed: taskData.completed || false,
                    parentId: currentObjective.id,
                });

                if (taskData.children && taskData.children.length > 0) {
                    loadChildTasksRecursive(task, taskData.children);
                }

                currentObjective.children.push(task);
            }

            updateUiTaskList();
            setCurrentTask();
            saveState();

            toastr.success('Tasks imported successfully');

        } catch (error) {
            console.error('Import error:', error);
            toastr.error('Failed to import tasks: ' + error.message);
        }
    };

    // Trigger file selection
    fileInput.click();
}

// Export task templates to a JSON file
function exportTaskTemplates() {
    const templateName = $('#objective-template-select').val();

    // Check if a template is selected
    if (!templateName) {
        toastr.warning('Please select a template to export');
        return;
    }

    // Check if the template exists
    if (!extension_settings.objective.templates || !extension_settings.objective.templates[templateName]) {
        toastr.error('Template not found');
        return;
    }

    // Prepare export data with only the selected template
    const exportData = {
        templates: {
            [templateName]: extension_settings.objective.templates[templateName]
        },
        exportDate: new Date().toISOString(),
        version: '1.0'
    };

    // Convert to JSON string
    const jsonString = JSON.stringify(exportData, null, 2);

    // Create download link
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create filename based on template name
    const filename = `objective-template-${templateName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 30)}.json`;

    // Create and trigger download link
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // Clean up
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);

    toastr.success(`Template "${templateName}" exported successfully`);
}

// Import task templates from a JSON file
async function importTaskTemplates() {
    // Create file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    // Handle file selection
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Read file
            const text = await file.text();
            const importData = JSON.parse(text);

            // Validate import data
            if (!importData.templates || typeof importData.templates !== 'object') {
                throw new Error('Invalid template file format');
            }

            // Count templates to import
            const templateCount = Object.keys(importData.templates).length;
            if (templateCount === 0) {
                throw new Error('No templates found in the import file');
            }

            // Initialize templates object if it doesn't exist
            if (!extension_settings.objective.templates) {
                extension_settings.objective.templates = {};
            }

            // Check for existing templates with the same names
            const existingTemplates = [];
            for (const templateName in importData.templates) {
                if (extension_settings.objective.templates[templateName]) {
                    existingTemplates.push(templateName);
                }
            }

            // If there are existing templates, ask for conflict resolution choice
            if (existingTemplates.length > 0) {
                let choice = 'skip'; // Default to skip if no choice is made

                // Check if Popup.show.select is available
                if (typeof Popup.show.select === 'function') {
                    const options = [
                        { text: 'Overwrite existing templates', value: 'overwrite' },
                        { text: 'Import with numbered suffix (e.g. "template-2")', value: 'rename' },
                        { text: 'Skip conflicting templates', value: 'skip' }
                    ];

                    choice = await Popup.show.select(
                        `${existingTemplates.length} template(s) already exist with the same name. How would you like to handle this?`,
                        options
                    );
                } else {
                    // Fallback to confirm dialog if select is not available
                    const confirmation = await Popup.show.confirm(
                        `${existingTemplates.length} template(s) already exist with the same name. Would you like to overwrite them?`,
                        null
                    );

                    if (confirmation) {
                        choice = 'overwrite';
                    } else {
                        // Ask if user wants to rename instead of skip
                        const renameConfirmation = await Popup.show.confirm(
                            'Would you like to import with numbered suffixes (e.g. "template-2") instead?',
                            null
                        );

                        if (renameConfirmation) {
                            choice = 'rename';
                        }
                    }
                }

                if (!choice || choice === 'skip') {
                    // User chose to skip, so filter out existing templates
                    for (const templateName of existingTemplates) {
                        delete importData.templates[templateName];
                    }
                } else if (choice === 'rename') {
                    // User chose to rename, so add numbered suffix to conflicting templates
                    const renamedTemplates = {};

                    for (const templateName in importData.templates) {
                        if (extension_settings.objective.templates[templateName]) {
                            // Find an available name with suffix
                            let newName = templateName;
                            let suffix = 2;

                            while (extension_settings.objective.templates[newName] || renamedTemplates[newName]) {
                                newName = `${templateName}-${suffix}`;
                                suffix++;
                            }

                            // Add with new name
                            renamedTemplates[newName] = importData.templates[templateName];
                        } else {
                            // No conflict, keep original name
                            renamedTemplates[templateName] = importData.templates[templateName];
                        }
                    }

                    // Replace with renamed templates
                    importData.templates = renamedTemplates;
                }
                // If choice was 'overwrite', we keep the original names and overwrite
            }

            // Merge imported templates with existing ones
            Object.assign(extension_settings.objective.templates, importData.templates);
            saveSettingsDebounced();

            // Refresh the template select dropdown
            populateTemplateSelect();

            // Show success message
            const importedCount = Object.keys(importData.templates).length;
            toastr.success(`Imported ${importedCount} templates successfully`);

        } catch (error) {
            console.error('Template import error:', error);
            toastr.error('Failed to import templates: ' + error.message);
        }
    };

    // Trigger file selection
    fileInput.click();
}

// Add task to recently completed tasks array
function addToRecentlyCompletedTasks(task) {
    // First, remove any existing entry for this task to avoid duplicates
    recentlyCompletedTasks = recentlyCompletedTasks.filter(t => t.id !== task.id);

    // Add to the beginning of the array (most recent first)
    recentlyCompletedTasks.unshift({
        id: task.id,
        description: task.description,
        completionDate: task.completionDate
    });

    // Limit the array size based on user settings
    const maxCompletedTasks = Number($('#objective-completed-count').val()) || 3;
    if (recentlyCompletedTasks.length > maxCompletedTasks) {
        recentlyCompletedTasks = recentlyCompletedTasks.slice(0, maxCompletedTasks);
    }

    // Update the UI with the new count
    updateCompletedTasksCount();

    // Update the extension prompt to include recently completed tasks
    setCurrentTask();
}

function onShowCompletedTasksInput() {
    setCurrentTask();
    saveState();
}

function onCompletedTasksCountInput() {
    // Update the recently completed tasks array based on the new count
    const maxCompletedTasks = Number($('#objective-completed-count').val()) || 3;
    if (recentlyCompletedTasks.length > maxCompletedTasks) {
        recentlyCompletedTasks = recentlyCompletedTasks.slice(0, maxCompletedTasks);

        // Update the UI with the new count
        updateCompletedTasksCount();
    }

    setCurrentTask();
    saveState();
}

async function onPurgeCompletedTasksClick() {
    // If there are no tasks to purge, just show a message
    if (recentlyCompletedTasks.length === 0) {
        toastr.info('No recently completed tasks to purge');
        return;
    }

    // Ask for confirmation before purging
    const confirmation = await Popup.show.confirm('Are you sure you want to purge all recently completed tasks?', null);

    if (!confirmation) {
        return;
    }

    // Clear the recently completed tasks array
    recentlyCompletedTasks = [];

    // Update the UI with the new count
    updateCompletedTasksCount();

    // Update the extension prompt
    setCurrentTask();
    saveState();

    toastr.success('Recently completed tasks have been purged');
}

// Show recently completed tasks in a popup
function showRecentlyCompletedTasks() {
    if (recentlyCompletedTasks.length === 0) {
        toastr.info('No recently completed tasks');
        return;
    }

    let popupText = `
    <div class="recently-completed-tasks-modal">
        <h3>Recently Completed Tasks</h3>
        <p>These tasks are included in the AI's context when "Include completed tasks in prompt" is enabled.</p>
        <ul class="recently-completed-tasks-list">`;

    for (const task of recentlyCompletedTasks) {
        const date = new Date(task.completionDate);
        const formattedDate = date.toLocaleString();
        popupText += `
            <li class="recently-completed-task-item">
                <div class="recently-completed-task-description">${task.description}</div>
                <div class="recently-completed-task-date">Completed: ${formattedDate}</div>
            </li>`;
    }

    popupText += `
        </ul>
        <div class="recently-completed-tasks-actions">
            <button id="recently-completed-tasks-purge" class="menu_button">Purge All</button>
        </div>
    </div>`;

    callGenericPopup(popupText, POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true });

    // Add event listener for the purge button in the popup
    $('#recently-completed-tasks-purge').on('click', () => {
        onPurgeCompletedTasksClick();
        // Close the popup
        $('.popup_cross').click();
    });
}

jQuery(async () => {
    const settingsHtml = await renderExtensionTemplateAsync('third-party/Extension-Objective', 'settings');

    // CSS styles are now defined in style.css

    addManualTaskCheckUi();
    const getContainer = () => $(document.getElementById('objective_container') ?? document.getElementById('extensions_settings'));
    getContainer().append(settingsHtml);
    $(document).on('click', '#objective-generate', onGenerateObjectiveClick);
    $(document).on('click', '#objective-generate-more', onGenerateAdditionalTasksClick);
    $(document).on('input', '#objective-chat-depth', onChatDepthInput);
    $(document).on('input', '#objective-check-frequency', onCheckFrequencyInput);
    $(document).on('click', '#objective-hide-tasks', onHideTasksInput);
    $(document).on('click', '#objective-clear', onClearTasksClick);
    $(document).on('click', '#objective_prompt_edit', onEditPromptClick);
    $(document).on('click', '#objective-parent', onParentClick);
    $(document).on('focusout', '#objective-text', onObjectiveTextFocusOut);
    $(document).on('click', '#objective-show-completed', onShowCompletedTasksInput);
    $(document).on('input', '#objective-completed-count', onCompletedTasksCountInput);
    $(document).on('click', '#objective-purge-completed', onPurgeCompletedTasksClick);
    $(document).on('click', '#objective-view-completed', showRecentlyCompletedTasks);
    $(document).on('click', '#objective-show-upcoming', onShowUpcomingTasksInput);
    $(document).on('input', '#objective-upcoming-count', onUpcomingTasksCountInput);
    $(document).on('click', '#objective-purge-upcoming', onPurgeUpcomingTasksClick);
    $(document).on('click', '#objective-view-upcoming', showUpcomingTasks);
    $(document).on('click', '#objectiveExtensionPopoutButton', function (e) {
        doPopout(e);
        e.stopPropagation();
    });
    $('#objective-parent').hide();
    loadSettings();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        resetState();
    });
    eventSource.on(event_types.MESSAGE_SWIPED, () => {
        lastMessageWasSwipe = true;
    });
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (currentChatId == undefined || jQuery.isEmptyObject(currentTask) || lastMessageWasSwipe) {
            lastMessageWasSwipe = false;
            return;
        }

        // Store the current task ID before checking
        const taskId = currentTask.id ? currentTask.id : null;

        let checkForCompletion = false;
        const noCheckTypes = ['continue', 'quiet', 'impersonate'];
        const lastType = substituteParams('{{lastGenerationType}}');
        if (Number($('#objective-check-frequency').val()) > 0 && !noCheckTypes.includes(lastType)) {
            // Check only at specified interval. Don't let counter go negative
            if (--checkCounter <= 0) {
                checkCounter = Math.max(0, checkCounter);
                checkForCompletion = true;
            }
        }
        const checkTaskPromise = checkForCompletion ? checkTaskCompleted() : Promise.resolve();
        checkTaskPromise.finally(() => {
            // If the task wasn't completed, make sure to preserve the highlight
            if (taskId && !checkForCompletion) {
                setCurrentTask(taskId);
            }
            $('#objective-counter').text(checkCounter);
        });
    });

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'taskcheck',
        callback: checkTaskCompleted,
        helpString: 'Checks if the current task is completed',
        returns: 'true or false',
    }));

    // Add event listeners for the buttons defined in settings.html
    $(document).on('click', '#objective_templates', onManageTemplatesClick);
    $(document).on('click', '#objective_export', exportTasks);
    $(document).on('click', '#objective_import', importTasks);
    $(document).on('click', '#objective_statistics', showStatistics);
});

// Update the UI to show how many recently completed tasks are being tracked
function updateCompletedTasksCount() {
    const count = recentlyCompletedTasks.length;
    const viewButton = $('#objective-view-completed');

    if (count > 0) {
        viewButton.val(`View Tasks (${count})`);
    } else {
        viewButton.val('View Tasks');
    }
}

// Update upcoming tasks based on the current task
function updateUpcomingTasks() {
    // Clear the current upcoming tasks
    upcomingTasks = [];

    if (!currentTask || !currentTask.id || !currentObjective) {
        return;
    }

    // Find the current task's index in the parent's children array
    const parent = getTaskById(currentTask.parentId);
    if (!parent) return;

    const currentIndex = parent.children.findIndex(task => task.id === currentTask.id);
    if (currentIndex === -1) return;

    // Get the maximum number of upcoming tasks to show
    const maxUpcomingTasks = Number($('#objective-upcoming-count').val()) || 3;

    // Add tasks that come after the current task
    for (let i = currentIndex + 1; i < parent.children.length && upcomingTasks.length < maxUpcomingTasks; i++) {
        const task = parent.children[i];
        if (!task.completed) {
            upcomingTasks.push({
                id: task.id,
                description: task.description
            });
        }
    }

    // If we still need more tasks and there are other incomplete tasks elsewhere, add them
    if (upcomingTasks.length < maxUpcomingTasks) {
        // Get all incomplete tasks in order
        const allIncompleteTasks = getAllIncompleteTasks(taskTree);

        // Filter out tasks that are already in upcomingTasks or are the current task
        const filteredTasks = allIncompleteTasks.filter(task =>
            task.id !== currentTask.id &&
            !upcomingTasks.some(upcomingTask => upcomingTask.id === task.id)
        );

        // Add remaining tasks up to the limit
        for (let i = 0; i < filteredTasks.length && upcomingTasks.length < maxUpcomingTasks; i++) {
            upcomingTasks.push({
                id: filteredTasks[i].id,
                description: filteredTasks[i].description
            });
        }
    }

    // Update the UI with the new count
    updateUpcomingTasksCount();
}

// Get all incomplete tasks in the tree in a flat array
function getAllIncompleteTasks(task) {
    let result = [];

    // Skip the root task
    if (task.parentId !== '') {
        if (!task.completed) {
            result.push(task);
        }
    }

    // Recursively add all children's incomplete tasks
    for (const child of task.children) {
        result = result.concat(getAllIncompleteTasks(child));
    }

    return result;
}

// Update the UI to show how many upcoming tasks are being tracked
function updateUpcomingTasksCount() {
    const count = upcomingTasks.length;
    const viewButton = $('#objective-view-upcoming');

    if (count > 0) {
        viewButton.val(`View Tasks (${count})`);
    } else {
        viewButton.val('View Tasks');
    }
}

function onShowUpcomingTasksInput() {
    setCurrentTask();
    saveState();
}

function onUpcomingTasksCountInput() {
    // Update the upcoming tasks array based on the new count
    updateUpcomingTasks();
    setCurrentTask();
    saveState();
}

async function onPurgeUpcomingTasksClick() {
    // If there are no tasks to purge, just show a message
    if (upcomingTasks.length === 0) {
        toastr.info('No upcoming tasks to purge');
        return;
    }

    // Ask for confirmation before purging
    const confirmation = await Popup.show.confirm('Are you sure you want to purge all upcoming tasks?', null);

    if (!confirmation) {
        return;
    }

    // Clear the upcoming tasks array
    upcomingTasks = [];

    // Update the UI with the new count
    updateUpcomingTasksCount();

    // Update the extension prompt
    setCurrentTask();
    saveState();

    toastr.success('Upcoming tasks have been purged');
}

// Show upcoming tasks in a popup
function showUpcomingTasks() {
    if (upcomingTasks.length === 0) {
        toastr.info('No upcoming tasks');
        return;
    }

    let popupText = `
    <div class="upcoming-tasks-modal">
        <h3>Upcoming Tasks</h3>
        <p>These tasks are included in the AI's context when "Include upcoming tasks in prompt" is enabled.</p>
        <ul class="upcoming-tasks-list">`;

    for (const task of upcomingTasks) {
        popupText += `
            <li class="upcoming-task-item">
                <div class="upcoming-task-description">${task.description}</div>
            </li>`;
    }

    popupText += `
        </ul>
        <div class="upcoming-tasks-actions">
            <button id="upcoming-tasks-purge" class="menu_button">Purge All</button>
        </div>
    </div>`;

    callGenericPopup(popupText, POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true });

    // Add event listener for the purge button in the popup
    $('#upcoming-tasks-purge').on('click', () => {
        onPurgeUpcomingTasksClick();
        // Close the popup
        $('.popup_cross').click();
    });
}
