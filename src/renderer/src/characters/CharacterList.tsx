import type { Character } from "../../../shared/ipc";

interface CharacterListProps {
  readonly characters: readonly Character[];
  readonly portraits: ReadonlyMap<string, string | null>;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

export function CharacterList({
  characters,
  portraits,
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
        {characters.map((character, index) => {
          const selected = character.id === selectedId;
          const portrait = portraits.get(character.id) ?? null;
          return (
            <button
              className="character-list-item"
              data-selected={selected}
              data-testid="character-list-item"
              key={character.id}
              type="button"
              onClick={() => onSelect(character.id)}
            >
              {selected && <span className="character-list-pointer" aria-hidden="true">◆</span>}
              <span className="character-list-portrait">
                {portrait === null ? (
                  <span className="character-list-placeholder" aria-hidden="true">✦</span>
                ) : (
                  <img alt="" src={portrait} />
                )}
              </span>
              <span className="character-list-copy">
                <strong>{character.name}</strong>
                <em>Character {String(index + 1).padStart(2, "0")}</em>
              </span>
              <span className="character-list-spark" aria-hidden="true">✦</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
