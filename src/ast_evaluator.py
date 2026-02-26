import ast
from typing import Any, Dict, List, Optional
import operator as op

# Supported operators list
OPERATORS = {
    ast.Add: op.add,
    ast.Sub: op.sub,
    ast.Mult: op.mul,
    ast.Div: op.truediv,
    ast.Mod: op.mod,
    ast.Pow: op.pow,
    ast.Eq: op.eq,
    ast.NotEq: op.ne,
    ast.Lt: op.lt,
    ast.LtE: op.le,
    ast.Gt: op.gt,
    ast.GtE: op.ge,
    ast.And: lambda a, b: a and b,
    ast.Or: lambda a, b: a or b,
    ast.Not: op.not_,
}

class ASTEvaluator(ast.NodeVisitor):
    def __init__(self, context: Dict[str, Any], engine: Any, game_state: Any):
        self.context = context
        self.engine = engine  # Need RulesEngine to resolve paths and globals
        self.game_state = game_state

    def eval(self, expr: str) -> Any:
        if not isinstance(expr, str):
            # If it's already a bool/int/etc from YAML fallback, return it
            return expr
        
        # Add basic support for JSONPath strings by replacing $ with something python AST accepts
        # e.g., $.players[0] -> PATH___players[0]
        # This is a bit of a hack but avoids importing a full jsonpath parser just for the expression side
        # A cleaner way is to simply let the engine resolve `$.players` if it sees it, but Python's AST
        # doesn't like `$`. We can substitute `$` with `ROOT_CTX`.
        safe_expr = expr.replace('$.', 'ROOT_CTX.')
        safe_expr = safe_expr.replace('$', 'CTX_')
        safe_expr = safe_expr.replace('ref:', 'REF_')
        
        try:
            tree = ast.parse(safe_expr, mode='eval')
            return self.visit(tree.body)
        except SyntaxError as e:
            raise ValueError(f"Invalid EL Syntax in '{expr}': {e}")

    def visit_Constant(self, node: ast.Constant) -> Any:
        return node.value

    def _handle_ref(self, ref_name: str) -> Any:
        # Resolves ref:name from context
        return self.context.get(ref_name)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> Any:
        # Handles syntax like: ref:target_player
        # Which parses as target=Name('ref'), annotation=Name('target_player')
        if isinstance(node.target, ast.Name) and node.target.id == 'ref':
            if isinstance(node.annotation, ast.Name):
                return self._handle_ref(node.annotation.id)
            elif isinstance(node.annotation, ast.Attribute):
                # e.g. ref:target_player.hand
                # node.annotation is Attribute(value=Name('target_player'), attr='hand')
                base_obj = self.visit(node.annotation.value)
                return self._get_attribute(base_obj, node.annotation.attr)
        raise ValueError(f"Unsupported annotation assignment structure.")

    def visit_Name(self, node: ast.Name) -> Any:
        from engine import resolve_path
        name = node.id
        
        # Handle our substitutions
        if name == 'ROOT_CTX':
            return self.game_state
        if name.startswith('REF_'):
            ref_name = name[4:]
            return self.context.get(ref_name)
        if name.startswith('CTX_'):
            ctx_name = '$' + name[4:]
            return self.context.get(ctx_name)
            
        # Normal resolution (like 'player', 'card', 'current')
        if name in self.context:
            return self.context[name]
        
        # If it's none of the above, we treat it as a string literal effectively, or root path
        try:
            return resolve_path(self.game_state, name, self.context)
        except Exception:
            # Maybe it's just meant to be a string variable like 'current'
            return name

    def visit_Attribute(self, node: ast.Attribute) -> Any:
        # Reconstruct path like ROOT_CTX.players -> $.players
        value = self.visit(node.value)
        
        # Handle GameState alias for $.zones
        if type(value).__name__ == 'GameState' and node.attr == 'zones':
            return value.shared_zones

        # Handle Player shorthand for zones (e.g. player.hand -> player.zones['hand'])
        if type(value).__name__ == 'Player' and node.attr in value.zones:
            return value.zones[node.attr]

        # Handle Card shorthand for properties (e.g. card.rank -> card.properties['rank'])
        if type(value).__name__ == 'Card' and node.attr in value.properties:
            return value.properties[node.attr]
            
        if hasattr(value, node.attr):
            return getattr(value, node.attr)
        elif isinstance(value, dict) and node.attr in value:
            return value[node.attr]
        else:
            raise AttributeError(f"Attribute '{node.attr}' not found on {type(value)}")

    def visit_Subscript(self, node: ast.Subscript) -> Any:
        value = self.visit(node.value)
        slice_val = self.visit(node.slice)
        
        # Handle star [*] routing
        if isinstance(slice_val, tuple) and slice_val == ():
            # A hack since python AST doesn't support [*] directly easily in eval, but 
            # we try to handle lists
            pass
            
        if isinstance(value, list) or isinstance(value, dict):
            return value[slice_val]
        raise TypeError(f"Cannot index into {type(value)}")

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        op_fn = OPERATORS[type(node.op)]
        operand = self.visit(node.operand)
        return op_fn(operand)

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        op_fn = OPERATORS[type(node.op)]
        left = self.visit(node.left)
        right = self.visit(node.right)
        return op_fn(left, right)

    def visit_BoolOp(self, node: ast.BoolOp) -> Any:
        op_fn = OPERATORS[type(node.op)]
        # Short-circuit logic
        values = [self.visit(v) for v in node.values]
        if isinstance(node.op, ast.And):
            return all(values)
        elif isinstance(node.op, ast.Or):
            return any(values)

    def visit_Compare(self, node: ast.Compare) -> Any:
        left = self.visit(node.left)
        for operator, comparator in zip(node.ops, node.comparators):
            right = self.visit(comparator)
            
            # Auto-cast ranks if they look like strings but represent ranks
            left, right = self.engine._maybe_compare_ranks(left, right, self.game_state)
            
            if not OPERATORS[type(operator)](left, right):
                return False
            left = right
        return True

    def visit_Call(self, node: ast.Call) -> Any:
        if not isinstance(node.func, ast.Name):
            raise ValueError("Only simple function names are supported")
        func_name = node.func.id
        args = [self.visit(arg) for arg in node.args]

        if func_name == 'count':
            return self.engine._count_value(args[0])
        elif func_name == 'rank_value':
            return self.engine._op_rank_value(args[0], self.game_state, self.context)
        elif func_name == 'list':
            return list(args[0]) if len(args) == 1 and hasattr(args[0], '__iter__') and not isinstance(args[0], str) else list(args)
        elif func_name == 'map':
            seq = self.visit(node.args[0])
            mapped_attr = self.visit(node.args[1])
            if not isinstance(mapped_attr, str):
                raise ValueError("map second argument must be a string attribute path")
            if not seq or not hasattr(seq, '__iter__'): return []
            
            base_name = mapped_attr.split('.')[0]
            results = []
            for item in seq:
                ctx_copy = self.context.copy()
                ctx_copy[base_name] = item
                try:
                    res = ASTEvaluator(ctx_copy, self.engine, self.game_state).eval(mapped_attr)
                    results.append(res)
                except Exception:
                    pass
            return results
        elif func_name == 'distinct':
            seq = self.visit(node.args[0])
            if not seq or not hasattr(seq, '__iter__'): return []
            seen = set()
            res = []
            for x in seq:
                if x not in seen:
                    seen.add(x)
                    res.append(x)
            return res
        elif func_name == 'top':
            container = args[0]
            if hasattr(container, 'cards') and isinstance(container.cards, list):
                return container.cards[-1] if container.cards else None
            elif isinstance(container, list):
                return container[-1] if container else None
            return None
        elif func_name == 'bottom':
            container = args[0]
            if hasattr(container, 'cards') and isinstance(container.cards, list):
                return container.cards[0] if container.cards else None
            elif isinstance(container, list):
                return container[0] if container else None
            return None
        elif func_name == 'filter':
            # filter(list, "expression")
            collection = args[0]
            filter_expr = args[1]
            if not isinstance(filter_expr, str):
                raise ValueError("Filter expression must be a string")
            
            if hasattr(collection, 'cards'):
                collection = collection.cards
                
            filtered = []
            for item in collection:
                local_ctx = dict(self.context)
                local_ctx['card'] = item
                sub_evaluator = ASTEvaluator(local_ctx, self.engine, self.game_state)
                if sub_evaluator.eval(filter_expr):
                    filtered.append(item)
            return filtered
        elif func_name == 'max':
            return max(args[0] if len(args) == 1 else args)
        elif func_name == 'min':
            return min(args[0] if len(args) == 1 else args)
        elif func_name in ('sum', 'add'):
            val = args[0] if len(args) == 1 and isinstance(args[0], list) else args
            return sum(val)
        else:
            raise NameError(f"Unsupported function: {func_name}")

def evaluate_expression(expr: str, game_state: Any, context: Dict[str, Any], engine: Any) -> Any:
    """Safe evaluation of a CGML expression string."""
    evaluator = ASTEvaluator(context, engine, game_state)
    return evaluator.eval(expr)
