"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASTEvaluator = void 0;
exports.evaluateExpression = evaluateExpression;
const jsep_1 = __importDefault(require("jsep"));
const state_1 = require("./state");
// Configure jsep for CGML Expression Language
jsep_1.default.addBinaryOp("and", 2);
jsep_1.default.addBinaryOp("or", 1);
jsep_1.default.addBinaryOp("==", 6);
jsep_1.default.addBinaryOp("!=", 6);
class ASTEvaluator {
    constructor(context, engine, gameState) {
        this.context = context;
        this.engine = engine;
        this.gameState = gameState;
    }
    eval(expr) {
        if (typeof expr !== 'string')
            return expr;
        // Handle refs pre-parsing if needed, but jsep handles it if we map ref:name to REF_name
        let safeExpr = expr.replace(/ref:([a-zA-Z0-9_]+)/g, 'REF_$1');
        try {
            const tree = (0, jsep_1.default)(safeExpr);
            return this.visit(tree);
        }
        catch (e) {
            throw new Error(`Invalid EL Syntax in '${expr}': ${e.message}`);
        }
    }
    visit(node) {
        switch (node.type) {
            case 'Literal':
                return node.value;
            case 'Identifier':
                return this.visitIdentifier(node);
            case 'MemberExpression':
                return this.visitMemberExpression(node);
            case 'CallExpression':
                return this.visitCallExpression(node);
            case 'BinaryExpression':
            case 'LogicalExpression':
                return this.visitBinaryExpression(node);
            case 'UnaryExpression':
                return this.visitUnaryExpression(node);
            case 'ArrayExpression':
                return node.elements.filter(e => e !== null).map(e => this.visit(e));
            default:
                throw new Error(`Unsupported AST node type: ${node.type}`);
        }
    }
    visitIdentifier(node) {
        const name = node.name;
        if (name === '$')
            return this.gameState;
        if (name.startsWith('REF_')) {
            const refName = name.substring(4);
            return this.context[refName];
        }
        if (name in this.context)
            return this.context[name];
        // Python engine resolved paths if it was a string
        if (this.engine && typeof this.engine.resolvePath === 'function') {
            try {
                return this.engine.resolvePath(this.gameState, name, this.context);
            }
            catch { }
        }
        return name;
    }
    visitMemberExpression(node) {
        const obj = this.visit(node.object);
        let prop;
        if (node.computed) {
            prop = this.visit(node.property);
        }
        else {
            prop = node.property.name;
        }
        if (obj === undefined || obj === null) {
            throw new Error(`Cannot read property '${prop}' of ${obj}`);
        }
        // Shorthands
        if (obj instanceof state_1.GameState && prop === 'zones')
            return obj.shared_zones;
        if (obj instanceof state_1.Player && obj.zones && prop in obj.zones)
            return obj.zones[prop];
        if (obj instanceof state_1.Card && obj.properties && prop in obj.properties)
            return obj.properties[prop];
        if (Array.isArray(obj)) {
            if (prop === 'length')
                return obj.length;
            if (typeof prop === 'number')
                return obj[prop];
            // If mapping over an array with group context, it might be handled differently, but default to array prop
        }
        return obj[prop];
    }
    visitBinaryExpression(node) {
        const left = this.visit(node.left);
        // Short-circuit evaluations
        if (node.operator === 'and' || node.operator === '&&') {
            return left && this.visit(node.right);
        }
        if (node.operator === 'or' || node.operator === '||') {
            return left || this.visit(node.right);
        }
        const right = this.visit(node.right);
        switch (node.operator) {
            case '==':
            case '===': return left == right; // loose equality often used in expressions
            case '!=':
            case '!==': return left != right;
            case '<': return left < right;
            case '<=': return left <= right;
            case '>': return left > right;
            case '>=': return left >= right;
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return left / right;
            case '%': return left % right;
            default: throw new Error(`Unsupported operator: ${node.operator}`);
        }
    }
    visitUnaryExpression(node) {
        const arg = this.visit(node.argument);
        switch (node.operator) {
            case 'not':
            case '!': return !arg;
            case '-': return -arg;
            case '+': return +arg;
            default: throw new Error(`Unsupported unary operator: ${node.operator}`);
        }
    }
    visitCallExpression(node) {
        if (node.callee.type !== 'Identifier') {
            throw new Error("Only simple function names are supported");
        }
        const funcName = node.callee.name;
        const args = node.arguments;
        if (funcName === 'count') {
            const val = this.visit(args[0]);
            if (val instanceof state_1.Zone)
                return val.cardCount;
            if (Array.isArray(val))
                return val.length;
            return 0;
        }
        else if (funcName === 'rank_value') {
            const val = this.visit(args[0]);
            return this.engine ? this.engine.opRankValue(val, this.gameState, this.context) : val;
        }
        else if (funcName === 'top') {
            const val = this.visit(args[0]);
            if (val instanceof state_1.Zone)
                return val.topCard;
            if (Array.isArray(val))
                return val.length > 0 ? val[val.length - 1] : null;
            return null;
        }
        else if (funcName === 'bottom') {
            const val = this.visit(args[0]);
            if (val instanceof state_1.Zone)
                return val.cards[0] || null;
            if (Array.isArray(val))
                return val.length > 0 ? val[0] : null;
            return null;
        }
        else if (funcName === 'sum') {
            const val = this.visit(args[0]);
            const arr = Array.isArray(val) ? val : [val];
            return arr.reduce((acc, curr) => acc + (Number(curr) || 0), 0);
        }
        else if (funcName === 'map') {
            const seq = this.visit(args[0]);
            const mappedAttrStrExpr = args[1].value;
            if (!Array.isArray(seq) && !(seq instanceof state_1.Zone))
                return [];
            const collection = seq instanceof state_1.Zone ? seq.cards : seq;
            const res = [];
            for (const item of collection) {
                const subCtx = { ...this.context, card: item, group: item };
                const subEval = new ASTEvaluator(subCtx, this.engine, this.gameState);
                res.push(subEval.eval(mappedAttrStrExpr));
            }
            return res;
        }
        else if (funcName === 'filter') {
            const seq = this.visit(args[0]);
            const filterExpr = args[1].value;
            if (!Array.isArray(seq) && !(seq instanceof state_1.Zone))
                return [];
            const collection = seq instanceof state_1.Zone ? seq.cards : seq;
            const res = [];
            for (const item of collection) {
                const subCtx = { ...this.context, card: item };
                const subEval = new ASTEvaluator(subCtx, this.engine, this.gameState);
                if (subEval.eval(filterExpr)) {
                    res.push(item);
                }
            }
            return res;
        }
        else if (funcName === 'canPerform') {
            // Evaluated by engine in reality.
            if (this.engine && typeof this.engine.canPerform === 'function') {
                return this.engine.canPerform(this.visit(args[0]), this.visit(args[1]));
            }
            return true;
        }
        throw new Error(`Unsupported function: ${funcName}`);
    }
}
exports.ASTEvaluator = ASTEvaluator;
function evaluateExpression(expr, gameState, context, engine) {
    const evaluator = new ASTEvaluator(context, engine, gameState);
    return evaluator.eval(expr);
}
