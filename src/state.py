from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Union
import random

@dataclass
class Card:
    id: str
    name: str
    properties: Dict[str, Any]
    owner: Optional[int] = None  # player id if applicable

@dataclass
class Zone:
    name: str
    type: str
    of_deck: Optional[str] = None
    owner: Optional[int] = None      # player id or None for shared
    ordering: Optional[str] = None
    visibility: Optional[Dict[str, str]] = None
    cards: List[Card] = field(default_factory=list)

    @property
    def card_count(self) -> int:
        """Returns the number of cards currently in this zone."""
        return len(self.cards)

    @property
    def top_card(self) -> Optional['Card']:
        """Returns the top card in this zone (last if LIFO/FIFO, first if empty), or None if zone is empty."""
        if not self.cards:
            return None
        return self.cards[-1]

@dataclass
class Player:
    id: int
    name: str
    variables: Dict[str, Any] = field(default_factory=dict)
    zones: Dict[str, Zone] = field(default_factory=dict)

@dataclass
class GameState:
    players: List[Player] = field(default_factory=list)
    shared_zones: Dict[str, Zone] = field(default_factory=dict)
    shared_variables: Dict[str, Any] = field(default_factory=dict)
    decks: Dict[str, List[Card]] = field(default_factory=dict)
    cgml_definition: Any = None     # Optionally reference to loaded CgmlDefinition

def create_deck(deck_def: dict, deck_type_def: Any) -> List[Card]:
    cards = []
    comp = deck_type_def.composition if hasattr(deck_type_def, "composition") else []
    idx = 0
    for entry in comp:
        if entry.get("type") == "template" and entry.get("template") == "standard_suits":
            ranks = entry.get("values")
            suits = ["♠", "♥", "♦", "♣"]
            for suit in suits:
                for rank in ranks:
                    idx += 1
                    card_id = f"{deck_def['type']}-{suit}-{rank}-{idx}"
                    card_name = f"{rank}{suit}"
                    cards.append(Card(
                        id=card_id,
                        name=card_name,
                        properties={"rank": rank, "suit": suit}
                    ))
    return cards

def build_game_state_from_cgml(cgml: Any, player_count: int = None) -> GameState:
    deck_types = cgml.components.component_types.get('deck_types', {}) if cgml.components.component_types else {}
    decks = {}
    for deck_name, deck_def in (cgml.components.decks or {}).items():
        deck_type_def = deck_types.get(deck_def.type, {})
        decks[deck_name] = create_deck(deck_def.dict(), deck_type_def)

    player_count = player_count or cgml.meta.players.max
    players = []
    var_defs = cgml.components.variables if cgml.components.variables else []
    per_player_vars = {v.name: v.initial_value for v in var_defs if v.per_player}
    shared_vars = {v.name: v.initial_value for v in var_defs if not v.per_player}

    zone_defs = cgml.components.zones or []
    shared_zones: Dict[str, Zone] = {}
    per_player_zone_defs = [z for z in zone_defs if getattr(z, "per_player", False)]
    shared_zone_defs = [z for z in zone_defs if not getattr(z, "per_player", False)]

    for pidx in range(player_count):
        pname = f"Player {pidx + 1}"
        player = Player(id=pidx, name=pname)
        player.variables = {k: v for k,v in per_player_vars.items()}
        for zone_def in per_player_zone_defs:
            zone = Zone(
                name=zone_def.name,
                type=zone_def.type,
                of_deck=getattr(zone_def, 'of_deck', None),
                owner=pidx
            )
            player.zones[zone.name] = zone
        players.append(player)

    for zone_def in shared_zone_defs:
        shared_zones[zone_def.name] = Zone(
            name=zone_def.name,
            type=zone_def.type,
            of_deck=getattr(zone_def, 'of_deck', None),
            owner=None
        )

    state = GameState(
        players=players,
        shared_zones=shared_zones,
        shared_variables=shared_vars,
        decks=decks,
        cgml_definition=cgml
    )

    # Assign the cards (by reference!) from deck into the appropriate zone at setup
    for deck_name, cards in decks.items():
        assigned = False
        for zone in state.shared_zones.values():
            if getattr(zone, 'of_deck', None) == deck_name:
                zone.cards.extend(cards)
                assigned = True
        for player in state.players:
            for zone in player.zones.values():
                if getattr(zone, 'of_deck', None) == deck_name:
                    zone.cards.extend(cards)
                    assigned = True
        if not assigned:
            print(f"Warning: Deck '{deck_name}' was generated but not assigned to any zone!")

    return state

