// Template helper functions
async function loadTemplate(templateName, data = {}) {
    const templateHtml = await renderExtensionTemplateAsync('third-party/ST-SuperObjective', `templates/${templateName}`);
    return substituteTemplateVars(templateHtml, data);
}

function substituteTemplateVars(template, data) {
    let result = template;
    
    // Simple template variable substitution
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'boolean') {
            // Handle handlebars-style conditionals for booleans
            const ifRegex = new RegExp(`{{#if ${key}}}([\\s\\S]*?){{/if}}`, 'g');
            result = result.replace(ifRegex, value ? '$1' : '');
        } else if (Array.isArray(value)) {
            // Handle handlebars-style each loops
            const eachRegex = new RegExp(`{{#each ${key}}}([\\s\\S]*?){{/each}}`, 'g');
            result = result.replace(eachRegex, (match, itemTemplate) => {
                return value.map(item => {
                    let itemResult = itemTemplate;
                    if (typeof item === 'object') {
                        for (const [itemKey, itemValue] of Object.entries(item)) {
                            itemResult = itemResult.replace(new RegExp(`{{${itemKey}}}`, 'g'), itemValue);
                        }
                    } else {
                        itemResult = itemResult.replace(new RegExp(`{{this}}`, 'g'), item);
                    }
                    return itemResult;
                }).join('');
            });
        } else {
            // Handle simple variable substitution
            result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
            // Handle triple braces for unescaped HTML
            result = result.replace(new RegExp(`{{{${key}}}}`, 'g'), value);
        }
    }
    
    return result;
}
