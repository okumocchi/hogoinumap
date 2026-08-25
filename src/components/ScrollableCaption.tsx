import { useEffect, useRef, useState } from 'react';
import './ScrollableCaption.css';

interface ScrollableCaptionProps {
  caption: string;
  containerClassName?: string;
  textClassName?: string;
  speed?: number; // ピクセル/秒 (デフォルト: 50px/s)
}

export function ScrollableCaption({
  caption,
  containerClassName = '',
  textClassName = '',
  speed = 50,
}: ScrollableCaptionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<{ duration: number; containerWidth: number; textWidth: number }>({
    duration: 8,
    containerWidth: 300,
    textWidth: 150,
  });

  useEffect(() => {
    let animationFrameId: number;

    function updateLayout() {
      if (!containerRef.current || !textRef.current) return;
      const cWidth = containerRef.current.clientWidth || containerRef.current.getBoundingClientRect().width;
      const tWidth = textRef.current.scrollWidth || textRef.current.getBoundingClientRect().width;

      if (cWidth > 0 && tWidth > 0) {
        const totalDistance = cWidth + tWidth;
        const duration = totalDistance / speed;
        setLayout({
          duration: Math.max(1, duration),
          containerWidth: cWidth,
          textWidth: tWidth,
        });
      }
    }

    updateLayout();
    animationFrameId = requestAnimationFrame(updateLayout);

    const observer = new ResizeObserver(() => {
      updateLayout();
    });

    if (containerRef.current) observer.observe(containerRef.current);
    if (textRef.current) observer.observe(textRef.current);

    return () => {
      cancelAnimationFrame(animationFrameId);
      observer.disconnect();
    };
  }, [caption, speed]);

  return (
    <div ref={containerRef} className={`scrollable-caption-container ${containerClassName}`}>
      <span
        ref={textRef}
        className={`scrollable-caption-text ${textClassName}`}
        style={{
          animationDuration: `${layout.duration}s`,
          animationName: 'scroll-caption-constant-speed',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          ['--container-width' as any]: `${layout.containerWidth}px`,
          ['--text-width' as any]: `${layout.textWidth}px`,
        }}
      >
        {caption}
      </span>
    </div>
  );
}
