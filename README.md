# Card Game Markup Language (CGML) Specification v1.3

CGML is a formal, declarative, domain-specific language for turn/phase-based card games. Its goal is a human-friendly yet strictly machine-parseable standard for cataloging, comparing, simulating, and generating playable card games.

This document is the authoritative specification for CGML v1.3.

---
## 1. Introduction & Guiding Principles

CGML is guided by these principles:

- Human-Readability: Intuitive YAML with minimal ceremony; game designers can author without programming expertise.
- Machine-Parsability: Rigid, schema-validated structures using JSON Schema; no ad hoc fields outside defined extension points.
- Fully Declarative Logic: No embedded scripts; all logic expressed as structured operators and action objects.
- Modularity & Reusability: Imports/inheritance for reuse and extension; avoid repetition.
- Determinism-First: Clear semantics for simultaneity, randomness, and ordering to enable reproducible simulations.

---
## 2. Core Architecture

A CGML game is defined by:

1) Game State Ontology: All facts (players, variables, zones, cards, ownership, visibility).

2) Finite State Machine (FSM): Overall game flow, with states and phases (turn structure).

3) Trigger–Condition–Effect (TCE) Engine: Rules that listen to events, test conditions, and apply atomic effects.

---
## 3. File Format and Top-Level Structure
CGML files are YAML with extension `.cgml` (or `.yml`/`.yaml` when context makes it clear). After all imports/inheritance are resolved, the merged document must validate against the CGML JSON Schema.

### 3.1 Top-Level Keys

| Key | Required | Description |
|---|---|---|
| `cgml_version` | Yes | Must be `"1.3"` for this spec. |
| `meta` | Yes | Metadata and engine hints. |
| `imports` | No | External files to include or inherit from (see §5). |
| `components` | Yes | All deck/zone/variable types and instances. |
| `setup` | Yes | Ordered atomic actions to initialize the game. |
| `flow` | Yes | FSM states, phases, transitions, turn order, win condition. |
| `rules` | Yes | TCE rules. |

---
## 4. Meta Block

Describes the game and simulation hints.

Example
```yaml examples/meta.yaml
meta:
  name: "Name of the Game"
  author: "Designer"
  description: "One-sentence summary."
  players:
    min: 2
    max: 4
  rng:
    deterministic: true       # default false
    seed: 12345               # optional seed for reproducibility
  meta:                       # extension-friendly nested metadata (any shape)
    genre: "trick-taking"
```

Notes
- Arbitrary meta fields are allowed inside a dedicated `meta` sub-block at any level that supports it.
- Engines should ignore unknown meta fields.

---
## 5. Modularity: Imports and Inheritance

CGML supports two special YAML directives (implemented by the CGML loader; not standard YAML):

- `!include 'path-or-url'` — Inlines external YAML at that location before validation.
- `!inherit 'base.cgml'` — Treats current document as a child of base, inheriting all top-level sections (`components`, `setup`, `flow`, `rules`, `meta`). Child may override/extend following merge rules.

### 5.1 Merge and Override Rules
- Object maps merge shallowly by key; child keys override parent.
- Arrays merge by stable identity:
  - `rules`: by `id`
  - `components.decks`: by `name`
  - `components.zones`: by `name`
  - `components.component_types.*`: by type/name (e.g., `deck_types.standard_52`)
  - `transitions`: by `(from, to, optional id)`, otherwise append
- To override a specific array entry, reuse the same id/name. To delete, set `disabled: true`.
- Rules may refine existing rules via `extends: <rule_id>` to indicate intent (advisory; engines may validate relation).
- After merge, the resulting document must be schema-valid.

Example
```yaml examples/imports_inherit.yaml
imports:
  - !include 'https://cgml.io/core-components/v1/standard_52.yaml'
!inherit 'trick_taking_base.cgml'
```

---
## 6. Path and Selector Language

CGML uses a minimal, JSONPath-inspired selector syntax inside path operands and action references.

