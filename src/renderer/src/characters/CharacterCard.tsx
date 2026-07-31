import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";

import { cn } from "@/lib/utils";
import {
  assetUrl,
  type Character,
  type PortraitFraming,
} from "../../../shared/ipc";
import { getCharacterNameReading } from "./characterName";

interface CharacterCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  readonly character: Character;
  readonly framing?: PortraitFraming;
  readonly portraitSrc?: string | null;
  readonly selected: boolean;
  readonly onSelect?: () => void;
  readonly testId?: string;
}

export const CharacterCard = forwardRef<HTMLButtonElement, CharacterCardProps>(
  function CharacterCard(
    {
      character,
      className,
      framing,
      portraitSrc,
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
    }, [character.portraitAssetId, portraitSrc]);
    const reading = getCharacterNameReading(character.name);
    const portrait =
      portraitFailed
        ? null
        : portraitSrc !== undefined
          ? portraitSrc
          : character.portraitAssetId === null
            ? null
            : assetUrl(character.portraitAssetId);
    const resolvedFraming = framing ?? {
      focusX: character.portraitFocusX,
      focusY: character.portraitFocusY,
      zoom: character.portraitZoom,
    };
    const portraitStyle = {
      "--portrait-focus-x": `${resolvedFraming.focusX * 100}%`,
      "--portrait-focus-y": `${resolvedFraming.focusY * 100}%`,
      "--portrait-zoom": resolvedFraming.zoom,
    } as CSSProperties;

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
        <span className="character-list-portrait" style={portraitStyle}>
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
