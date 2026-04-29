import { type HTMLAttributes, type CSSProperties } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean
  minHeight?: string
}

export function Card({ className, padded = true, minHeight, style, children, ...props }: CardProps) {
  const cx = [
    'bg-gray-900 rounded-2xl border border-gray-800',
    padded && 'p-5',
    className,
  ].filter(Boolean).join(' ')
  const mergedStyle: CSSProperties | undefined = minHeight
    ? { minHeight, ...style }
    : style
  return <div className={cx} style={mergedStyle} {...props}>{children}</div>
}

export function CardSection({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const cx = ['border-t border-gray-800 pt-4', className].filter(Boolean).join(' ')
  return <div className={cx} {...props}>{children}</div>
}
