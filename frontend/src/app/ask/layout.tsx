import AuthGate from "@/components/AuthGate";

export default function AskLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
