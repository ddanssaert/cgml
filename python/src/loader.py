import os
from typing import List, Dict, Any, Optional, Union
from pydantic import BaseModel, validator, Field, ValidationError
import yaml
import yaml_include  # Make sure this is installed

# ---- Data Models ---- #

class PlayerSpec(BaseModel):
    min: int
    max: int

class Meta(BaseModel):
    name: str
    author: str
    description: str
    players: PlayerSpec
    meta: Optional[Dict[str, Any]] = None  # for extensibility/docs

# -- Components, Decks, Zones, Variables -- #

class ComponentTypeDef(BaseModel):
    # Extensible for decks/zones/others
    composition: Optional[List[Any]] = None
    ordering: Optional[str] = None
    visibility: Optional[Dict[str, Any]] = None
    layout: Optional[str] = None
    rank_hierarchy: Optional[List[Union[str, int]]] = None

class DeckInstance(BaseModel):
    type: str
    meta: Optional[Dict[str, Any]] = None  # extensibility

class ZoneInstance(BaseModel):
    name: str
    type: str
    of_deck: Optional[str] = None
    per_player: Optional[bool] = False
    # Optionally add owners/scopes in future extension
    meta: Optional[Dict[str, Any]] = None

class VariableInstance(BaseModel):
    name: str
    per_player: Optional[bool] = False
    initial_value: Optional[Any] = None
    computed: Optional[Any] = None  # complex: use expr-model (future)

class Components(BaseModel):
    component_types: Optional[Dict[str, Dict[str, ComponentTypeDef]]] = None  # deck_types, zone_types, etc
    decks: Optional[Dict[str, DeckInstance]] = None
    zones: Optional[List[ZoneInstance]] = None
    variables: Optional[List[VariableInstance]] = None
    meta: Optional[Dict[str, Any]] = None

# --- Action/Setup Model --- #

class Action(BaseModel):
    action: str
    # Flexible: allow arbitrary keys
    params: Optional[Dict[str, Any]] = None
    # For atomic fields (common actions)
    from_: Optional[Any] = Field(None, alias="from")
    from_deck: Optional[str] = None
    to: Optional[Any] = None
    target: Optional[Any] = None
    player: Optional[Any] = None
    prompt: Optional[str] = None
    store_as: Optional[str] = None
    value: Optional[Any] = None
    condition: Optional[Any] = None

    class Config:
        extra = "allow"

# --- Condition & Expression System --- #

# Replaced with Expression Language (EL) string types
Condition = str
Operand = Union[str, int, float, bool, dict, list]


# ---- Flow (FSM) ---- #
class Transition(BaseModel):
    from_: str = Field(..., alias="from")
    to: str
    condition: Optional[str] = None

class StateDef(BaseModel):
    phases: Optional[List[str]] = None
    meta: Optional[Dict[str, Any]] = None

class Flow(BaseModel):
    states: Dict[str, StateDef]  # <-- changed from List[str] to Dict[str, StateDef]
    initial_state: str
    player_order: str  # 'clockwise', 'counterclockwise', 'simultaneous'
    transitions: Optional[List[Transition]] = Field(default_factory=list)
    win_condition: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

# --- Rule System --- #

class EffectAction(BaseModel):
    action: str
    params: Optional[Dict[str, Any]] = None
    from_: Optional[Any] = Field(None, alias="from")
    to: Optional[Any] = None
    player: Optional[Any] = None
    target: Optional[Any] = None
    count: Optional[Union[int, str, Dict[str, Any]]] = None
    filter: Optional[str] = None
    value: Optional[Any] = None
    prompt: Optional[str] = None
    store_as: Optional[str] = None
    condition: Optional[str] = None
    state: Optional[str] = None
    players: Optional[str] = None
    order: Optional[str] = None
    do_: Optional[List["EffectAction"]] = Field(None, alias="do")
    options: Optional[Dict[str, Any]] = None
    property: Optional[str] = None

    class Config:
        extra = "allow"

EffectAction.update_forward_refs()

class Rule(BaseModel):
    id: str
    trigger: str
    condition: Optional[str] = None
    effect: Optional[List[EffectAction]] = None
    description: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None

# --- Top-level CGML Object --- #

class CgmlDefinition(BaseModel):
    cgml_version: Union[float, str]  # v1.2+
    meta: Meta
    imports: Optional[List[Any]] = None
    components: Components
    setup: List[Action]
    flow: Flow
    rules: List[Rule]
# ---- Loader ---- #

# Add the !include constructor for PyYAML+yaml_include
yaml.add_constructor(
    "!include",
    yaml_include.Constructor(base_dir=os.path.dirname(os.path.abspath(__file__)))
)

def load_cgml_file(file_path: str) -> Optional[CgmlDefinition]:
    """Loads and validates a CGML file (YAML), resolving all !include directives."""
    with open(file_path, "r") as f:
        dct = yaml.load(f, Loader=yaml.FullLoader)
    try:
        definition = CgmlDefinition(**dct)
        return definition
    except ValidationError as e:
        print("Validation failed:")
        print(e)
        return None

# Optionally add further utilities/methods as needed.

if __name__ == "__main__":
    import json

    # Generate the JSON schema for the top-level CgmlDefinition model
    schema = CgmlDefinition.schema()

    with open("../cgml.schema.json", "w") as f:
        json.dump(schema, f, indent=2)
