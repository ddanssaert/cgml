# Card Game Markup Language (CGML) Specification v1.2

## 1. Introduction & Guiding Principles

The Card Game Markup Language (CGML) is a formal, declarative, domain-specific language for describing the rules of turn-based, and phase-based, card games. Its core objective is to provide a machine- and human-readable standard for cataloging, comparing, simulating, and generating playable card games. The language is purpose-built for clarity, extensibility, and direct parsing by code.

CGML is guided by these principles:

- **Human-Readability:** Use intuitive YAML syntax. Game designers should understand and write CGML without programming expertise.
- **Machine-Parsability:** Rigid, formally defined structures, leveraging JSON Schema validation, enabling unambiguous, code-parsable files.
- **Fully Declarative Logic:** All logic and expressions are expressed as structured YAML objects—no embedded scripting, code, or string expressions.
- **Modularity & Reusability:** Prevent repetition; support hierarchical rule inheritance and the inclusion of component libraries through imports.
---

## 2. Core Architecture

A CGML card game is modeled by three meta-architectures:

1. **Game State Ontology:** Models all relevant facts (player list, variables, zones, each card’s location/owner).
2. **Finite State Machine (FSM):** The ordered progression of the game is a state machine (with possible turn/phase nesting and transitions).
3. **Trigger-Condition-Effect (TCE) Engine:** Dormant rules, each consisting of a trigger (event), a structured condition, and a sequenced effect, drive moment-to-moment gameplay.

---

## 3. Language Specification

A CGML file is a `.cgml` (YAML) document. Its top-level structure and component requirements are as follows:

### 3.1 Top-Level Structure

Every file includes the following root keys:

|Key|Required|Description|
|---|---|---|
|`cgml_version`|Yes|CGML version, e.g. `"1.2"`.|
|`meta`|Yes|Metadata: name, author, player count, etc.|
|`imports`|No|List of external file directives for modular components/rules.|
|`components`|Yes|Definitions and instances for all decks, zones, variables, etc.|
|`setup`|Yes|Ordered atomic actions to initialize the game state.|
|`flow`|Yes|FSM structure: states, transitions, turn/phase organization, win condition.|
|`rules`|Yes|All TCE rules that govern game behavior.|

---

### 3.2 The `meta` Block

Describes the game for humans and engines:

meta:
  name: "Name of the Game"
  author: "Designer"
  description: "One-sentence game summary."
  players:
    min: 2
    max: 4

**(Future-proof: Allow arbitrary meta fields anywhere via `meta` sub-blocks.)**

---

### 3.3 Modularity & Imports

Support reusability through two special YAML directives (implemented by the parser/engine, not standard YAML):

- **`!include`**: Inserts YAML content from an external file in place.
- **`!inherit`**: "Subclass" another rule file, inheriting all definitions, allowing selective overrides.

imports:
  - !include 'https://cgml.io/core-components/v1/deck-std52.yaml'
  - !include 'house_rules/common_zones.yaml'

On inheritance, the first line can be:
!inherit 'basegame.cgml'

**All imported/inherited fields should be schema-valid after merge.**

---

### 3.4 The `components` Block

Defines all "things" of the game by type (for reuse) and by instance:

components:
  component_types:
    deck_types:
      standard_52:
        composition: [{ type: template, template: standard_suits, values: [2,3,4,5,6,7,8,9,10,J,Q,K,A] }]
        rank_hierarchy: [2,3,4,5,6,7,8,9,10,J,Q,K,A]
    zone_types:
      discard_pile:
        ordering: lifo
        visibility: { all: top_card_only }
    # ...more types...

  decks:
    main_deck:
      type: standard_52

  zones:
    - name: deck
      type: discard_pile
      of_deck: main_deck
    - name: hand
      type: player_hand
      per_player: true
    # ...more...

  variables:
    - name: score
      per_player: true
      initial_value: 0
    # Optional: computed, see below

**Clarification: Support for `per_player`, `per_team`, or declared `scope/owner`.
Variable/zone scopes should be extensible for more complex games.
Optionally: computed variables using operator expressions.**

---

### 3.5 Setup

An ordered list of atomic initial actions:

setup:
  - { action: SHUFFLE, target: zones.deck }
  - { action: DEAL, from: zones.deck, to: zones.hand, count: 5 }

**All setup actions must be atomic and schema-validated.**

---

### 3.6 The Game Flow (`flow` Block)

Models the game and turn FSM:

flow:
  states: [ Setup, Playing, GameOver ]
  initial_state: Playing
  player_order: clockwise
  turn_structure:
    - DrawPhase
    - PlayPhase
    - EndPhase
  transitions:
    - from: Playing
      to: GameOver
      condition:
        isEqual:
          - path: game.deck.card_count
          - value: 0
  win_condition:
    description: "Score highest wins."
    evaluator:
      max:
        - path: players.score

**Add:
Explicit `turn_structure` is mandatory, and must enumerate all used phases.
Support nested turn and state FSM structure for more complex or variable flows.
Allow `player_order` of `simultaneous` for non-turn-based games.**