### 6.1 Basics
- `$` is the document root (post-merge).
- `$.players` is an ordered list of player objects.
- Indexing: `$.players[0]`, `$.players[1]`
- Filters (optional in v1.3): `$.players[by_id=alice]`, `$.players[current]`, `$.players[opponent]`, `$.players[team=red]`
- Zone access: `$.players[*].zones.<zone_name>` and `$.zones.<zone_name>` for global zones.
### 6.2 Shorthands/functions
- `top(<zone or list>)`
- `bottom(<zone or list>)`
- `all(<zone>)` -> list of cards
- `count(<zone or list>)` -> integer
- `owner(<card>)`
- `rank(<card>)` -> rank symbol/value
- `rank_value(<rank or card>)` -> numeric ordinal based on deck type’s `rank_hierarchy`

### 6.3 Anchors
- `$currentPlayer`, `$activeState`, `$currentPhase`, `$turnOrder`
- Engines provide these anchors according to the flow (see §9).

### 6.4 Card Property Access
Cards may include properties (e.g., suit, rank); access via card fields and operators:
```yaml examples/path_card_access.yaml
# Operator style
rank_value:
  - top:
      - path: "$.players[0].zones.play_area"

# Property access (engine-normalized)
isEqual:
  - path: "$.players[0].zones.play_area.top_card.properties.rank"
  - value: "A"
```

### 6.5 Selectors in Operands and Action Parameters
- In operator operands and action parameters, use:
  - `path: "<selector>"` for paths
  - `value: <literal>` for constants
  - `ref: "<temp_name>"` for temporary values created via `store_as` (see §11)
  - nested operator objects (e.g., `top: [ { path: "..." } ]`)

Note: Path strings MAY include `ref` placeholders like `ref:<name>` where engines substitute the referenced value before evaluation.

---
## 7. Components Block

Defines reusable types and concrete instances.

### 7.1 Component Types
- `component_types.deck_types.<name>`
  - `composition`: list of card templates (e.g., suits × ranks)
  - `rank_hierarchy`: ordered list of ranks for comparison
  - `default_properties`: optional per-card defaults

- `component_types.zone_types.<name>`
  - `ordering`: `unordered | fifo | lifo | shuffled`
  - `visibility`: controls who can see cards in the zone
    - `owner`: `all | count_only | hidden | top_card_only`
    - `others`: `all | count_only | hidden | top_card_only`
    - `all`: same options (applies to everyone)
  - `default_face`: `up | down` (default: `up`)
  - `allows_reorder`: `true|false` (default: `false`)

### 7.2 Decks
- `components.decks.<deck_name>`
  - `type`: `deck_types.<name>`

### 7.3 Zones
- `components.zones` is a list of zone instances
  - `name`: string (unique within scope)
  - `type`: `zone_types.<name>`
  - `of_deck`: `<deck_name>` (required when the zone stores cards)
  - `per_player`: `true|false` (default: `false`)
  - `owner_scope`: `player|team|global` (default: `global`)
  - `meta`: optional

Examples
```yaml examples/components.yaml
components:
  component_types:
    deck_types:
      standard_52:
        composition:
          - type: template
            template: standard_suits
            values: [2,3,4,5,6,7,8,9,10,J,Q,K,A]
        rank_hierarchy: [2,3,4,5,6,7,8,9,10,J,Q,K,A]
    zone_types:
      draw_pile:
        ordering: shuffled
        visibility: { all: count_only }
      player_hand:
        ordering: unordered
        visibility:
          owner: all
          others: count_only
  decks:
    main_deck:
      type: standard_52
  zones:
    - name: deck
      type: draw_pile
      of_deck: main_deck
    - name: hand
      type: player_hand
      per_player: true
```

### 7.4 Variables
- `components.variables`: list of variable definitions
  - `name`: string
  - `scope`: `global | per_player | per_team` (default: `global`)
  - `initial_value`: literal (or expression if `computed=true`)
  - `computed`: `true|false` (default: `false`)
  - `expression`: operator expression (required if `computed=true`)

Example
```yaml examples/variables.yaml
components:
  variables:
    - name: score
      scope: per_player
      initial_value: 0
    - name: total_cards
      computed: true
      expression:
        sum:
          - count:
              - path: "$.players[0].zones.deck"
          - count:
              - path: "$.players[1].zones.deck"
```

