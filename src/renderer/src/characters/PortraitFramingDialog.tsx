import { ImagePlusIcon, RotateCcwIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type HTMLAttributes,
} from "react";
import Cropper, {
  getInitialCropFromCroppedAreaPercentages,
  type Area,
  type MediaSize,
  type Point,
  type Size,
} from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  clearNotificationScope,
  InlineNotificationOutlet,
  notify,
} from "../notifications";
import {
  assetUrl,
  DEFAULT_PORTRAIT_FRAMING,
  stagedAssetUrl,
  type Character,
  type PortraitFraming,
  type StagedCharacterPortrait,
} from "../../../shared/ipc";
import { CharacterCard } from "./CharacterCard";

interface PortraitFramingDialogProps {
  readonly character: Character;
  readonly initialStage: StagedCharacterPortrait | null;
  readonly onCommitted: (
    stageId: string | null,
    framing: PortraitFraming,
  ) => Promise<Character>;
  readonly onOpenChange: (open: boolean) => void;
}

const NOTIFICATION_SCOPE = "characters.portrait-framing-dialog";
const PORTRAIT_ASPECT = 8 / 5;
const PORTRAIT_CROPPER_PROPS: HTMLAttributes<HTMLDivElement> & {
  readonly "data-testid": string;
} = {
  "aria-label": "立绘取景区域",
  "data-testid": "portrait-framing-crop",
  onMouseDownCapture: (event) => {
    if (event.button === 0) return;
    event.preventDefault();
    event.stopPropagation();
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function fixedPrecisionFraming(framing: PortraitFraming): PortraitFraming {
  return {
    focusX: Number(framing.focusX.toFixed(6)),
    focusY: Number(framing.focusY.toFixed(6)),
    zoom: Number(framing.zoom.toFixed(6)),
  };
}

function cropAreaFromFraming(
  naturalWidth: number,
  naturalHeight: number,
  framing: PortraitFraming,
): Area {
  const imageAspect = naturalWidth / naturalHeight;
  const baseWidth =
    imageAspect >= PORTRAIT_ASPECT
      ? (PORTRAIT_ASPECT / imageAspect) * 100
      : 100;
  const baseHeight =
    imageAspect >= PORTRAIT_ASPECT
      ? 100
      : (imageAspect / PORTRAIT_ASPECT) * 100;
  const width = baseWidth / framing.zoom;
  const height = baseHeight / framing.zoom;

  return {
    width,
    height,
    x: framing.focusX * (100 - width),
    y: framing.focusY * (100 - height),
  };
}

function focusFromCropArea(area: Area): Pick<
  PortraitFraming,
  "focusX" | "focusY"
> {
  const horizontalTravel = 100 - area.width;
  const verticalTravel = 100 - area.height;

  return {
    focusX:
      horizontalTravel > 0.0001
        ? clamp(area.x / horizontalTravel, 0, 1)
        : DEFAULT_PORTRAIT_FRAMING.focusX,
    focusY:
      verticalTravel > 0.0001
        ? clamp(area.y / verticalTravel, 0, 1)
        : DEFAULT_PORTRAIT_FRAMING.focusY,
  };
}

function framingFromCharacter(character: Character): PortraitFraming {
  return {
    focusX: character.portraitFocusX,
    focusY: character.portraitFocusY,
    zoom: character.portraitZoom,
  };
}

export function PortraitFramingDialog({
  character,
  initialStage,
  onCommitted,
  onOpenChange,
}: PortraitFramingDialogProps): React.JSX.Element {
  const [framing, setFraming] = useState<PortraitFraming>(() =>
    framingFromCharacter(character),
  );
  const [stage, setStage] =
    useState<StagedCharacterPortrait | null>(initialStage);
  const [submitting, setSubmitting] = useState(false);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const stageRef = useRef(stage);
  const mediaSizeRef = useRef<MediaSize | null>(null);
  const cropSizeRef = useRef<Size | null>(null);
  const initializedSourceRef = useRef<string | null>(null);
  stageRef.current = stage;

  const source =
    stage === null
      ? character.portraitAssetId === null
        ? null
        : assetUrl(character.portraitAssetId)
      : stagedAssetUrl(stage.id);

  useEffect(
    () => () => {
      clearNotificationScope(NOTIFICATION_SCOPE);
      const staged = stageRef.current;
      if (staged !== null) {
        void window.katarune
          .discardCharacterPortraitStage({ stageId: staged.id })
          .catch(() => undefined);
      }
    },
    [],
  );

  useEffect(() => {
    initializedSourceRef.current = null;
    mediaSizeRef.current = null;
    cropSizeRef.current = null;
    setCrop({ x: 0, y: 0 });
  }, [source]);

  const discardStage = async (
    candidate: StagedCharacterPortrait | null,
  ): Promise<void> => {
    if (candidate === null) return;
    await window.katarune.discardCharacterPortraitStage({
      stageId: candidate.id,
    });
  };

  const close = async (): Promise<void> => {
    if (submitting) return;
    const staged = stageRef.current;
    stageRef.current = null;
    setStage(null);
    try {
      await discardStage(staged);
    } catch {
      // Startup cleanup removes a stage that could not be discarded here.
    } finally {
      onOpenChange(false);
    }
  };

  const chooseReplacement = async (): Promise<void> => {
    clearNotificationScope(NOTIFICATION_SCOPE);
    try {
      const result = await window.katarune.stageCharacterPortrait();
      if (result.canceled || result.stage === null) return;
      const previous = stageRef.current;
      if (previous !== null) {
        try {
          await discardStage(previous);
        } catch (error) {
          await discardStage(result.stage).catch(() => undefined);
          throw error;
        }
      }
      setStage(result.stage);
      stageRef.current = result.stage;
    } catch (error) {
      notify({
        channel: "inline",
        scope: NOTIFICATION_SCOPE,
        level: "error",
        message:
          error instanceof Error ? error.message : "无法读取所选立绘。",
      });
    }
  };

  const handleCropperZoomChange = (nextZoom: number): void => {
    setFraming((current) => ({
      ...current,
      zoom: clamp(nextZoom, 1, 3),
    }));
  };

  const changeZoomKeepingFocus = (nextZoom: number): void => {
    const zoom = clamp(nextZoom, 1, 3);
    const mediaSize = mediaSizeRef.current;
    const cropSize = cropSizeRef.current;
    if (mediaSize !== null && cropSize !== null) {
      const initial = getInitialCropFromCroppedAreaPercentages(
        cropAreaFromFraming(mediaSize.naturalWidth, mediaSize.naturalHeight, {
          ...framing,
          zoom,
        }),
        mediaSize,
        0,
        cropSize,
        1,
        3,
      );
      setCrop(initial.crop);
    }
    setFraming((current) => ({ ...current, zoom }));
  };

  const handleCropAreaChange = (area: Area): void => {
    if (initializedSourceRef.current !== source) return;
    const focus = focusFromCropArea(area);
    setFraming((current) => ({
      ...current,
      ...focus,
    }));
  };

  const resetFraming = (): void => {
    const mediaSize = mediaSizeRef.current;
    const cropSize = cropSizeRef.current;
    if (mediaSize !== null && cropSize !== null) {
      const initial = getInitialCropFromCroppedAreaPercentages(
        cropAreaFromFraming(
          mediaSize.naturalWidth,
          mediaSize.naturalHeight,
          DEFAULT_PORTRAIT_FRAMING,
        ),
        mediaSize,
        0,
        cropSize,
        1,
        3,
      );
      setCrop(initial.crop);
    }
    setFraming(DEFAULT_PORTRAIT_FRAMING);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (source === null) return;
    clearNotificationScope(NOTIFICATION_SCOPE);
    setSubmitting(true);
    try {
      const committedStage = stageRef.current;
      await onCommitted(
        committedStage?.id ?? null,
        fixedPrecisionFraming(framing),
      );
      stageRef.current = null;
      setStage(null);
      onOpenChange(false);
    } catch (error) {
      notify({
        channel: "inline",
        scope: NOTIFICATION_SCOPE,
        level: "error",
        message:
          error instanceof Error ? error.message : "无法保存卡片立绘。",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="portrait-framing-dialog data-open:zoom-in-100 data-closed:zoom-out-100"
        data-testid="portrait-framing-dialog"
      >
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>编辑卡片立绘</DialogTitle>
            <DialogDescription>
              拖动调整显示位置，使用滚轮或滑杆缩放。
            </DialogDescription>
          </DialogHeader>

          <div className="portrait-framing-layout">
            <section className="portrait-framing-workspace" aria-label="取景编辑">
              <div className="portrait-framing-canvas">
                {source !== null && (
                  <Cropper
                    key={source}
                    aspect={PORTRAIT_ASPECT}
                    classes={{
                      containerClassName: "portrait-framing-cropper",
                      cropAreaClassName: "portrait-framing-cropper-area",
                      mediaClassName: "portrait-framing-cropper-image",
                    }}
                    crop={crop}
                    cropperProps={PORTRAIT_CROPPER_PROPS}
                    disableAutomaticStylesInjection
                    image={source}
                    keyboardStep={2}
                    maxZoom={3}
                    mediaProps={{ draggable: false }}
                    minZoom={1}
                    objectFit="contain"
                    restrictPosition
                    setCropSize={(cropSize) => {
                      cropSizeRef.current = cropSize;
                    }}
                    setMediaSize={(mediaSize) => {
                      mediaSizeRef.current = mediaSize;
                    }}
                    showGrid={false}
                    zoom={framing.zoom}
                    zoomSpeed={0.2}
                    zoomWithScroll
                    onCropAreaChange={handleCropAreaChange}
                    onCropChange={setCrop}
                    onMediaLoaded={(mediaSize) => {
                      const cropSize = cropSizeRef.current;
                      mediaSizeRef.current = mediaSize;
                      if (cropSize !== null) {
                        const initial =
                          getInitialCropFromCroppedAreaPercentages(
                            cropAreaFromFraming(
                              mediaSize.naturalWidth,
                              mediaSize.naturalHeight,
                              framing,
                            ),
                            mediaSize,
                            0,
                            cropSize,
                            1,
                            3,
                          );
                        setCrop(initial.crop);
                      }
                      initializedSourceRef.current = source;
                    }}
                    onZoomChange={handleCropperZoomChange}
                  />
                )}
              </div>

              <div className="portrait-framing-controls">
                <Label htmlFor="portrait-zoom">缩放</Label>
                <input
                  id="portrait-zoom"
                  aria-valuetext={`${framing.zoom.toFixed(2)} 倍`}
                  data-testid="portrait-framing-zoom"
                  max="3"
                  min="1"
                  step="0.05"
                  type="range"
                  value={framing.zoom}
                  onChange={(event) =>
                    changeZoomKeepingFocus(Number(event.currentTarget.value))
                  }
                />
                <output htmlFor="portrait-zoom">
                  {framing.zoom.toFixed(2)}×
                </output>
              </div>

              <div className="portrait-framing-tools">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void chooseReplacement()}
                >
                  <ImagePlusIcon aria-hidden="true" />
                  更换图片
                </Button>
                <Button
                  data-testid="portrait-framing-reset"
                  type="button"
                  variant="ghost"
                  onClick={resetFraming}
                >
                  <RotateCcwIcon aria-hidden="true" />
                  恢复默认
                </Button>
              </div>
            </section>

            <aside className="portrait-framing-previews" aria-label="卡片预览">
              <div>
                <span>普通窗口</span>
                <div className="portrait-framing-preview portrait-framing-preview-desktop">
                  <CharacterCard
                    aria-hidden="true"
                    character={character}
                    framing={framing}
                    portraitSrc={source}
                    selected
                    tabIndex={-1}
                    testId="portrait-preview-desktop"
                  />
                </div>
              </div>
              <div>
                <span>紧凑窗口</span>
                <div className="portrait-framing-preview portrait-framing-preview-compact">
                  <CharacterCard
                    aria-hidden="true"
                    character={character}
                    framing={framing}
                    portraitSrc={source}
                    selected
                    tabIndex={-1}
                    testId="portrait-preview-compact"
                  />
                </div>
              </div>
            </aside>
          </div>

          <InlineNotificationOutlet scope={NOTIFICATION_SCOPE} />
          <DialogFooter>
            <Button
              data-testid="portrait-framing-cancel"
              disabled={submitting}
              type="button"
              variant="outline"
              onClick={() => void close()}
            >
              取消
            </Button>
            <Button
              data-testid="portrait-framing-save"
              disabled={submitting || source === null}
              type="submit"
            >
              {submitting ? "保存中……" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
