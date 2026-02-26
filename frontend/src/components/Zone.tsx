import React from 'react';
import { Zone as ZoneModel, Card as CardModel } from 'cgml-engine/src/state';
import { Card } from './Card';

interface ZoneProps {
    zone: ZoneModel;
    onCardClick?: (card: CardModel, zone: ZoneModel) => void;
    selectedCards?: Set<string>;
    // DnD
    onDrop?: (e: React.DragEvent, targetZone: ZoneModel) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDragStartEvent?: (e: React.DragEvent, card: CardModel, fromZone: ZoneModel) => void;
}

export const Zone: React.FC<ZoneProps> = ({
    zone,
    onCardClick,
    selectedCards,
    onDrop,
    onDragOver,
    onDragStartEvent
}) => {

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
        if (onDragOver) onDragOver(e);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (onDrop) onDrop(e, zone);
    };

    // If a zone is face down (e.g. deck), we might want to hide card details.
    // For simplicity, we just render the top card or a stack representation if defined, 
    // but the engine currently relies on UI to decide visibility.
    // We'll render all cards for now, or a compact stacked view.
    const isStacked = zone.name.toLowerCase() === 'deck' || zone.name.toLowerCase().includes('score') || zone.name.toLowerCase().includes('captured');

    const renderCards = () => {
        if (!zone.cards || zone.cards.length === 0) {
            return <div style={{ color: '#888', fontStyle: 'italic', fontSize: '0.9rem' }}>Empty</div>
        }

        if (isStacked) {
            // Render only the top card to simulate a deck/pile
            const topCard = zone.cards[zone.cards.length - 1];
            return (
                <div style={{ position: 'relative' }}>
                    {/* Fake thickness */}
                    {zone.cards.length > 1 && <div className="card" style={{ position: 'absolute', top: 4, left: 4, opacity: 0.5, zIndex: 0 }} />}
                    {zone.cards.length > 2 && <div className="card" style={{ position: 'absolute', top: 8, left: 8, opacity: 0.3, zIndex: 0 }} />}
                    <div style={{ zIndex: 1, position: 'relative' }}>
                        <Card
                            card={topCard}
                            isSelected={selectedCards?.has(topCard.id)}
                            onClick={(c) => onCardClick && onCardClick(c, zone)}
                            draggable={Boolean(onDragStartEvent)}
                            onDragStart={(e, c) => onDragStartEvent && onDragStartEvent(e, c, zone)}
                        />
                    </div>
                    <div style={{ position: 'absolute', bottom: -20, left: 0, right: 0, textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                        {zone.cards.length}
                    </div>
                </div>
            )
        }

        return zone.cards.map((card, idx) => (
            <Card
                key={card.id || idx}
                card={card}
                isSelected={selectedCards?.has(card.id)}
                onClick={(c) => onCardClick && onCardClick(c, zone)}
                draggable={Boolean(onDragStartEvent)}
                onDragStart={(e, c) => onDragStartEvent && onDragStartEvent(e, c, zone)}
            />
        ));
    };

    return (
        <div
            className="zone glass"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <div className="zone-title">{zone.name}</div>
            {renderCards()}
        </div>
    );
};