---
## 8. Setup

Ordered list of atomic actions executed before play.

Example
```yaml examples/setup.yaml
setup:
  - action: SHUFFLE
    target:
      path: "$.zones.deck"
  - action: DEAL_ROUND_ROBIN
    from:
      path: "$.zones.deck"
    to:
      path: "$.players[*].zones.hand"
    count: 5
```

Notes
- All setup actions must be schema-valid.
- See Actions Vocabulary (see §13).

---
## 9. Flow: States, Phases, Turns, and Transitions

CGML models game progression with states and phases.

### 9.1 Canonical Form
```yaml examples/flow_canonical.yaml
flow:
  states:
    Playing:
      phases: [DrawPhase, PlayPhase, EndPhase]
    GameOver:
      phases: []
  initial_state: Playing
  player_order: clockwise # or counterclockwise | simultaneous
  transitions:
    - id: to_game_over_when_no_cards
      from: Playing
      to: GameOver
      condition:
        or:
          - isEqual:
              - sum:
                  - count: [ { path: "$.players[0].zones.deck" } ]
                  - count: [ { path: "$.players[0].zones.winnings" } ]
              - value: 0
          - isEqual:
              - sum:
                  - count: [ { path: "$.players[1].zones.deck" } ]
                  - count: [ { path: "$.players[1].zones.winnings" } ]
              - value: 0
  win_condition:
    description: "Most cards wins"
    evaluator:
      max:
        - list:
            - add:
                - count: [ { path: "$.players[0].zones.deck" } ]
                - count: [ { path: "$.players[0].zones.winnings" } ]
            - add:
                - count: [ { path: "$.players[1].zones.deck" } ]
                - count: [ { path: "$.players[1].zones.winnings" } ]
```

### 9.2 Turn Structure
- Phases are ordered labels looping as per state logic; engines step phase-by-phase within the active state.
- `player_order` applies to per-turn action sequencing within phases when relevant.
- Dynamic order changes use actions (`REVERSE_ORDER`, `SKIP_TURN`, `EXTRA_TURN`).

### 9.3 Simultaneity Semantics
- `simultaneous` means per-player operations in a phase are conceptually batched; rules in that phase fire once, but actions may iterate all players (`FOR_EACH_PLAYER`) with `order: simultaneous`.
- Where conflicts arise (e.g., both reveal highest card), engines must resolve according to deterministic tie-breakers (seating order, then player id), unless rules specify otherwise.

---
## 10. Rule System (TCE)
Rules are a list; each has `id`, `trigger`, optional `timing`, optional `condition`, and an `effect` (list of actions).

```yaml examples/rule_shape.yaml
rules:
  - id: unique_string
    description: "Optional"
    trigger: on.phase.PlayPhase            # see §10.1
    timing: post                           # pre | post | replace (default post)
    priority: 0                            # higher runs first
    once_per: phase                        # turn | phase | game
    enabled_when:
      isEqual:
        - path: "$.players[current].can_play"
        - value: true
    condition:
      and:
        - exists: [ { path: "$.players[current].zones.hand" } ]
        - isGreaterThan:
            - count: [ { path: "$.players[current].zones.hand" } ]
            - value: 0
    effect:
      - action: MOVE
        from:
          top:
            - path: "$.players[current].zones.hand"
        to:
          path: "$.players[current].zones.play_area"
    on_failure: abort                       # continue | abort | rollback
    store_as: last_moved                    # temp binding of last action result
```

### 10.1 Events and Triggers
- `on.state.enter.<StateName>`, `on.state.exit.<StateName>`
- `on.phase.<PhaseName>`                      # fired when entering the phase
- `on.turn.begin`, `on.turn.end`              # if sequential turns apply
- `on.draw`, `on.play`, `on.discard`, `on.move`     # engines may emit standardized events
- Custom domain events allowed if declared in schema extension
- `timing: replace` rules replace the event’s default behavior

