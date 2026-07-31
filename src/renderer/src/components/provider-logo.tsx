import alibabaLogo from "@lobehub/icons-static-svg/icons/alibaba.svg";
import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg";
import deepSeekLogo from "@lobehub/icons-static-svg/icons/deepseek.svg";
import fishAudioLogo from "@lobehub/icons-static-svg/icons/fishaudio.svg";
import googleLogo from "@lobehub/icons-static-svg/icons/google.svg";
import moonshotLogo from "@lobehub/icons-static-svg/icons/moonshot.svg";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg";
import vercelLogo from "@lobehub/icons-static-svg/icons/vercel.svg";
import xAiLogo from "@lobehub/icons-static-svg/icons/xai.svg";
import { NetworkIcon } from "lucide-react";
import type { ProviderType } from "../../../shared/ipc";

const PROVIDER_LOGO_URLS: Readonly<
  Record<Exclude<ProviderType, "openai-compatible">, string>
> = {
  gateway: vercelLogo,
  openai: openAiLogo,
  anthropic: anthropicLogo,
  google: googleLogo,
  "fish-audio": fishAudioLogo,
  deepseek: deepSeekLogo,
  xai: xAiLogo,
  moonshotai: moonshotLogo,
  alibaba: alibabaLogo,
};

interface ProviderLogoProps {
  readonly providerType: ProviderType;
  readonly className?: string;
}

export function ProviderLogo({
  providerType,
  className,
}: ProviderLogoProps): React.JSX.Element {
  if (providerType === "openai-compatible") {
    return <NetworkIcon className={className} aria-hidden="true" />;
  }

  const logoUrl = PROVIDER_LOGO_URLS[providerType];
  return (
    <span
      aria-hidden="true"
      className={`inline-block bg-current ${className ?? ""}`}
      style={{
        maskImage: `url("${logoUrl}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url("${logoUrl}")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