def find_zone(state: GameState, zone_path: str, player: Player = None) -> Zone:
    """
    Resolves a dot-path to a Zone object within the GameState.
    - Supports: 'players.0.zones.discard', 'player.1.winnings', 'zones.deck', 'deck'
    - Raises ValueError if the resolved object is not a Zone.

    If player is given and 'zone_path' is a single zone name, looks up in player.zones first.
    """
    # Shortcut: if just a single word, use player zone/then shared
    if '.' not in zone_path:
        if player and zone_path in player.zones:
            return player.zones[zone_path]
        if zone_path in state.shared_zones:
            return state.shared_zones[zone_path]
        for p in state.players:
            if zone_path in p.zones:
                return p.zones[zone_path]
        raise ValueError(f"Zone '{zone_path}' not found.")

    # Build starting context
    ctx = {
        "players": state.players,
        "zones": state.shared_zones,
        "shared_zones": state.shared_zones,
    }
    if player:
        ctx["player"] = player

    current = ctx
    for part in zone_path.split('.'):
        # If list, try integer index
        if isinstance(current, list):
            try:
                idx = int(part)
                current = current[idx]
            except Exception:
                raise KeyError(f"Cannot index list with '{part}'")
        # If dict, use key
        elif isinstance(current, dict):
            if part in current:
                current = current[part]
            else:
                raise KeyError(f"Key '{part}' not found.")
        # If dataclass/object, use attribute
        elif hasattr(current, part):
            current = getattr(current, part)
        else:
            raise KeyError(f"Cannot resolve part '{part}' in object {current}")

    # Final check: ensure this is a Zone
    if not isinstance(current, Zone):
        raise ValueError(f"Path '{zone_path}' does not resolve to a Zone (got {type(current).__name__})")
    return current

def shuffle_zone(zone: Zone):
    random.shuffle(zone.cards)
def move_cards(from_zone: Zone, to_zone: Zone, count: int = 1):
    for _ in range(min(count, len(from_zone.cards))):
        to_zone.cards.append(from_zone.cards.pop(0))

def move_all_cards(from_zone: Zone, to_zone: Zone):
    while from_zone.cards:
        to_zone.cards.append(from_zone.cards.pop(0))

def deal_cards(from_zone: Zone, players: List[Player], to_zone_name: str, count: int):
    for _ in range(count):
        for player in players:
            if from_zone.cards:
                player.zones[to_zone_name].cards.append(from_zone.cards.pop(0))

def deal_all_cards(from_deck: Zone, players: List[Player], to_zone_name: str):
    idx = 0
    pl_count = len(players)
    while from_deck.cards:
        player = players[idx % pl_count]
        player.zones[to_zone_name].cards.append(from_deck.cards.pop(0))
        idx += 1

def perform_setup_action(action: dict, state: GameState):
    """Perform a single setup action as defined in CGML's 'setup'."""
    typ = action['action']
    if typ == "SHUFFLE":
        # Expects 'target': <zone path>
        target = action.get("target")
        if target and target.startswith("zones."):
            # Shuffle per-player or shared
            for player in state.players:
                if target.split('.')[1] in player.zones:
                    shuffle_zone(player.zones[target.split('.')[1]])
            if target.split('.')[1] in state.shared_zones:
                shuffle_zone(state.shared_zones[target.split('.')[1]])
    elif typ == "DEAL":
        from_zone = find_zone(state, action['from'])
        to_zone_name = action['to'].split('.')[-1]  # expects 'zones.hand' style
        count = action['count']
        deal_cards(from_zone, state.players, to_zone_name, count)
    elif typ == "MOVE":
        from_zone = find_zone(state, action['from'])
        to_zone = find_zone(state, action['to'])
        count = action.get('count', 1)
        move_cards(from_zone, to_zone, count)
    elif typ == "MOVE_ALL":
        from_zone = find_zone(state, action['from'])
        to_zone = find_zone(state, action['to'])
        move_all_cards(from_zone, to_zone)
    elif typ == "DEAL_ALL":
        # Used in War (deals all deck cards to per-player zones)
        from_deck_name = action['from_deck']  # e.g., "main_deck"
        to_zone_name = action['to'].split('.')[-1]
        # Find the initial deck zone holding the cards:
        deck_zone = None
        for z in state.shared_zones.values():
            if getattr(z, "of_deck", None) == from_deck_name:
                deck_zone = z
                break
        if not deck_zone:
            for p in state.players:
                for z in p.zones.values():
                    if getattr(z, "of_deck", None) == from_deck_name:
                        deck_zone = z
                        break
        if not deck_zone:
            raise RuntimeError(f"DEAL_ALL: Deck zone for {from_deck_name} not found.")
        deal_all_cards(deck_zone, state.players, to_zone_name)
    else:
        raise NotImplementedError(f"Unknown setup action: {typ}")

def run_setup_phase(state: GameState):
    """Runs all setup actions from the CGML file."""
    for action in state.cgml_definition.setup:
        # If using Pydantic models for actions:
        if hasattr(action, "dict"):
            d = action.dict(by_alias=True)
        else:
            d = dict(action)
        perform_setup_action(d, state)

# --- Usage for setup phase ---

# cgml = load_cgml_file("mygame.yml")
# state = build_game_state_from_cgml(cgml)
# run_setup_phase(state)