---
## 11. Temporary Values, Refs, and Scope
- Actions may return values. Use `store_as: <temp_name>` to bind a temporary variable for the current rule evaluation chain.
- `ref: <temp_name>` references the temporary value later in the same rule’s effect.
- Scope and lifetime: valid from the step it was stored until the end of that rule’s effect; not visible to other rules unless action explicitly persists state (e.g., `SET_VARIABLE`).
- For player iteration (`FOR_EACH_PLAYER`), the loop introduces `$player` as a local anchor; nested `store_as` are visible within the loop body.
- Paths may include placeholders like `ref:<name>`, which engines substitute before evaluation.

Example
```yaml examples/refs.yaml
effect:
  - action: REQUEST_INPUT
    player: current
    prompt: "Choose opponent"
    options:
      path: "$.players[opponent]"
    store_as: selected_player
  - action: MOVE
    from:
      top:
        - path: "$.players[by_id=ref:selected_player].zones.hand"
    to:
      path: "$.players[current].zones.hand"
```

---
## 12. Expression Language (Operators)

All logical tests and computed expressions use a composable operator language.

### 12.1 Operand Types
- `value`: literal (number, string, boolean)
- `path`: selector string (see §6)
- `ref`: temporary variable name (see §11)
- nested operator: object with a single operator key

### 12.2 Core Boolean and Comparison
- `isEqual: [a, b]`
- `isGreaterThan: [a, b]`
- `isLessThan: [a, b]`
- `not: [expr]`
- `and: [expr, expr, ...]`
- `or: [expr, expr, ...]`

### 12.3 List and Aggregation
- `any: [list_expr, predicate?]`  # if predicate omitted, truthy check
- `all: [list_expr, predicate?]`
- `count: [list_expr]`
- `len: [list_expr or string]`
- `max: [list_expr]`
- `min: [list_expr]`
- `contains: [list_expr, item_expr]`
- `in: [item_expr, list_expr]`
- `exists: [path_expr]`

### 12.4 Math
- `add: [a, b]`
- `sub: [a, b]`
- `mul: [a, b]`
- `div: [a, b]`
- `mod: [a, b]`
- `sum: [a, b, c, ...]`
- `avg: [a, b, c, ...]`

### 12.5 Card/Rank Helpers
- `rank_value: [rank_or_card]`     # resolves using deck type’s `rank_hierarchy`

### 12.6 Action Feasibility
- `canPerform: [{ action: <ActionName>, ...params }]`  # optional; engines may simulate dry-run validation

### 12.7 Operator Syntax Rules
- One operator per object level; operator value is a list (operands) unless noted.
- Operands themselves may be `value`, `path`, `ref`, or nested operator objects.

---
## 13. Actions Vocabulary

Effects are sequences of atomic actions. Engines must document supported actions. CGML v1.3 standardizes the following actions (concise definitions):

Notes
- In all actions, parameters that reference entities (`from`, `to`, `target`, `zone`, `player`, etc.) accept operands: path/ref/value/nested operator (e.g., `top: [ ... ]`).
- Actions execute sequentially within an effect unless wrapped by `PARALLEL`.
- If an action fails:
  - Default behavior: abort remaining actions in this effect (no rollback); earlier actions remain applied.
  - Rules may set `on_failure: continue|abort|rollback`. Rollback requires engine support; otherwise treated as abort.

### 13.1 Card Movement
```yaml examples/actions_move.yaml
# MOVE
- action: MOVE
  from:
    path: "$.players[0].zones.hand"
  to:
    path: "$.players[0].zones.play_area"
  count: 1
  filter:
    isEqual:
      - path: "$.card.properties.rank"
      - value: "A"

# MOVE_ALL
- action: MOVE_ALL
  from:
    path: "$.players[1].zones.play_area"
  to:
    path: "$.players[0].zones.winnings"

# DEAL
- action: DEAL
  from:
    path: "$.zones.deck"
  to:
    path: "$.players[0].zones.hand"
  count: 5

# DEAL_ROUND_ROBIN
- action: DEAL_ROUND_ROBIN
  from:
    path: "$.zones.deck"
  to:
    path: "$.players[*].zones.hand"
  count: 1
  order: clockwise

# DEAL_ALL
- action: DEAL_ALL
  from:
    path: "$.zones.deck"
  to:
    path: "$.players[*].zones.player_deck"
```

