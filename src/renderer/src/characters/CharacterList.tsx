import type { Character } from "../../../shared/ipc";
import { CharacterCard } from "./CharacterCard";

interface CharacterListProps {
  readonly characters: readonly Character[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

export function CharacterList({
  characters,
  selectedId,
  onSelect,
}: CharacterListProps): React.JSX.Element {
  return (
    <aside className="character-list-panel" aria-labelledby="character-list-title">
      <div className="character-list-heading">
        <span className="character-star" aria-hidden="true">✦</span>
        <h2 id="character-list-title">角色列表</h2>
        <span>/ CHARACTERS</span>
      </div>

      <div className="character-list-rule" aria-hidden="true" />

      <div className="character-list-scroll" data-testid="character-list">
        {characters.map((character) => (
          <CharacterCard
            character={character}
            key={character.id}
            selected={character.id === selectedId}
            onSelect={() => onSelect(character.id)}
          />
        ))}
      </div>
    </aside>
  );
}