---

### 3.7 Rule System (`rules` Block / TCE)

Rules are defined as a list, each with an ID, trigger, optional condition, and one or more atomic effects.

rules:
  - id: play_card_limit
    description: "Reject play if card is not high enough."
    trigger: on.play
    condition:
      isLessThan:
        - path: card.played.rank
        - path: zone.discard.top_card.rank
    effect:
      - { action: REJECT_PLAY, reason: "Too low." }
      - { action: RETURN_TO_HAND, card: card.played }

**All rule condition and effect logic must be defined solely in terms of the core operator expression syntax (see next section). New actions, triggers, or operators must be defined in the schema and in the evolving language documentation.**

---

### 3.8 Condition & Expression Language

All logical tests (for rule conditions, transitions, win evaluators, computed variables, etc.) use a unified operator-based, strictly composable expression language:

- **Operands:** can be:
  - Literal: { value: 10 } or { value: "J" }
  - Path: { path: 'player.current.score' }
  - Nested: another operator/expression

- **Syntax:**
  isGreaterThan:
    - path: player.0.score
    - path: player.1.score

  Operators must always use lists, with only one operator (the key) at the current level.

- **Core Operators:**

|Operator|Operands|Description|
|--------|--------|-----------|
|`isEqual`|2|True if values are equal|
|`isGreaterThan`|2|True if 1st > 2nd|
|`isLessThan`|2|True if 1st < 2nd|
|`and`|2+|True if all expressions are true|
|`or`|2+|True if any expression is true|
|`not`|1|Logical negation|
|`any`|1 (list)|True if any item matches predicate|
|`all`|1 (list)|True if all items match predicate|
|`max`|1 (list)|Maximum in a list|
|`min`|1 (list)|Minimum in a list|
|`count`|1 (list)|Cardinality of a list|

**Add new operators only as needed, updating the schema and documentation. All condition-based syntax must align with this structure (no ad hoc or "custom" operators).**

---

### 3.9 Effects and Actions

- Effects are structured as lists of atomic actions.
- **Actions may:**
  - Move cards
  - Request player input
  - Set/modify variables
  - Control FSM state/flow
  - Trigger other rules/side effects
- **Actions must be only those defined in the CGML action vocabulary.**
- New action types must be registered in schema and documentation.

effect:
  - action: MOVE
    from: player.0.hand
    to: player.1.books
    filter:
      isEqual:
        - path: card.rank
        - value: "A"
  - action: SET_VARIABLE
    path: player.0.book_count
    value:
      operator: "+"
      operands:
        - path: player.0.book_count
        - value: 1

**Best practice:** Effects should be composed of simple, atomic actions for easier analysis, simulation, and error detection.

---

### 3.10 Player Input & Data References

- **Player choices are requested by `REQUEST_INPUT` actions:**
  - Specify: who must decide, prompt text, possible choices (option lists or filtered collections), `store_as` for variable results.
  - This result is referenced later by its stored name (e.g., `ref:variable_name`).

- **Scoping of temporary variables:**
  - Values returned from actions via `store_as` are only in scope for the remainder of the rule chain unless otherwise declared.

**Example:**

effect:
  - action: REQUEST_INPUT
    player: current
    prompt: "Choose a player to ask."
    options:
      filter:
        not:
          isEqual:
            - path: player.id
            - path: player.current.id
    store_as: selected_player
  - action: MOVE
    from: ref:selected_player.hand
    to: player.current.hand
    filter:
      isEqual:
        - path: card.rank
        - value: ref:desired_rank

**Clarify in the language specification how `ref:` scoping and lifetimes work, and publish examples.**

---

### 3.11 Advanced Topics / Extensions (**Optional for v1.2**)

- Support for team/coop games: variable/zone scopes, player groupings.
- Nested/Flexible FSMs: e.g., sub-phases, conditional subturns.
- Computed Variables: Allow variables or fields whose value is always derived from operator expressions.
- Error Handling: Rules for what happens if actions are not possible (e.g., illegal moves), fallbacks.
- Meta/comments: Allow meta fields or doc/comments in any block.

---

## 4. Validation

All CGML files must be valid according to the current authoritative JSON Schema. This includes all imported/inherited content following merge. Files failing validation must be rejected (with clear error reporting).

---
# Implementation & Evolution

- **Trunk:** Build the foundation, including schema, parser, and engine.
- **Branches:** Each “novel” game or new mechanic forms a new micro-version (vocabulary, operator, or effect addition) after updating the schema and documentation.
- **Community Process:** New rules/constructs must be submitted back for inclusion to prevent fragmenting/splintering.

---

# Changelog

**v1.2**
- Unified operator/condition language (no ad hoc conditions).
- Clarified player input, referencing, and scoping for effects/results.
- Requirement for explicit FSM phases/turn structure.
- Formalized imports/inheritance mechanisms.
- Extended action vocabulary organization.
- Explicit process for schema/language extension.
