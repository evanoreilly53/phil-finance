import { type HTMLAttributes } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean
}

export function Card({ className, padded = true, children, ...props }: CardProps) {
  const cx = [
    'bg-gray-900 rounded-2xl border border-gray-800',
    padded && 'p-5',
    className,
  ].filter(Boolean).join(' ')
  return <div className={cx} {...props}>{children}</div>
}

export function CardSection({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const cx = ['border-t border-gray-800 pt-4', className].filter(Boolean).join(' ')
  return <div className={cx} {...props}>{children}</div>
}
