import React, { useEffect, useRef, useState } from 'react';
import './MediaLightboxModal.css';

interface MediaLightboxModalProps {
  mediaType: 'PHOTO' | 'VIDEO';
  url: string;
  onClose: () => void;
  caption?: string;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
  mediaType,
  url,
  onClose,
  caption,
}) => {
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closeDirection, setCloseDirection] = useState<number>(1); // 1: 下方向, -1: 上方向
  const startYRef = useRef<number>(0);
  const currentYRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // Escキーで閉じる処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // モーダル表示中のスクロールロック
  useEffect(() => {
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const handleStart = (clientY: number) => {
    setIsDragging(true);
    startYRef.current = clientY;
    currentYRef.current = clientY;
    startTimeRef.current = Date.now();
  };

  const handleMove = (clientY: number) => {
    if (!isDragging) return;
    currentYRef.current = clientY;
    const diffY = clientY - startYRef.current;
    // 上下どちら方向へも自由移動
    setTranslateY(diffY);
  };

  const handleEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const diffY = currentYRef.current - startYRef.current;
    const duration = Date.now() - startTimeRef.current;
    const velocityY = diffY / (duration || 1); // px/ms
    const absDiffY = Math.abs(diffY);
    const absVelocityY = Math.abs(velocityY);

    const DISMISS_THRESHOLD = 70; // 70px以上のドラッグで閉じる
    const VELOCITY_THRESHOLD = 0.3; // 高速なフリック操作

    if ((absDiffY > DISMISS_THRESHOLD || (absDiffY > 15 && absVelocityY > VELOCITY_THRESHOLD)) && !isClosing) {
      setIsClosing(true);
      const dir = (diffY !== 0 ? diffY : velocityY) < 0 ? -1 : 1;
      setCloseDirection(dir);
      // スライドアウトアニメーション後に onClose を呼び出し
      setTimeout(() => {
        onClose();
      }, 180);
    } else {
      // 元の位置に戻す
      setTranslateY(0);
    }
  };

  // タッチイベントハンドラ
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientY);
    }
  };

  const handleTouchEnd = () => {
    handleEnd();
  };

  // マウス/ポインターイベントハンドラ
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      handleStart(e.clientY);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientY);
  };

  const handleMouseUp = () => {
    handleEnd();
  };

  // ドラッグ時の背景不透明度計算（最大0.9から減算）
  const dragRatio = Math.max(0, Math.min(1, Math.abs(translateY) / 300));
  const backdropOpacity = isClosing ? 0 : Math.max(0.1, 0.9 * (1 - dragRatio));

  // モーダルコンテンツのスタイル
  const contentStyle: React.CSSProperties = {
    transform: isClosing
      ? `translateY(${closeDirection * (Math.max(Math.abs(translateY), 200) + window.innerHeight)}px)`
      : `translateY(${translateY}px)`,
    transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)',
  };

  const backdropStyle: React.CSSProperties = {
    backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})`,
    transition: isDragging ? 'none' : 'background-color 0.2s ease',
  };

  return (
    <div
      className="media-lightbox-backdrop"
      style={backdropStyle}
      onClick={onClose}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="media-lightbox-header" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="media-lightbox-close-btn"
          onClick={onClose}
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>

      <div
        className="media-lightbox-content-wrapper"
        style={contentStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        {mediaType === 'VIDEO' ? (
          <video
            className="media-lightbox-video"
            src={url}
            controls
            autoPlay
            playsInline
          />
        ) : (
          <img
            className="media-lightbox-image"
            src={url}
            alt={caption || ''}
            draggable={false}
          />
        )}
        {caption && <p className="media-lightbox-caption">{caption}</p>}
      </div>
    </div>
  );
};

