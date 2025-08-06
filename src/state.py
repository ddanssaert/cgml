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
    Resolve a zone path string to a Zone object.
    Supports:
        - "zones.<zone_name>"    (shared or per-player, disambiguation by 'player' param)
        - "<zone_name>"          (same as above)
        - "player.<idx>.<zone_name>" (explicit per-player zone)
    """
    if zone_path.startswith("player."):
        parts = zone_path.split('.')
        if len(parts) >= 3:
            p_idx = int(parts[1])
            z_name = parts[2]
            if 0 <= p_idx < len(state.players):
                return state.players[p_idx].zones[z_name]
            else:
                raise IndexError(f"Player index {p_idx} out of range in zone_path: {zone_path}")
        else:
            raise ValueError(f"Invalid player zone path: {zone_path}")

    if zone_path.startswith('zones.'):
        zone_name = zone_path.split('.', 1)[1]
        if player and zone_name in player.zones:
            return player.zones[zone_name]
        elif zone_name in state.shared_zones:
            return state.shared_zones[zone_name]
        # fallback to any player's zone
        for p in state.players:
            if zone_name in p.zones:
                return p.zones[zone_name]

    # Direct per-player zone by param
    if player and zone_path in player.zones:
        return player.zones[zone_path]
    # Or shared zone
    if zone_path in state.shared_zones:
        return state.shared_zones[zone_path]
    # Final fallback: per-player
    for p in state.players:
        if zone_path in p.zones:
            return p.zones[zone_path]
    raise ValueError(f"Zone '{zone_path}' not found")

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
