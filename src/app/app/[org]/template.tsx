/** Re-mounts on every navigation, so each page plays a short enter animation. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
