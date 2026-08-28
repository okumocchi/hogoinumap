import { useCallback, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  onRefresh?: () => void;
  threshold?: number;
  maxPullDistance?: number;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  maxPullDistance = 110,
}: UsePullToRefreshOptions = {}) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isPullingRef = useRef(false);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isRefreshing) return;

      // 画面最上部のみ発動
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      if (scrollTop <= 5) {
        startYRef.current = e.touches[0].clientY;
        startXRef.current = e.touches[0].clientX;
        isPullingRef.current = true;
      }
    },
    [isRefreshing],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isPullingRef.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startYRef.current;
      const deltaX = currentX - startXRef.current;

      // 下方向への移動であり、かつ横スクロールより縦スクロールの移動が大きい場合
      if (deltaY > 0 && deltaY > Math.abs(deltaX) * 1.2) {
        setIsDragging(true);
        // 引き下げに抵抗感（イージング）を付ける
        const distance = Math.min(deltaY * 0.45, maxPullDistance);
        setPullDistance(distance);
      } else if (deltaY <= 0) {
        setPullDistance(0);
        setIsDragging(false);
      }
    },
    [isRefreshing, maxPullDistance],
  );

  const handleTouchEnd = useCallback(() => {
    if (!isPullingRef.current) return;
    isPullingRef.current = false;
    setIsDragging(false);

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold); // リロード中の固定位置

      if (onRefresh) {
        onRefresh();
      } else {
        // デフォルト動作: ページリロード
        window.location.reload();
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  const isReadyToRelease = pullDistance >= threshold;

  return {
    pullDistance,
    isRefreshing,
    isDragging,
    isReadyToRelease,
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
  };
}
