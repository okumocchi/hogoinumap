import slotPlaceholderImage from '../assets/slot-placeholder.png';
import './SlotPlaceholderIcon.css';

// 預かりボランティアの「空きスロット」を表すプレースホルダー画像(犬のシルエット)
export function SlotPlaceholderIcon() {
  return <img className="slot-placeholder-icon" src={slotPlaceholderImage} alt="空きスロット" />;
}
