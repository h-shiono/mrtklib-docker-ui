import { LIVE_TONE, STATUS_COLOR, type LiveState } from '../../utils/status';

/** The dot on a header item whose screen has a live process (#202). The
 *  item's name is beside it; the state word is in its label and tooltip. */
export function LiveDot({ name, live }: { name: string; live: LiveState | null }) {
  if (!live) return null;
  const label = `${name}: ${live}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        marginLeft: 6,
        flexShrink: 0,
        verticalAlign: 'middle',
        background: STATUS_COLOR[LIVE_TONE[live]],
      }}
    />
  );
}
