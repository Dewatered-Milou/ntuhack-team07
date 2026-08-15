import type { Metadata } from "next";
import { Agent2App } from "./Agent2App";

export const metadata: Metadata = {
  title: "CuriLoop｜病患時序摘要",
  description: "將 Agent 1 的病患時序對話整理成簡潔、可追溯的側欄摘要。",
};

export default function Home() {
  return <Agent2App />;
}