### 13.2 Reveal/Visibility/Face State
```yaml examples/actions_visibility.yaml
# REVEAL
- action: REVEAL
  target:
    all:
      - path: "$.players[*].zones.play_area"
  to: all

# CONCEAL
- action: CONCEAL
  target:
    path: "$.players[opponent].zones.hand"
  from: others

# FLIP
- action: FLIP
  target:
    top:
      - path: "$.players[current].zones.play_area"

# PEEK
- action: PEEK
  players: [current]
  target:
    top:
      - path: "$.players[opponent].zones.deck"

# LOOK
- action: LOOK
  player: current
  target:
    path: "$.players[current].zones.discard"
```

### 13.3 Searching/Randomization/Order
```yaml examples/actions_random_search.yaml
# SHUFFLE
- action: SHUFFLE
  target:
    path: "$.players[current].zones.deck"

# REORDER
- action: REORDER
  target:
    path: "$.players[current].zones.discard"
  by: top

# CHOOSE_RANDOM
- action: CHOOSE_RANDOM
  from:
    path: "$.players[current].zones.hand"
  count: 1
  store_as: random_card

# SEARCH_ZONE
- action: SEARCH_ZONE
  zone:
    path: "$.players[current].zones.deck"
  filter:
    isEqual:
      - path: "$.card.properties.rank"
      - value: "A"
  max: 1
  store_as: found

# MILL
- action: MILL
  from:
    path: "$.players[opponent].zones.deck"
  to:
    path: "$.players[opponent].zones.discard"
  count: 2

# REVEAL_MATCHING
- action: REVEAL_MATCHING
  from:
    path: "$.players[current].zones.hand"
  filter:
    isEqual:
      - path: "$.card.properties.suit"
      - value: "H"
```

### 13.4 Variables and State
```yaml examples/actions_state.yaml
# SET_VARIABLE
- action: SET_VARIABLE
  path:
    path: "$.players[current].score"
  value:
    add:
      - path: "$.players[current].score"
      - value: 1

# INCREMENT
- action: INCREMENT
  path:
    path: "$.turns_taken"
  by: 1

# SET_STATE (alias: SET_GAME_STATE)
- action: SET_STATE
  state: GameOver

# SET_PHASE
- action: SET_PHASE
  phase: EndPhase
```

### 13.5 Flow Modifiers
```yaml examples/actions_flow_modifiers.yaml
# SKIP_TURN
- action: SKIP_TURN
  player: current

# EXTRA_TURN
- action: EXTRA_TURN
  player: current

# REVERSE_ORDER
- action: REVERSE_ORDER

# INSERT_PHASE
- action: INSERT_PHASE
  after: PlayPhase
  phase: BonusPhase

# REMOVE_PHASE
- action: REMOVE_PHASE
  name: BonusPhase
```

### 13.6 Player Input
```yaml examples/actions_input.yaml
# REQUEST_INPUT
- action: REQUEST_INPUT
  player: current
  prompt: "Choose a rank"
  options:
    value: ["2","3","4","5","6","7","8","9","10","J","Q","K","A"]
  multiselect: false
  store_as: desired_rank
```

### 13.7 Control and Structure
```yaml examples/actions_control.yaml
# FOR_EACH_PLAYER (simultaneous flip)
- action: FOR_EACH_PLAYER
  order: simultaneous
  players:
    path: "$.players[*]"
  do:
    - action: MOVE
      from:
        top:
          - path: "$.players[$player].zones.player_deck"
      to:
        path: "$.players[$player].zones.play_area"

# PARALLEL (wait for all branches)
- action: PARALLEL
  wait: all
  do:
    - action: MOVE
      from:
        path: "$.players[0].zones.play_area"
      to:
        path: "$.players[0].zones.winnings"
    - action: MOVE
      from:
        path: "$.players[1].zones.play_area"
      to:
        path: "$.players[0].zones.winnings"

# IF guard with canPerform
- action: IF
  condition:
    canPerform:
      - action: MOVE
        from:
          top:
            - path: "$.players[current].zones.deck"
        to:
          path: "$.players[current].zones.play_area"
  then:
    - action: MOVE
      from:
        top:
          - path: "$.players[current].zones.deck"
      to:
        path: "$.players[current].zones.play_area"
  else:
    - action: SET_STATE
      state: GameOver
```

