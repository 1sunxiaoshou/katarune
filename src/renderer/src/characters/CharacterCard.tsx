import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";
import { assetUrl, type Character } from "../../../shared/ipc";
import { getCharacterNameReading } from "./characterName";

interface CharacterCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  readonly character: Character;
  readonly selected: boolean;
  readonly onSelect?: () => void;
  readonly testId?: string;
}

export const CharacterCard = forwardRef<HTMLButtonElement, CharacterCardProps>(
  function CharacterCard(
    {
      character,
      className,
      selected,
      onSelect,
      testId = "character-list-item",
      ...buttonProps
    },
    ref,
  ): React.JSX.Element {
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
        {...buttonProps}
        ref={ref}
        className={cn("character-list-item", className)}
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
  },
);
