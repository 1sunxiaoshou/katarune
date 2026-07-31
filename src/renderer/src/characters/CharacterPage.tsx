import "./character-fonts.css";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import type {
  Character,
  StagedCharacterPortrait,
} from "../../../shared/ipc";
import { notify } from "../notifications";
import { CharacterEditor } from "./CharacterEditor";
import { CharacterList } from "./CharacterList";
import { PortraitFramingDialog } from "./PortraitFramingDialog";
import { useCharacterPageController } from "./useCharacterPageController";

interface CharacterPageProps {
  readonly onClose: () => void;
  readonly onOpenSettings: () => void;
}

interface PortraitEditorState {
  readonly character: Character;
  readonly stage: StagedCharacterPortrait | null;
}

export function CharacterPage({
  onClose,
  onOpenSettings,
}: CharacterPageProps): React.JSX.Element {
  const controller = useCharacterPageController({
    onClose,
    onOpenSettings,
  });
  const selectedCharacter = controller.selectedCharacter;
  const [portraitEditor, setPortraitEditor] =
    useState<PortraitEditorState | null>(null);

  const openPortraitEditor = async (character: Character): Promise<void> => {
    const selected = await controller.selectCharacter(character.id);
    if (!selected) return;
    if (character.portraitAssetId !== null) {
      setPortraitEditor({ character, stage: null });
      return;
    }
    try {
      const result = await window.katarune.stageCharacterPortrait();
      if (result.canceled || result.stage === null) return;
      setPortraitEditor({ character, stage: result.stage });
    } catch (error) {
      notify({
        channel: "toast",
        level: "error",
        message:
          error instanceof Error ? error.message : "导入角色立绘失败，请重试。",
        dedupeKey: `character-portrait-stage:${character.id}`,
      });
    }
  };

  return (
    <main
      className="character-studio"
      data-testid="character-page"
      id="main-content"
    >
      <header className="character-header">
        <TooltipIconButton
          className="character-back size-8 rounded-md active:scale-100"
          data-testid="character-back"
          tooltip="返回聊天"
          onClick={() => void controller.leave("chat")}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </TooltipIconButton>
        <span className="character-header-star" aria-hidden="true">✦</span>
        <h1>角色图鉴</h1>
        <span>CHARACTER GALLERY</span>
        <div className="character-header-line" aria-hidden="true" />
        <span className="character-page-count">
          {selectedCharacter === undefined
            ? "00"
            : String(
                Math.max(
                  1,
                  controller.characterEntries.findIndex(
                    (character) =>
                      character.id === selectedCharacter.id,
                  ) + 1,
                ),
              ).padStart(2, "0")}
          {" / "}
          {String(controller.characterEntries.length).padStart(2, "0")}
        </span>
      </header>

      {controller.error !== null ? (
        <div className="character-page-error" role="alert">
          <p>{controller.error}</p>
          <Button variant="outline" onClick={onClose}>
            返回聊天
          </Button>
        </div>
      ) : selectedCharacter === undefined ? (
        <div className="character-page-loading" role="status">
          正在读取角色配置……
        </div>
      ) : (
        <div className="character-layout">
          <CharacterEditor
            key={selectedCharacter.id}
            availableModelIds={controller.availableModelIds}
            character={selectedCharacter}
            draft={
              controller.draftCharacter?.id === selectedCharacter.id
            }
            focusName={
              controller.focusNameId === selectedCharacter.id
            }
            models={controller.models}
            onFocusNameHandled={controller.clearFocusName}
            providers={controller.providers}
            onCharacterUpdated={controller.updateCharacter}
            onDraftUpdated={controller.updateDraftCharacter}
            onOpenSettings={() => void controller.leave("settings")}
            onPortraitEdit={() => openPortraitEditor(selectedCharacter)}
          />
          <CharacterList
            characters={controller.characterEntries}
            creating={controller.draftCharacter !== null}
            isDeleteDisabled={(character) =>
              controller.draftCharacter?.id !== character.id &&
              controller.characters.length <= 1
            }
            onCreate={controller.createCharacterDraft}
            onDeleteRequest={(character) =>
              void controller.requestCharacterDelete(character)
            }
            onPortraitEdit={openPortraitEditor}
            selectedId={selectedCharacter.id}
            scrollToId={controller.focusNameId}
            onSelect={(id) => void controller.selectCharacter(id)}
          />
        </div>
      )}
      <ConfirmDialog
        open={controller.deleteCandidate !== null}
        title={
          controller.deleteCandidate === null
            ? "删除这个角色？"
            : `删除「${controller.deleteCandidate.character.name}」？`
        }
        description={
          controller.deleteCandidate === null
            ? ""
            : `该角色、${controller.deleteCandidate.threadCount} 个会话及其中的全部消息会被永久删除，此操作不可恢复。`
        }
        confirmLabel="删除角色"
        pendingLabel="正在删除……"
        errorLabel="删除角色失败，请重试。"
        onOpenChange={(open) => {
          if (!open) controller.clearDeleteCandidate();
        }}
        onConfirm={controller.confirmCharacterDelete}
      />
      {portraitEditor !== null && (
        <PortraitFramingDialog
          character={portraitEditor.character}
          initialStage={portraitEditor.stage}
          onCommitted={(stageId, framing) =>
            controller.commitPortrait(
              portraitEditor.character.id,
              stageId,
              framing,
            )
          }
          onOpenChange={(open) => {
            if (!open) setPortraitEditor(null);
          }}
        />
      )}
    </main>
  );
}