---
## 14. Card and Zone Semantics
- Card fields: `id` (stable), `properties` (rank, suit, etc.), `face` (`up|down`)
- Zone fields: `ordering`, `visibility`, `default_face`, `allows_reorder`, `card_count`, `top`/`bottom` accessors via path functions
- Ownership: `owner(<card>)` returns the player id who controls the card’s current zone (if `per_player`)

---
## 15. Rank and Comparison Semantics
- Deck types declare `rank_hierarchy`: ordered list from lowest to highest.
- `rank_value` converts a card’s rank or a rank literal into a numeric ordinal according to the originating deck type. If ambiguous, engines must be provided a deck context (`zone.of_deck`).
- Comparisons of ranks should use `rank_value` to avoid string ambiguity.

Example
```yaml examples/rank_compare.yaml
condition:
  isGreaterThan:
    - rank_value:
        - top:
            - path: "$.players[0].zones.play_area"
    - rank_value:
        - top:
            - path: "$.players[1].zones.play_area"
```

---
## 16. Transitions and Win Condition
### 16.1 Transitions
- Evaluated at defined checkpoints (end of phase, end of state, or as specified by trigger design).
- Multiple transitions true at once are resolved by order, then priority, then deterministic tie-breaker.

### 16.2 Win Condition
- `evaluator` should resolve to:
  - a single player id, or
  - an ordered list of player ids (ranking), or
  - an object `{ winners: [...], reason: "..." }`
- Common patterns use `max`/`min`/`sum` over player-scoped variables.

---
## 17. Error Handling
- Engines must validate action preconditions where possible.
- `canPerform` operator enables guard conditions.
- Unavailable actions default to abort the remaining actions in the effect unless `on_failure` overrides.
- Engines should provide clear error messages including rule id, action index, and reason.

---
## 18. Determinism and Randomness
- Randomization (`SHUFFLE`, `CHOOSE_RANDOM`) honors `meta.rng` settings.
- `deterministic: true` with a `seed` ensures reproducibility; engines must derive all random choices from the seeded PRNG.

---
## 19. Versioning and Compatibility
- `cgml_version` indicates schema rules. This document is v1.3.
- Backward-compatibility guidance:
  - `SET_GAME_STATE` is an alias of `SET_STATE` (deprecated; remove in v1.4).
  - `DEAL_ALL` and `MOVE_ALL` are standardized in v1.3.
  - Path anchors (`$currentPlayer`, etc.) are new in v1.3; engines should still accept explicit indices for older files.

---
## 20. Worked Example: “War” (informative, not normative)
A minimal War definition can be found in `war.yml`. Key notes:
- Use `rank_value` for rank comparison tied to `standard_52`.
- `DEAL_ALL` to distribute the deck; use per_player `player_deck` zones.
- Simultaneity: Flip and compare occur in phases with `player_order: simultaneous`.
- Replenish phases move winnings back to `player_deck` and shuffle.

Example snippets
```yaml examples/war_flip.yaml
rules:
  - id: flip_cards
    trigger: on.phase.FlipCard
    effect:
      - action: FOR_EACH_PLAYER
        order: simultaneous
        do:
          - action: MOVE
            from:
              top:
                - path: "$.players[$player].zones.player_deck"
            to:
              path: "$.players[$player].zones.play_area"
```

```yaml examples/war_compare.yaml
rules:
  - id: compare_cards_p1_wins
    trigger: on.phase.Compare
    condition:
      isGreaterThan:
        - rank_value:
            - top:
                - path: "$.players[0].zones.play_area"
        - rank_value:
            - top:
                - path: "$.players[1].zones.play_area"
    effect:
      - action: MOVE_ALL
        from:
          path: "$.players[0].zones.play_area"
        to:
          path: "$.players[0].zones.winnings"
      - action: MOVE_ALL
        from:
          path: "$.players[1].zones.play_area"
        to:
          path: "$.players[0].zones.winnings"
```

