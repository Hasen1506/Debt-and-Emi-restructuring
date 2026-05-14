import { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {children}
    </div>
  );
}
