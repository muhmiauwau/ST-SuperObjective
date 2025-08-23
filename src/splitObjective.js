import { getContext, renderExtensionTemplateAsync } from '../../../../extensions.js';

import { retriggerFirstMessageOnEmptyChat, getUserAvatar, getUserAvatars, setUserAvatar, user_avatar } from '../../../../personas.js';
import { power_user } from '../../../../power-user.js';

const { lodash } = SillyTavern.libs;
const _ = lodash

function deMuh(){
    console.log("muh:", ...arguments)
}


let persons = []

export function updatePersonContentsVisibility() {
    
    deMuh("updatePersonContentsVisibility")


    const context = getContext();
        deMuh("context ", context.chatMetadata)

    const chatId = context && context.chatId ? context.chatId : null;

    const character = context.characters[context.characterId];

    const hasCharacter = !!(context && character);


    // Check if this is the welcome chat (various ways SillyTavern might identify it)
    const isWelcomeChat = !!(
        !chatId || 
        chatId === 'no-chat-id' || 
        chatId === 'undefined' ||
        chatId === '' ||
        (context && context.chatId && context.chatId.toString().toLowerCase().includes('welcome')) ||
        (context && context.name && context.name.toLowerCase().includes('welcome')) ||
        (context && !context.characters || (Array.isArray(context.characters) && context.characters.length === 0))
    );



    // If there's no proper chat, no character, or it's the welcome chat, show message
    if (isWelcomeChat || !hasCharacter) {
        
        $('#objectiveExtensionPersonContents').hide();
        $('#objective-no-chat-message').show();

    } else {
        $('#objective-no-chat-message').hide();
        $('#objectiveExtensionPersonContents').show();
    

        persons = [];
        persons.push(character);

    
        renderPersonDropdown().catch(() => {});
    }

    
}

export function splitObjective() {
    // TODO: Implementierung folgt
}

async function renderPersonDropdown() {

const dropdown = [];

    const userAvatars = await getUserAvatars(false);
    for (const userAvatar of userAvatars) {
        const personaName = power_user.personas[userAvatar] || userAvatar;
        const isSelected = userAvatar === user_avatar;

        if(isSelected){
            dropdown.push({ id: `user_${personaName}`,  name: `User: ${personaName}` });
        }
    }

     
    _.forEach(persons, (charObj, charId) => {
        const name = (charObj && (charObj.name || charObj.displayName)) || `Character ${charId}`;
        dropdown.push({id: `char_${name}`, name });
    })


    dropdown[0].selected = true
    const templateHtml = await renderExtensionTemplateAsync('third-party/ST-SuperObjective', 'templates/person-dropdown', { dropdown });
    $('#objectiveExtensionPersonDropdown').html(templateHtml);

    handlePersonChange(dropdown[0].name)
   
    $('#objective-person-select').off('change').on('change', (e) => {
        const val = $('#objective-person-select').val();

         deMuh("lol ", val)
         handlePersonChange(val)
        // store selected person id to a hidden field or extension setting if needed
       
    });

}




async function handlePersonChange(newPerson){
    const isUser = (newPerson.substr(0,5) == "User:")
    if(isUser){
        newPerson = newPerson.substr(6)
    }

   // persons
    deMuh("handlePersonChange ", newPerson, isUser)

    // fill objectiveExtensionPersonContents with char data
}

// export function anotherFunction() {
//     // TODO: Implementierung folgt
// }

// // ...weitere Funktionen können hier ergänzt werden...
