from typing import Any, Dict, Callable, List, Union, Optional

from src.loader import Condition, Operand, EffectAction

def resolve_path(obj: Any, path: str) -> Any:
    """
    A simple dot-path resolver. Example: "player.0.zones.play_area.top_card.rank"
    Handles lists/objects and falls back to dict access.
    """
    if path is None:
        return obj

    current = obj
    for part in path.split('.'):
        if isinstance(current, dict):
            if part.isdigit() and part in current:
                current = current[part]
            elif part in current:
                current = current[part]
            else:
                try:
                    idx = int(part)
                    # Index into dict via int, if keys are ints
                    current = current[idx]
                except:
                    raise KeyError(f"Key '{part}' not found in dict: {list(current.keys())}")
        elif isinstance(current, list):
            try:
                idx = int(part)
            except ValueError:
                raise KeyError(f"Cannot use key '{part}' on list")
            if idx < len(current):
                current = current[idx]
            else:
                raise IndexError(f"Index '{idx}' out of bounds in list access {repr(path)}")
        elif hasattr(current, part):
            current = getattr(current, part)
        else:
            # Try to fall back to dict as last resort
            try:
                current = current[part]
            except Exception:
                raise AttributeError(f"Cannot resolve '{part}' in path '{path}' on {repr(current)}")
    return current

def get_rank_index(cgml_definition, deck_type_name, rank_value):
    """Looks up the numeric index of a rank in the deck's rank_hierarchy."""
    rank_hierarchy = cgml_definition.components.component_types['deck_types'][deck_type_name].rank_hierarchy
    # Use str() to handle YAML typing quirks: '2' might be int or str!
    try:
        return [str(x) for x in rank_hierarchy].index(str(rank_value))
    except ValueError:
        raise ValueError(f"Rank '{rank_value}' not found in rank_hierarchy: {rank_hierarchy}")

