import { ImagePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Character } from "../../../shared/ipc";

interface CharacterPortraitPanelProps {
  readonly character: Character;
  readonly portrait: string | null;
  readonly onImport: () => Promise<void>;
  readonly onPortraitError: () => void;
}

export function CharacterPortraitPanel({
  character,
  portrait,
  onImport,
  onPortraitError,
}: CharacterPortraitPanelProps): React.JSX.Element {
  return (
    <section className="character-art-panel" aria-label="角色立绘">
      <div className="character-art">
        {portrait !== null && (
          <img
            alt={`${character.name}的立绘`}
            src={portrait}
            onError={onPortraitError}
          />
        )}
      </div>
      <Button
        className="character-portrait-button"
        data-testid="character-portrait-import"
        type="button"
        variant="outline"
        onClick={() => void onImport()}
      >
        <ImagePlusIcon aria-hidden="true" />
        {portrait === null ? "导入立绘" : "更换立绘"}
      </Button>
    </section>
  );
}
