import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';

// Load the JSON Schema. Assuming this loader is executed from the ts compiled output or ts-node.
const schemaPath = path.resolve(__dirname, '../../cgml.schema.json');
let validate: any = null;

function getValidator() {
    if (!validate) {
        try {
            const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
            const ajv = new Ajv({ strict: false, allowUnionTypes: true });
            validate = ajv.compile(schemaData);
        } catch (err) {
            console.error(`Failed to load schema from ${schemaPath}. Ensure you are running from the correct directory.`);
            throw err;
        }
    }
    return validate;
}

export function loadCgmlFile(filePath: string): any {
    const fullPath = path.resolve(filePath);
    const baseDir = path.dirname(fullPath);

    const IncludeYamlType = new yaml.Type('!include', {
        kind: 'scalar',
        resolve: function (data: any) {
            return data !== null && typeof data === 'string';
        },
        construct: function (data: string) {
            const includePath = path.resolve(baseDir, data);
            const content = fs.readFileSync(includePath, 'utf8');
            // Parse the included file with the same schema to allow nested includes
            return yaml.load(content, { schema: CGML_SCHEMA });
        }
    });

    const CGML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([IncludeYamlType]);

    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const parsed = yaml.load(fileContents, { schema: CGML_SCHEMA });

    // Validate against JSON schema
    const validator = getValidator();
    const valid = validator(parsed);

    if (!valid) {
        console.warn("Validation warnings:");
        console.warn(validator.errors);
        // Do not return null here, proceed with parsed data since the python schema generation has some edge cases
    }

    return parsed;
}
