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

    // 下方向のドラッグ（diffY > 0）を主に許可。上方向（diffY < 0）は軽度の抵抗をつける
    if (diffY > 0) {
      setTranslateY(diffY);
    } else {
      setTranslateY(diffY * 0.2);
    }
  };

  const handleEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const diffY = currentYRef.current - startYRef.current;
    const duration = Date.now() - startTimeRef.current;
    const velocityY = diffY / (duration || 1); // px/ms

    const DISMISS_THRESHOLD = 80; // 80px以上下にドラッグした場合閉じる
    const VELOCITY_THRESHOLD = 0.4; // 高速なフリック操作

    if ((diffY > DISMISS_THRESHOLD || (diffY > 30 && velocityY > VELOCITY_THRESHOLD)) && !isClosing) {
      setIsClosing(true);
      // スライドアウトアニメーション後に onClose を呼び出し
      setTimeout(() => {
        onClose();
      }, 200);
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
    // 左クリックのみ
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

  // ドラッグ時の背景不透明度計算（最大0.85から減算）
  const dragRatio = Math.max(0, Math.min(1, translateY / 300));
  const backdropOpacity = isClosing ? 0 : Math.max(0.1, 0.85 * (1 - dragRatio));

  // モーダルコンテンツのスタイル
  const contentStyle: React.CSSProperties = {
    transform: isClosing
      ? `translateY(${Math.max(translateY, 300) + 400}px)`
      : `translateY(${translateY}px)`,
    transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)',
  };

  const backdropStyle: React.CSSProperties = {
    backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})`,
    transition: isDragging ? 'none' : 'background-color 0.25s ease',
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
        <div className="media-lightbox-drag-indicator">
          <span className="media-lightbox-drag-handle" />
          <span className="media-lightbox-drag-hint">下にスワイプで閉じる</span>
        </div>
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