---
## Validation
All CGML files must validate against the authoritative JSON Schema for their `cgml_version` after import/inheritance merge. Engines must reject invalid files with clear error reporting.

---
## Implementation & Evolution
- Trunk: Maintain core schema, parser, and engine behaviors here.
- Branches: Proposals for new actions/operators/triggers must include schema updates, documentation, and conformance tests.
- Community Process: Changes are proposed via PRs with examples and a migration note for authors.

---
## Appendix A: Event Taxonomy (recommended)
- `on.state.enter/exit.<State>`
- `on.phase.<Phase>`
- `on.turn.begin/end`
- `on.draw` (card-level events may expose context: `$.card`, `$.from`, `$.to`)
- `on.play`, `on.discard`, `on.move`
- Replacement hooks: `timing: replace` for `on.draw`, `on.play`, etc.

---
## Appendix B: Common Filters (examples)
```yaml examples/common_filters.yaml
# Aces
isEqual:
  - path: "$.card.properties.rank"
  - value: "A"

# Same suit as leader
isEqual:
  - path: "$.card.properties.suit"
  - path: "$.trick.lead_suit"

# Highest in a zone
isEqual:
  - rank_value:
      - path: "$.card"
  - max:
      - list:
          - rank_value:
              - all:
                  - path: "$.zone"
```

---
## Changelog

### v1.3
- Added path/selector language with anchors (`$currentPlayer`, `top()`, `count()`, `rank_value()`).
- Expanded operators: `add`, `sub`, `mul`, `div`, `mod`, `sum`, `avg`, `len`, `contains`, `in`, `exists`, `rank_value`, `canPerform`.
- Standardized actions: `DEAL_ROUND_ROBIN`, `DEAL_ALL`, `MOVE_ALL`, `REVEAL`, `CONCEAL`, `FLIP`, `PEEK`, `LOOK`, `REORDER`, `CHOOSE_RANDOM`, `SEARCH_ZONE`, `MILL`, `REVEAL_MATCHING`, `FOR_EACH_PLAYER`, `PARALLEL`, `IF`, `SKIP_TURN`, `EXTRA_TURN`, `REVERSE_ORDER`, `INSERT_PHASE`, `REMOVE_PHASE`.
- Formalized simultaneity semantics and flow modifiers.
- Introduced rule fields: `timing` (pre/post/replace), `priority`, `once_per`, `enabled_when`, `on_failure`.
- Clarified imports/inheritance merge semantics and array identity by id/name.
- Clarified temporary value scoping via `store_as` and `ref` (including `ref` placeholders in paths).
- Face state and visibility formalized at card and zone levels.
- Deterministic RNG controls in `meta`.
- Back-compat note for `SET_GAME_STATE` alias.

### v1.2
- Unified operator/condition language (no ad hoc conditions).
- Clarified player input, referencing, and scoping for effects/results.
- Requirement for explicit FSM phases/turn structure.
- Formalized imports/inheritance mechanisms.
- Extended action vocabulary organization.
- Explicit process for schema/language extension.

---
## TODOs (for v1.4 and beyond)
- Schema-level formal grammar for selector filters: `$.players[by_id=...]` and custom predicates.
- Team/coop primitives: team definitions, per_team variables/zones, `$teammates` anchor.
- Replacement/interrupt priority stack for CCG-like timing conflicts.
- Transactional effects (atomic blocks with guaranteed rollback) and effect-level try/catch.
- Declarative reordering UI hints (e.g., “stack reorder” actions with user input).
- Richer event context objects (standardized fields for `on.move`/`on.play`).
- Library packages: trick-taking core, drafting core, deck-builder core with examples and tests.
- Formal deprecation policy and migration tooling (lint autofixes for `SET_GAME_STATE` -> `SET_STATE`).
