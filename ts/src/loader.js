"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCgmlFile = loadCgmlFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const ajv_1 = __importDefault(require("ajv"));
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
let schemaPath = '';
if (!isBrowser) {
    try {
        schemaPath = path.resolve(__dirname, '../../cgml.schema.json');
    }
    catch (e) {
        console.warn("Could not resolve __dirname for schemaPath. This might be expected in a browser environment.");
        // In a browser environment, schema loading would need a different mechanism (e.g., fetching from a URL).
        // For now, we'll leave schemaPath empty, which will cause getValidator to fail if called.
    }
}
// Load the JSON Schema. Assuming this loader is executed from the ts compiled output or ts-node.
let validate = null;
function getValidator() {
    if (!validate) {
        if (isBrowser) {
            // In a browser environment, schema loading needs to be handled differently.
            // For example, fetch the schema from a URL.
            // For now, we'll throw an error as direct file system access is not available.
            throw new Error("Schema validation is not supported in browser environments without a custom schema loading mechanism.");
        }
        try {
            const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
            const ajv = new ajv_1.default({ strict: false, allowUnionTypes: true });
            validate = ajv.compile(schemaData);
        }
        catch (err) {
            console.error(`Failed to load schema from ${schemaPath}. Ensure you are running from the correct directory.`);
            throw err;
        }
    }
    return validate;
}
function loadCgmlFile(filePath) {
    const fullPath = path.resolve(filePath);
    const baseDir = path.dirname(fullPath);
    const IncludeYamlType = new yaml.Type('!include', {
        kind: 'scalar',
        resolve: function (data) {
            return data !== null && typeof data === 'string';
        },
        construct: function (data) {
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
