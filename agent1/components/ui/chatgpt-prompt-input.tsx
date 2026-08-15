"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ArrowUp, Check, ImagePlus, Mic, Settings2, X } from "lucide-react";

import { cn } from "@/lib/utils";

type PromptMode = {
  value: string;
  label: string;
  description: string;
};

type PromptBoxProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  modes: PromptMode[];
  selectedMode: string;
  onModeChange: (mode: string) => void;
  engineLabel?: string;
  resetKey?: number;
};

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-72 rounded-md bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-xl outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export const PromptBox = React.forwardRef<HTMLTextAreaElement, PromptBoxProps>(
  (
    {
      className,
      value,
      onValueChange,
      modes,
      selectedMode,
      onModeChange,
      engineLabel,
      resetKey,
      disabled,
      placeholder = "輸入您的問題…",
      onKeyDown,
      ...props
    },
    forwardedRef,
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [imagePreview, setImagePreview] = React.useState<string | null>(null);
    const [imageName, setImageName] = React.useState("");
    const [modeOpen, setModeOpen] = React.useState(false);
    const [previewOpen, setPreviewOpen] = React.useState(false);

    React.useImperativeHandle(forwardedRef, () => textareaRef.current!, []);

    React.useLayoutEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }, [value]);

    React.useEffect(() => {
      setImagePreview(null);
      setImageName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }, [resetKey]);

    React.useEffect(
      () => () => {
        if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
      },
      [imagePreview],
    );

    const activeMode = modes.find((mode) => mode.value === selectedMode) ?? modes[0];
    const canSubmit = value.trim().length > 0 && !disabled;

    function clearImage() {
      if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
      setImageName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }

    function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
      const file = event.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
      setImagePreview(URL.createObjectURL(file));
      setImageName(file.name);
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (canSubmit) event.currentTarget.form?.requestSubmit();
      }
    }

    return (
      <div
        className={cn(
          "prompt-box flex w-full flex-col rounded-[28px] border border-border bg-white p-2 shadow-sm transition-all",
          "focus-within:border-ring focus-within:shadow-md",
          className,
        )}
      >
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          aria-hidden="true"
          tabIndex={-1}
        />

        {imagePreview ? (
          <div className="mx-1 mt-1 flex items-center gap-2 rounded-2xl bg-muted p-2">
            <DialogPrimitive.Root open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogPrimitive.Trigger asChild>
                <button type="button" className="shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <img src={imagePreview} alt="待傳圖片預覽" className="h-14 w-14 rounded-xl object-cover" />
                </button>
              </DialogPrimitive.Trigger>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
                <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,800px)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-card p-3 shadow-2xl">
                  <img src={imagePreview} alt="圖片完整預覽" className="max-h-[85vh] w-full rounded-2xl object-contain" />
                  <DialogPrimitive.Close className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow" aria-label="關閉圖片預覽">
                    <X className="h-4 w-4" />
                  </DialogPrimitive.Close>
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{imageName}</p>
              <p className="text-xs text-muted-foreground">圖片僅在本機預覽，不會傳送給 AI。</p>
            </div>
            <button type="button" onClick={clearImage} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" aria-label="移除圖片">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <textarea
          {...props}
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          name="message"
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="custom-scrollbar min-h-14 max-h-[200px] w-full resize-none border-0 bg-transparent p-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="flex items-center gap-1 px-1 pb-1">
          <TooltipPrimitive.Provider delayDuration={120}>
            <TooltipPrimitive.Root>
              <TooltipPrimitive.Trigger asChild>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="選擇圖片預覽"
                >
                  <ImagePlus className="h-5 w-5" />
                </button>
              </TooltipPrimitive.Trigger>
              <TooltipContent side="top">選擇圖片（僅本機預覽，不會傳送）</TooltipContent>
            </TooltipPrimitive.Root>

            <PopoverPrimitive.Root open={modeOpen} onOpenChange={setModeOpen}>
              <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>
                  <PopoverPrimitive.Trigger asChild>
                    <button
                      type="button"
                      className="flex h-9 items-center gap-2 rounded-full px-3 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="切換對話模式"
                    >
                      <Settings2 className="h-4 w-4" />
                      <span>{activeMode?.label ?? "對話模式"}</span>
                    </button>
                  </PopoverPrimitive.Trigger>
                </TooltipPrimitive.Trigger>
                <TooltipContent side="top">切換 Agent 1 對話模式</TooltipContent>
              </TooltipPrimitive.Root>
              <PopoverContent side="top">
                <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model mode</p>
                <div className="flex flex-col gap-1">
                  {modes.map((mode) => (
                    <button
                      type="button"
                      key={mode.value}
                      onClick={() => {
                        onModeChange(mode.value);
                        setModeOpen(false);
                      }}
                      className="flex w-full items-start gap-2 rounded-xl p-2 text-left hover:bg-accent"
                    >
                      <span className="mt-0.5 flex h-5 w-5 items-center justify-center">
                        {mode.value === selectedMode ? <Check className="h-4 w-4 text-emerald-700" /> : null}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{mode.label}</span>
                        <span className="block text-xs text-muted-foreground">{mode.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </PopoverPrimitive.Root>

            {engineLabel ? <span className="hidden text-xs text-muted-foreground sm:inline">{engineLabel}</span> : null}

            <div className="ml-auto flex items-center gap-1">
              <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>
                  <button
                    type="button"
                    disabled
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground opacity-55"
                    aria-label="語音功能尚未開放"
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                </TooltipPrimitive.Trigger>
                <TooltipContent side="top">語音功能尚未開放</TooltipContent>
              </TooltipPrimitive.Root>

              <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-black/30"
                    aria-label={disabled ? "CuriLoop 回覆處理中" : "送出訊息"}
                  >
                    <ArrowUp className="h-5 w-5" strokeWidth={2.25} />
                  </button>
                </TooltipPrimitive.Trigger>
                <TooltipContent side="top">{disabled ? "CuriLoop 回覆處理中" : "送出訊息"}</TooltipContent>
              </TooltipPrimitive.Root>
            </div>
          </TooltipPrimitive.Provider>
        </div>
      </div>
    );
  },
);
PromptBox.displayName = "PromptBox";
