"use client";

import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

type ResponseWriterProps = {
  text: string;
} & Omit<ComponentPropsWithoutRef<typeof ScrollArea>, "children">;

export const AiResponseWriter = ({ text, ...props }: ResponseWriterProps) => {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [text]);

  return (
    <ScrollArea ref={scrollAreaRef} {...props}>
      <div className="pr-4">
        <p className="text-foreground/80 text-sm whitespace-pre-line" aria-live="polite">
          {text}
        </p>
      </div>
    </ScrollArea>
  );
};

export default AiResponseWriter;
