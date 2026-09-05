/**
 * The collapsed bar's `<lg` sticky offset, as a Tailwind arbitrary value.
 *
 * bet-slip.tsx sticks its collapsed bar just above `TabBar` (src/components/ui/tab-bar.tsx)
 * using this hardcoded pixel figure derived from that nav's rendered height — two independent
 * `sticky bottom-0` elements both stick to the viewport's own bottom edge and overlap rather
 * than stack, since `sticky` doesn't reserve space for other sticky siblings. Centralizing the
 * literal here (rather than typing it into bet-slip.tsx directly) is what lets a structural
 * test assert the magic number is not duplicated in that file; it does not remove the
 * coupling itself — changing TabBar's padding, font size, or border still requires updating
 * this constant.
 */
export const COLLAPSED_BAR_OFFSET = 'bottom-[calc(41px+env(safe-area-inset-bottom))]';
