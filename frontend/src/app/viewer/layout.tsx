import AuthGate from "@/components/AuthGate";

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
