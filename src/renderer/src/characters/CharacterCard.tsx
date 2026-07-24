import { useEffect, useState } from "react";
import { assetUrl, type Character } from "../../../shared/ipc";
import { getCharacterNameReading } from "./characterName";

interface CharacterCardProps {
  readonly character: Character;
  readonly selected: boolean;
  readonly onSelect?: () => void;
  readonly testId?: string;
}

export function CharacterCard({
  character,
  selected,
  onSelect,
  testId = "character-list-item",
}: CharacterCardProps): React.JSX.Element {
  const [portraitFailed, setPortraitFailed] = useState(false);
  useEffect(() => {
    setPortraitFailed(false);
  }, [character.portraitAssetId]);
  const reading = getCharacterNameReading(character.name);
  const portrait =
    character.portraitAssetId === null || portraitFailed
      ? null
      : assetUrl(character.portraitAssetId);

  return (
    <button
      className="character-list-item"
      data-selected={selected}
      data-testid={testId}
      type="button"
      onClick={onSelect}
    >
      {selected && <span className="character-list-pointer" aria-hidden="true">◆</span>}
      <span className="character-list-portrait">
        {portrait === null ? (
          <span className="character-list-placeholder" aria-hidden="true">✦</span>
        ) : (
          <img
            alt=""
            src={portrait}
            onError={() => setPortraitFailed(true)}
          />
        )}
      </span>
      <span className="character-list-copy">
        <strong>{character.name}</strong>
        <em
          data-reading-kind={reading.kind}
          data-testid="character-list-reading"
          lang={reading.kind === "pinyin" ? "zh-Latn-pinyin" : "en"}
        >
          {reading.text}
        </em>
      </span>
      <span className="character-list-spark" aria-hidden="true">✦</span>
    </button>
  );
}