class RulesEngine:
    def __init__(self, action_registry: Dict[str, Callable]):
        """
        :param action_registry: Mapping action_name => callable(game_state, **params)
        """
        self.actions = action_registry

    def _maybe_compare_ranks(self, left, right, game_state):
        """
        If both left and right look like card rank values, and game defines hierarchy, return indices for comparison.
        Otherwise, return original values.
        """
        # Try to determine deck_type context:
        cgml_def = getattr(game_state, "cgml_definition", None)
        if cgml_def is None:
            return left, right  # fallback: vanilla

        # Try to extract deck_type (assume 1 deck_type if only one, otherwise fail gracefully)
        try:
            deck_types = cgml_def.components.component_types.get('deck_types', {})
            if not deck_types:
                return left, right
            # Use the first deck_type found unless there's a better way (expand for multi-deck games!)
            deck_type_name = next(iter(deck_types))
            # Check if both are in rank_hierarchy
            rank_hierarchy = [str(x) for x in deck_types[deck_type_name].rank_hierarchy]

            if str(left) in rank_hierarchy and str(right) in rank_hierarchy:
                left = rank_hierarchy.index(str(left))
                right = rank_hierarchy.index(str(right))
        except Exception:
            pass  # fallback to default comparison

        return left, right

    def evaluate_condition(
        self,
        cond: Union[Condition, Dict, Any],
        game_state: Any,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Recursively evaluates a Condition (pydantic model or dict node).
        """
        context = context or {}

        if not isinstance(cond, (Condition, dict)):
            return bool(cond)

        if isinstance(cond, dict):
            cond = Condition.parse_obj(cond)

        if cond.isEqual is not None:
            left = self.resolve_operand(cond.isEqual[0], game_state, context)
            right = self.resolve_operand(cond.isEqual[1], game_state, context)
            left, right = self._maybe_compare_ranks(left, right, game_state)
            return left == right
        if cond.isGreaterThan is not None:
            left = self.resolve_operand(cond.isGreaterThan[0], game_state, context)
            right = self.resolve_operand(cond.isGreaterThan[1], game_state, context)
            left, right = self._maybe_compare_ranks(left, right, game_state)
            return left > right
        if cond.isLessThan is not None:
            left = self.resolve_operand(cond.isLessThan[0], game_state, context)
            right = self.resolve_operand(cond.isLessThan[1], game_state, context)
            left, right = self._maybe_compare_ranks(left, right, game_state)
            return left < right
        if getattr(cond, "and_", None) is not None:
            return all(self.evaluate_condition(sub, game_state, context) for sub in cond.and_)
        if getattr(cond, "or_", None) is not None:
            return any(self.evaluate_condition(sub, game_state, context) for sub in cond.or_)
        if getattr(cond, "not_", None) is not None:
            return not self.evaluate_condition(cond.not_, game_state, context)
        # Optionally handle max_, min_, count, etc
        if getattr(cond, "max_", None) is not None:
            vals = [self.resolve_operand(x, game_state, context) for x in cond.max_]
            return max(vals)
        if getattr(cond, "min_", None) is not None:
            vals = [self.resolve_operand(x, game_state, context) for x in cond.min_]
            return min(vals)
        if getattr(cond, "sum_", None) is not None:
            vals = [self.resolve_operand(x, game_state, context) for x in cond.sum_]
            flat_vals = []
            for v in vals:
                if isinstance(v, (list, tuple)):
                    flat_vals.extend(v)
                else:
                    flat_vals.append(v)
            return sum(flat_vals)
        if getattr(cond, "count", None) is not None:
            collection = cond.count
            if isinstance(collection, list) and len(collection) == 1:
                # If a filter node, evaluate recursively
                return len(self.resolve_operand(collection[0], game_state, context))
            elif isinstance(collection, (list, tuple)):
                return len(collection)
            else:
                return len(collection)
        if getattr(cond, "value", None) is not None:
            return cond.value
        if getattr(cond, "path", None) is not None:
            return resolve_path(game_state, cond.path)
        if getattr(cond, "ref", None) is not None:
            return context.get(cond.ref)
        return False

    def resolve_operand(
        self,
        operand: Union[Operand, Dict, Any],
        game_state: Any,
        context: Optional[Dict[str, Any]] = None
    ) -> Any:
        """
        Resolves an operand node: can be Operand model, dict, or value.
        """
        context = context or {}

        if isinstance(operand, dict):
            operand = Operand.parse_obj(operand)
        if isinstance(operand, Operand):
            if operand.path is not None:
                return resolve_path(game_state, operand.path)
            if operand.value is not None:
                return operand.value
            if operand.ref is not None:
                return context.get(operand.ref)
            if operand.isEqual is not None:
                return self.evaluate_condition(Condition(isEqual=operand.isEqual), game_state, context)
            if operand.isGreaterThan is not None:
                return self.evaluate_condition(Condition(isGreaterThan=operand.isGreaterThan), game_state, context)
            if operand.isLessThan is not None:
                return self.evaluate_condition(Condition(isLessThan=operand.isLessThan), game_state, context)
            if getattr(operand, "and_", None) is not None:
                return self.evaluate_condition(Condition(and_=operand.and_), game_state, context)
            if getattr(operand, "or_", None) is not None:
                return self.evaluate_condition(Condition(or_=operand.or_), game_state, context)
            if getattr(operand, "not_", None) is not None:
                return self.evaluate_condition(Condition(not_=operand.not_), game_state, context)
            if getattr(operand, "max_", None) is not None:
                vals = [self.resolve_operand(x, game_state, context) for x in operand.max_]
                return max(vals)
            if getattr(operand, "min_", None) is not None:
                vals = [self.resolve_operand(x, game_state, context) for x in operand.min_]
                return min(vals)
            if getattr(operand, "sum_", None) is not None:
                vals = [self.resolve_operand(x, game_state, context) for x in operand.sum_]
                # Flatten if any elements are lists, e.g. from card counts across several zones
                flat_vals = []
                for v in vals:
                    if isinstance(v, (list, tuple)):
                        # If v is a list of numbers (e.g. [card.card_count for some zones])
                        flat_vals.extend(v)
                    else:
                        flat_vals.append(v)
                return sum(flat_vals)
            if getattr(operand, "count", None) is not None:
                collection = operand.count
                if isinstance(collection, list) and len(collection) == 1:
                    return len(self.resolve_operand(collection[0], game_state, context))
                elif isinstance(collection, (list, tuple)):
                    return len(collection)
                else:
                    return len(collection)
        return operand

    def execute_effect(self, effect_list: List[EffectAction], game_state: Any, context: Optional[Dict[str, Any]] = None):
        """
        Expects a list of EffectAction models (not dicts).
        """
        context = context or {}
        for action_def in effect_list:
            if isinstance(action_def, dict):
                action_def = EffectAction.parse_obj(action_def)
            action_name = action_def.action
            action_func = self.actions.get(action_name)
            if action_func:
                params = action_def.dict(exclude={"action"}, exclude_none=True)
                action_func(game_state, context=context, **params)
            else:
                print(f"Action not implemented: {action_name}")
