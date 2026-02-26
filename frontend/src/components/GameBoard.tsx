import React, { useState } from 'react';
import { useGameState } from '../hooks/useGameState';
import { Zone } from './Zone';
import { Card as CardModel, Zone as ZoneModel } from 'cgml-engine/src/state';

export const GameBoard: React.FC = () => {
    const { gameState, currentPlayerIdx, legalActions, performAction, isGameOver } = useGameState();
    const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
    const [selectedZone, setSelectedZone] = useState<ZoneModel | null>(null);

    if (!gameState) return <div className="loader-container">Loading game state...</div>;

    const currentPlayer = gameState.players[currentPlayerIdx];
    const opponent = gameState.players[(currentPlayerIdx + 1) % gameState.players.length];

    // --- Interaction Handlers ---

    const toggleCardSelection = (card: CardModel, zone: ZoneModel) => {
        // Simple distinct selection logic: 
        // Real implementations might need to know if the current action expects multiple cards or just one.
        const newSelected = new Set(selectedCards);
        if (newSelected.has(card.id)) {
            newSelected.delete(card.id);
        } else {
            newSelected.add(card.id);
            setSelectedZone(zone);
        }
        setSelectedCards(newSelected);
    };

    const handleDragStart = (e: React.DragEvent, card: CardModel, fromZone: ZoneModel) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ cardId: card.id, zoneId: fromZone.id || fromZone.name }));
        // Also select the card so visual feedback is consistent
        setSelectedCards(new Set([card.id]));
        setSelectedZone(fromZone);
    };

    const handleDrop = (e: React.DragEvent, targetZone: ZoneModel) => {
        const rawData = e.dataTransfer.getData('text/plain');
        if (!rawData) return;

        try {
            const data = JSON.parse(rawData);

            // In a more robust implementation, we would inspect the legalActions
            // to see if "MOVE card to targetZone" is valid, then dispatch it.
            // For now, we try to find an action that matches moving from hand to the target.

            const matchingAction = legalActions.find(act => {
                if (!act.effect) return false;
                // very naive matching for a MOVE action
                const moveObj = act.effect.find((eff: any) => eff.action === 'MOVE' || eff.action === 'MOVE_ALL');
                if (!moveObj) return false;

                // If it's Wippen, we have REQUEST_INPUT and complex actions, 
                // so we might just trigger the first legal action for demo purposes 
                // if it matches the general intention, or we let the user click the explicit action button.
                return true;
            });

            if (matchingAction) {
                // We'd map the dragged card to the context of the action.
                // For this MVP, we will rely on the explicit Action Buttons below,
                // but console log the intention.
                console.log(`Intent to move card ${data.cardId} to ${targetZone.name}`);
            }

        } catch (err) { }
    };

    return (
        <div className="game-board">
            <header>
                <h1>CGML Arena</h1>
                <p>Status: {isGameOver ? 'Game Over' : `Turn: ${currentPlayer.name}`}</p>
            </header>

            {/* Opponent Area (Top) */}
            {opponent && (
                <div className="player-area opponent" style={{ opacity: 0.8, transform: 'scale(0.9)', transformOrigin: 'top center' }}>
                    <div className="glass" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>{opponent.name}</div>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                        {Object.values(opponent.zones).map(zone => (
                            <Zone key={zone.name} zone={zone} />
                        ))}
                    </div>
                </div>
            )}

            {/* Shared Table Area (Middle) */}
            <div className="table-area">
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {Object.values(gameState.shared_zones).map(zone => (
                        <Zone
                            key={zone.name}
                            zone={zone}
                            onDrop={handleDrop}
                            onCardClick={toggleCardSelection}
                            selectedCards={selectedCards}
                        />
                    ))}
                </div>
            </div>

            {/* Current Player Area (Bottom) */}
            <div className="player-area current-player">
                <div className="glass" style={{ textAlign: 'center', marginBottom: '0.5rem', borderColor: 'var(--secondary-color)' }}>
                    {currentPlayer.name} (You)
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    {Object.values(currentPlayer.zones).map(zone => (
                        <Zone
                            key={zone.name}
                            zone={zone}
                            onCardClick={toggleCardSelection}
                            selectedCards={selectedCards}
                            onDragStartEvent={handleDragStart}
                        />
                    ))}
                </div>

                {/* Available Actions */}
                {!isGameOver && (
                    <div className="controls">
                        {legalActions.length === 0 ? (
                            <div style={{ color: '#aaa' }}>No legal actions available. Checking logic...</div>
                        ) : (
                            legalActions.map((action, idx) => (
                                <button
                                    key={idx}
                                    className="action-btn"
                                    onClick={() => {
                                        // Simple wrapper to dispatch the action. 
                                        // If the action needs specific targeted cards (like Wippen's REQUEST_INPUT), 
                                        // our primitive evaluateExpression handles fallback or mock, 
                                        // but ideally we'd inject `selectedCards` into the context here.
                                        performAction(action.effect);
                                        setSelectedCards(new Set()); // clear selection after
                                    }}
                                >
                                    Execute Rule: {action.rule_id || `Action ${idx + 1}`}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
