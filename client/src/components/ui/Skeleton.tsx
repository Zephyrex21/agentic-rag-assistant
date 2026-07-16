import { motion } from 'framer-motion';

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-surface-raised ${className}`}>
      <motion.div
        className="absolute inset-0 -translate-x-full"
        style={{
          background: 'linear-gradient(90deg, transparent, var(--color-border), transparent)',
        }}
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

export function DocumentRowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2">
      <Skeleton className="h-[15px] w-[15px] shrink-0 rounded" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

export function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2">
      <Skeleton className="h-[14px] w-[14px] shrink-0 rounded" />
      <Skeleton className="h-3.5 flex-1" />
    </div>
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2 pt-0.5">
        <Skeleton className="h-3.5 w-[92%]" />
        <Skeleton className="h-3.5 w-[78%]" />
        <Skeleton className="h-3.5 w-[85%]" />
      </div>
    </div>
  );
}
