/**
 * The desktop content column (D74). At `lg+` every screen inside this group clamps to a
 * centered, readable measure instead of stretching edge to edge. `/games` stays outside this
 * group — its two-pane `lg` grid arrives in Task 6 and would fight this clamp.
 */
export default function ColumnLayout({ children }: LayoutProps<'/'>) {
  return <div className="mx-auto w-full max-w-2xl flex-1">{children}</div>;
}
