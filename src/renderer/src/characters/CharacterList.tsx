import { CropIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  AppContextMenu,
  AppContextMenuItem,
  AppContextMenuSeparator,
} from "@/components/app-context-menu";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import type { Character } from "../../../shared/ipc";
import { CharacterCard } from "./CharacterCard";

interface CharacterListProps {
  readonly characters: readonly Character[];
  readonly creating: boolean;
  readonly isDeleteDisabled: (character: Character) => boolean;
  readonly onCreate: () => void;
  readonly onDeleteRequest: (character: Character) => void;
  readonly onOpenPackages: (character: Character) => Promise<void>;
  readonly selectedId: string;
  readonly scrollToId: string | null;
  readonly onSelect: (id: string) => void;
}

export function CharacterList({
  characters,
  creating,
  isDeleteDisabled,
  onCreate,
  onDeleteRequest,
  onOpenPackages,
  selectedId,
  scrollToId,
  onSelect,
}: CharacterListProps): React.JSX.Element {
  const characterElements = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (scrollToId === null) return;
    characterElements.current.get(scrollToId)?.scrollIntoView({
      block: "nearest",
    });
  }, [scrollToId]);

  return (
    <aside className="character-list-panel" aria-labelledby="character-list-title">
      <div className="character-list-heading">
        <span className="character-star" aria-hidden="true">✦</span>
        <h2 id="character-list-title">角色列表</h2>
        <span>/ CHARACTERS</span>
        <TooltipIconButton
          aria-label="新增角色"
          className="character-list-add size-8"
          data-testid="character-create"
          disabled={creating}
          tooltip="新增角色"
          onClick={onCreate}
        >
          <PlusIcon aria-hidden="true" />
        </TooltipIconButton>
      </div>

      <div className="character-list-rule" aria-hidden="true" />

      <div className="character-list-scroll" data-testid="character-list">
        {characters.map((character) => (
          <div
            data-character-id={character.id}
            key={character.id}
            ref={(element) => {
              if (element === null) characterElements.current.delete(character.id);
              else characterElements.current.set(character.id, element);
            }}
          >
            <AppContextMenu
              mergeTrigger
              popupTestId="character-context-menu"
              trigger={
                <CharacterCard
                  character={character}
                  selected={character.id === selectedId}
                  onSelect={() => onSelect(character.id)}
                />
              }
            >
              <AppContextMenuItem
                data-testid="character-context-portrait"
                onClick={() => void onOpenPackages(character)}
              >
                <CropIcon aria-hidden="true" />
                更换形象
              </AppContextMenuItem>
              <AppContextMenuSeparator />
              <AppContextMenuItem
                danger
                data-testid="character-context-delete"
                disabled={isDeleteDisabled(character)}
                title={
                  isDeleteDisabled(character)
                    ? "至少需要保留一个角色"
                    : undefined
                }
                onClick={() => onDeleteRequest(character)}
              >
                <Trash2Icon aria-hidden="true" />
                {isDeleteDisabled(character) ? "至少保留一个角色" : "删除角色"}
              </AppContextMenuItem>
            </AppContextMenu>
          </div>
        ))}
      </div>
    </aside>
  );
}
